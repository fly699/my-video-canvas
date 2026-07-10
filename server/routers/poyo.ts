import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { ENV } from "../_core/env";
import { assertWhitelisted } from "../_core/whitelist";
import { insertPoyoBalanceSnapshotThrottled, getRecentPoyoBalanceSnapshots, recordGeneratedAsset } from "../db";
import { submitPoyoImageTo3D, checkPoyo3DStatus, persist3DModelOrFallback } from "../_core/poyo3d";
import { assertProjectAccess } from "../_core/permissions";

const POYO_BASE = "https://api.poyo.ai";

export const poyoRouter = router({
  // Current platform-account credit balance. Polled by the top-bar dashboard.
  balance: protectedProcedure.query(async ({ ctx }) => {
    // 余额查询会用平台公用 key 打 Poyo（账户敏感信息）。非白名单用户返回未配置占位——
    // 不触达公用 key、不泄露平台余额（与「能用生成功能」同门槛；admin 在 assertWhitelisted 内放行）。
    const sentinel = { configured: false, isDev: !ENV.isProduction, email: null as string | null, creditsAmount: null as number | null };
    try { await assertWhitelisted(ctx); } catch { return sentinel; }
    // Graceful degradation when no key is configured — return a sentinel rather
    // than throwing, so the top-bar badge can show "未配置" without error spam.
    if (!ENV.poyoApiKey) {
      return sentinel;
    }

    let res: Response;
    try {
      res = await fetch(`${POYO_BASE}/api/user/balance`, {
        headers: { Authorization: `Bearer ${ENV.poyoApiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Poyo 余额查询失败：${err instanceof Error ? err.message : String(err)}` });
    }
    if (!res.ok) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Poyo 余额查询失败 (${res.status})` });
    }
    const body = (await res.json()) as { code?: number; message?: string; data?: { email?: string; credits_amount?: number } };
    if (body.code !== undefined && body.code !== 0 && body.code !== 200) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Poyo 余额查询返回错误 (code ${body.code}): ${body.message ?? ""}` });
    }
    const creditsAmount = body.data?.credits_amount;
    if (typeof creditsAmount !== "number") {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Poyo 余额响应格式错误" });
    }
    const email = body.data?.email ?? null;

    // Record a throttled snapshot for consumption/trend charting (best-effort).
    try { await insertPoyoBalanceSnapshotThrottled({ creditsAmount, email }); } catch { /* non-fatal */ }

    return { configured: true, isDev: false, email, creditsAmount };
  }),

  // Recent balance snapshots (newest first) for consumption/trend display.
  history: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ ctx, input }) => {
      // 平台余额历史同属敏感信息，非白名单用户返回空（与 balance 同门槛）。
      try { await assertWhitelisted(ctx); } catch { return [] as { creditsAmount: number; at: string }[]; }
      const rows = await getRecentPoyoBalanceSnapshots(input?.limit ?? 50);
      return rows.map((r) => ({ creditsAmount: r.creditsAmount, at: r.at.toISOString() }));
    }),

  // ── B 档：图生 3D（Tripo3D H3.1）——客户端驱动的两端点(提交→轮询)，不落 DB 任务表 ──
  // 生成需数分钟：submit 拿 task_id，客户端每几秒 poll 一次 status3d；finished 时服务端把
  // glb 转存到自有存储（上游 24h 直链会失效）后回传自有 URL。白名单门槛同生成功能。
  submitImageTo3d: protectedProcedure
    .input(z.object({
      imageUrl: z.string().min(1),
      texture: z.boolean().optional(),
      textureQuality: z.enum(["standard", "detailed"]).optional(),
      geometryQuality: z.enum(["standard", "detailed"]).optional(),
      quad: z.boolean().optional(),
      pbr: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      if (!ENV.poyoApiKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "平台未配置 Poyo API Key，无法图生 3D" });
      try {
        const { externalTaskId } = await submitPoyoImageTo3D(input);
        return { taskId: externalTaskId };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `图生 3D 提交失败：${err instanceof Error ? err.message : String(err)}` });
      }
    }),

  status3d: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertWhitelisted(ctx);
      if (!ENV.poyoApiKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "平台未配置 Poyo API Key" });
      let st;
      try {
        st = await checkPoyo3DStatus(input.taskId);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `图生 3D 查询失败：${err instanceof Error ? err.message : String(err)}` });
      }
      // finished：把 glb 转存到自有存储再回传（失败回退上游直链，至少 24h 可用）。
      const glbUrl = st.status === "finished" && st.glbUrl ? await persist3DModelOrFallback(st.glbUrl) : undefined;
      return {
        status: st.status,
        progress: st.progress ?? null,
        glbUrl: glbUrl ?? null,
        thumbnailUrl: st.thumbnailUrl ?? null,
        error: st.errorMessage ?? null,
      };
    }),

  // 把已生成（已转存自有存储）的 .glb 记入素材库（type=other），供下载/跨项目复用。
  // 只建索引记录、不再下载搬运；素材归调用者本人，项目归属需 editor 权限。
  save3dToLibrary: protectedProcedure
    .input(z.object({
      glbUrl: z.string().min(1).max(2000),
      projectId: z.number().optional(),
      nodeId: z.string().max(64).optional(),
      name: z.string().max(120).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.projectId != null) await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      // recordGeneratedAsset 自带按 storageKey 去重（重复保存 = no-op）。
      await recordGeneratedAsset({
        userId: ctx.user.id,
        projectId: input.projectId ?? null,
        nodeId: input.nodeId ?? null,
        type: "other",
        source: "generated",
        provider: "poyo",
        model: "tripo3d",
        url: input.glbUrl,
        name: (input.name?.trim() || "真3D模型") + ".glb",
        mimeType: "model/gltf-binary",
      });
      return { saved: true };
    }),
});
