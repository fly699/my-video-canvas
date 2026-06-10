import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { ENV } from "../_core/env";
import { assertWhitelisted } from "../_core/whitelist";
import { insertPoyoBalanceSnapshotThrottled, getRecentPoyoBalanceSnapshots } from "../db";

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
});
