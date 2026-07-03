import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { router, levelProcedure } from "../_core/trpc";
import { assertProjectAccess } from "../_core/permissions";
import { assertComfyuiAllowed } from "../_core/whitelist";
import { writeAuditLog } from "../_core/auditLog";
import { ENV } from "../_core/env";
import { runComfyAgent } from "../_core/superAgent/comfyAgent";
import { createComfyTools, createAgentLLM } from "../_core/superAgent/comfyAdapters";
import { emitSuperAgentEvent } from "../_core/superAgent/socket";
import { buildClaudeArgs, runCodeAgent } from "../_core/superAgent/codeAgent";
import { streamClaudeCode, isCodeAgentEnabled, isBashAllowed } from "../_core/superAgent/claudeProcess";

// 超级智能体 · Phase 1（工程智能体的 ComfyUI 底座）。
// 权限：管理员 L3+（powerful + 花 LLM/GPU），且项目编辑者。LLM 白名单门控由
// invokeLLMWithKie 内部统一强制（唯一 LLM 入口）。ComfyUI 访问经 assertComfyuiAllowed。
// 不涉及任何 shell/子进程/沙箱——全程 HTTP 调 ComfyUI + LLM，与操作系统无关。
const managerProc = levelProcedure(3);
const superProc = levelProcedure(4); // 代码任务=任意执行级能力，限超级管理员

export const superAgentRouter = router({
  // 自然语言任务 → 自动编写并真机调通一份 ComfyUI API 格式工作流。
  // 活动日志经 socket "superagent:event" 流式推给项目房间；本 mutation 结束时返回最终产物。
  buildComfyWorkflow: managerProc
    .input(
      z.object({
        projectId: z.number(),
        /** 可选：把日志/事件关联到画布上的某个 super_agent 节点。 */
        nodeId: z.string().max(64).optional(),
        task: z.string().min(1).max(2000),
        /** 目标 ComfyUI 服务器（留空用服务端 COMFYUI_BASE_URL）。Phase 1 仅本地自建。 */
        baseUrl: z.string().max(512).optional(),
        model: z.string().max(64).optional(),
        maxIterations: z.number().int().min(1).max(16).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await assertComfyuiAllowed(ctx);

      const baseUrl = input.baseUrl?.trim() || ENV.comfyuiBaseUrl;
      if (!baseUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ComfyUI URL 未配置：请在节点里填写目标服务器或服务端设置 COMFYUI_BASE_URL" });
      }

      const tools = createComfyTools({ baseUrl, projectId: input.projectId, nodeId: input.nodeId });
      const llm = createAgentLLM(ctx, input.model); // LLM 白名单/密钥门控在 invokeLLMWithKie 内部强制

      const result = await runComfyAgent({
        task: input.task,
        tools,
        llm,
        maxIterations: input.maxIterations ?? 8,
        emit: (e) => emitSuperAgentEvent(input.projectId, input.nodeId, e),
      });

      writeAuditLog({
        ctx,
        action: "superagent_comfy_build",
        detail: { projectId: input.projectId, task: input.task.slice(0, 200), status: result.status, iterations: result.iterations, baseUrl },
      });

      // 日志已流式推送；这里回传最终产物 + 精简日志（去掉可能很大的 data 字段）。
      return {
        status: result.status,
        workflowJson: result.workflowJson,
        analysis: result.analysis,
        images: result.images,
        videos: result.videos,
        outputType: result.outputType,
        iterations: result.iterations,
        log: result.log.map((e) => ({ type: e.type, iteration: e.iteration, message: e.message })),
      };
    }),

  // 是否可用（前端据此显示/隐藏「代码任务」入口）。任何 L3+ 都能查询状态。
  codeStatus: managerProc.query(() => ({ enabled: isCodeAgentEnabled(), bashAllowed: isBashAllowed() })),

  // Phase 2：无头 Claude Code 编码任务（受限工作目录 + commandPolicy）。
  // 权限：超级管理员 L4；且需服务端 env SUPER_AGENT_CODE_ENABLED=1（默认关闭，完全 inert）。
  // 每次跑在一次性临时工作区（cwd + --add-dir 均限于此），结束即删。危险 Bash 由
  // runCodeAgent 的 commandPolicy 监控，命中即杀进程止损。
  runCodeTask: superProc
    .input(
      z.object({
        projectId: z.number(),
        nodeId: z.string().max(64).optional(),
        task: z.string().min(1).max(8000),
        model: z.string().max(64).optional(),
        /** 成本封顶（美元），1–20，默认 2。 */
        maxBudgetUsd: z.number().min(0.1).max(20).optional(),
        /** 硬超时（秒），30–900，默认 300。 */
        timeoutSec: z.number().int().min(30).max(900).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      if (!isCodeAgentEnabled()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "代码智能体未启用：请在服务端设置 SUPER_AGENT_CODE_ENABLED=1（并按需 SUPER_AGENT_CODE_ALLOW_BASH=1 放行 shell）" });
      }

      // 一次性临时工作区。
      const workspace = mkdtempSync(join(tmpdir(), "superagent-code-"));
      const emit = (e: { type: string; message: string; data?: unknown }) => emitSuperAgentEvent(input.projectId, input.nodeId, e);
      try {
        const handle = streamClaudeCode({
          task: input.task,
          cwd: workspace,
          timeoutMs: (input.timeoutSec ?? 300) * 1000,
          argsBuilder: (policy) => buildClaudeArgs({
            ...policy,
            addDirs: [workspace],
            model: input.model,
            maxBudgetUsd: input.maxBudgetUsd ?? 2,
          }),
        });

        const result = await runCodeAgent({ lines: handle.lines, emit, onAbort: () => handle.kill() });
        handle.kill();
        const proc = await handle.done;

        writeAuditLog({
          ctx,
          action: "superagent_code_task",
          detail: { projectId: input.projectId, task: input.task.slice(0, 200), status: result.status, blockedCommand: result.blockedCommand ?? null, costUsd: result.costUsd ?? null, numTurns: result.numTurns ?? null, exitCode: proc.exitCode, timedOut: proc.timedOut },
        });

        return {
          status: result.status,
          result: result.result,
          blockedCommand: result.blockedCommand,
          costUsd: result.costUsd,
          numTurns: result.numTurns,
          timedOut: proc.timedOut,
          log: result.events.map((e) => ({ type: e.type, message: e.message })),
        };
      } finally {
        // 清理一次性工作区（best-effort）。
        try { rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }),
});
