// ComfyUI 压力测试路由（仅管理员）。
//
// 复用 server/_core/comfyStress.ts 的后台任务管理器：start 立即返回 jobId，
// 真正的并发循环在后台跑。前端通过 status / list 轮询，并可经 Socket.IO 实时收进度。

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { startStressTest, getJob, listJobs, cancelJob, stopJob, toView } from "../_core/comfyStress";

export const comfyStressRouter = router({
  // 启动一次压测，立即返回任务概要（含 id）。
  start: adminProcedure
    .input(
      z.object({
        // 留空则用全局 ENV.comfyuiBaseUrl
        customBaseUrl: z.string().max(2048).optional(),
        workflowJson: z.string().min(2).max(2_000_000),
        mode: z.enum(["lean", "full"]).default("lean"),
        concurrency: z.number().int().min(1).max(32).default(1),
        total: z.number().int().min(1).max(1000).default(10),
        randomizeSeed: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) => {
      const baseUrl = input.customBaseUrl?.trim() || ENV.comfyuiBaseUrl;
      if (!baseUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ComfyUI 服务器地址未配置（COMFYUI_BASE_URL 为空，且未提供 customBaseUrl）" });
      }
      try {
        return startStressTest({
          baseUrl,
          workflowJson: input.workflowJson,
          mode: input.mode,
          concurrency: input.concurrency,
          total: input.total,
          randomizeSeed: input.randomizeSeed,
          startedBy: { id: ctx.user.id, email: ctx.user.email ?? null },
        });
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) });
      }
    }),

  // 查询单个任务的实时状态。
  status: adminProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .query(({ input }) => {
      const job = getJob(input.id);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "压测任务不存在或已过期" });
      return toView(job);
    }),

  // 列出近期所有任务（按开始时间倒序）。
  list: adminProcedure.query(() => listJobs()),

  // 优雅取消：不再派发新请求，已在途的请求会跑完。
  cancel: adminProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(({ input }) => {
      const ok = cancelJob(input.id);
      if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "任务不存在或已结束，无法取消" });
      return { success: true };
    }),

  // 立即停止：abort 所有在途的 ComfyUI 请求，不等其完成。
  stop: adminProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(({ input }) => {
      const ok = stopJob(input.id);
      if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "任务不存在或已结束，无法停止" });
      return { success: true };
    }),
});
