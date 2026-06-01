// ComfyUI 压力测试路由（仅管理员）。
//
// 复用 server/_core/comfyStress.ts 的后台任务管理器：start 立即返回 jobId，
// 真正的并发循环在后台跑。前端通过 status / list 轮询，并可经 Socket.IO 实时收进度。

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { startStressTest, getJob, listJobs, cancelJob, stopJob, toView } from "../_core/comfyStress";
import { buildImageWorkflow } from "../_core/comfyui";

export const comfyStressRouter = router({
  // 启动一次压测，立即返回任务概要（含 id）。
  start: adminProcedure
    .input(
      z.object({
        // 多地址压测：留空则回退到全局 ENV.comfyuiBaseUrl。
        // 兼容旧前端：仍接受单个 customBaseUrl。
        customBaseUrls: z.array(z.string().max(2048)).max(16).optional(),
        customBaseUrl: z.string().max(2048).optional(),
        // 压测来源二选一：粘贴工作流 JSON，或选一个 checkpoint 模型自动构造 txt2img。
        workflowJson: z.string().min(2).max(2_000_000).optional(),
        model: z.object({
          ckpt: z.string().min(1).max(512),
          prompt: z.string().max(2000).default(""),
          negPrompt: z.string().max(2000).default(""),
          steps: z.number().int().min(1).max(150).default(20),
          cfg: z.number().min(0).max(50).default(7),
          sampler: z.string().max(128).default("euler"),
          scheduler: z.string().max(128).default("normal"),
          width: z.number().int().min(64).max(4096).default(512),
          height: z.number().int().min(64).max(4096).default(512),
          batchSize: z.number().int().min(1).max(8).default(1),
          denoise: z.number().min(0).max(1).default(1),
          vae: z.string().max(255).optional(),
          upscaleModel: z.string().max(255).optional(),
          // Optional separate CLIP loader (Flux/SD3/UNet-only checkpoints).
          clip: z.object({
            clipType: z.string().min(1).max(64),
            name1: z.string().min(1).max(255),
            name2: z.string().max(255).optional(),
            name3: z.string().max(255).optional(),
          }).optional(),
          // DiT architecture support (default classic SD).
          arch: z.enum(["sd", "flux", "sd3", "qwen"]).optional(),
          modelSource: z.enum(["checkpoint", "unet"]).optional(),
          unetWeightDtype: z.string().max(64).optional(),
          guidance: z.number().min(0).max(100).optional(),
          shift: z.number().min(0).max(100).optional(),
        }).optional(),
        mode: z.enum(["lean", "full"]).default("lean"),
        concurrency: z.number().int().min(1).max(32).default(1),
        total: z.number().int().min(1).max(1000).default(10),
        randomizeSeed: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) => {
      const provided = [
        ...(input.customBaseUrls ?? []),
        ...(input.customBaseUrl ? [input.customBaseUrl] : []),
      ].map((u) => u.trim()).filter((u) => u.length > 0);
      const baseUrls = provided.length > 0 ? provided : (ENV.comfyuiBaseUrl ? [ENV.comfyuiBaseUrl] : []);
      if (baseUrls.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ComfyUI 服务器地址未配置（COMFYUI_BASE_URL 为空，且未提供任何地址）" });
      }
      // 「服务器模型」模式：用选中的 checkpoint + 参数构造最小 txt2img 工作流；
      // 否则使用粘贴的 workflowJson。两者皆无则报错。
      let workflowJson: string;
      if (input.model) {
        const m = input.model;
        const wf = buildImageWorkflow({
          template: "txt2img",
          prompt: m.prompt,
          negPrompt: m.negPrompt,
          ckpt: m.ckpt,
          loras: [],
          clip: m.clip,
          arch: m.arch,
          modelSource: m.modelSource,
          unetWeightDtype: m.unetWeightDtype,
          guidance: m.guidance,
          shift: m.shift,
          vae: m.vae,
          upscaleModel: m.upscaleModel,
          seed: Math.floor(Math.random() * 2_147_483_647),
          steps: m.steps,
          cfg: m.cfg,
          sampler: m.sampler,
          scheduler: m.scheduler,
          denoise: m.denoise ?? 1.0,
          width: m.width,
          height: m.height,
          batchSize: m.batchSize,
        });
        workflowJson = JSON.stringify(wf);
      } else if (input.workflowJson) {
        workflowJson = input.workflowJson;
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请提供工作流 JSON 或选择一个模型" });
      }
      try {
        return startStressTest({
          baseUrls,
          workflowJson,
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
