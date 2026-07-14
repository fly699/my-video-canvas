import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { router, levelProcedure } from "../_core/trpc";
import { assertProjectAccess } from "../_core/permissions";
import { assertComfyuiAllowed } from "../_core/whitelist";
import { writeAuditLog } from "../_core/auditLog";
import { ENV } from "../_core/env";
import { runComfyAgent, extractRunLessons, type ComfyAgentTools } from "../_core/superAgent/comfyAgent";
import { createComfyTools, createAgentLLM, pickReferenceWorkflows, dedupeReferenceCandidates } from "../_core/superAgent/comfyAdapters";
import { emitSuperAgentEvent } from "../_core/superAgent/socket";
import { buildClaudeArgs, runCodeAgent, frameCodeTask, shouldKeepWorkspace } from "../_core/superAgent/codeAgent";
import { streamClaudeCode, isCodeAgentEnabled, isBashAllowed } from "../_core/superAgent/claudeProcess";
import { getSuperAgentConfig } from "../_core/superAgent/config";
import { invalidateComfyKnowledge } from "../_core/comfyKnowledge";
import {
  recordWorkflowExperience, recallWorkflowExperiences, recordWorkflowFailure, recallPitfalls,
  listWorkflowExperiences, searchWorkflowExperiences, deleteWorkflowExperience, clearWorkflowExperiences,
} from "../_core/comfyExperience";
import { installModel, installCustomNode, isValidDownloadUrl, isValidModelFilename, isValidGitUrl, MODEL_DIRS, type ModelDir } from "../_core/ops/modelOps";
import * as db from "../db";
import type { TrpcContext } from "../_core/context";

const norm = (u: string) => u.replace(/\/+$/, "").trim();

/**
 * 下载模型/节点框架（默认关闭，inert）：仅当「ComfyUI 缺件自动安装」开启（后台配置优先、
 * env SUPER_AGENT_AUTO_INSTALL=1 兜底）且当前用户 L3+ 且目标 ComfyUI 地址匹配到一台「已在运维台
 * 注册（有 SSH）且启用」的 ops 服务器时，才把 installModel/installNode 工具交给引擎。否则返回空
 * 对象——引擎无安装能力，只能用现有资源。安装经 modelOps 的字符集+单引号注入防护 + 这里的
 * URL/文件名/目录白名单校验。
 */
async function resolveInstallTools(ctx: TrpcContext, baseUrl: string): Promise<Pick<ComfyAgentTools, "installModel" | "installNode">> {
  if (!getSuperAgentConfig().autoInstall) return {};
  if ((ctx.user?.adminLevel ?? 0) < 3) return {};
  const servers = await db.listOpsServers().catch(() => []);
  const match = servers.find((s) => s.enabled && s.comfyBaseUrl && norm(s.comfyBaseUrl) === norm(baseUrl));
  if (!match) return {};
  const sid = match.id;
  return {
    installModel: async ({ url, dir, filename }) => {
      if (!isValidDownloadUrl(url)) return { ok: false, message: "下载 URL 未通过安全校验" };
      if (!isValidModelFilename(filename)) return { ok: false, message: "文件名未通过校验（需 .safetensors/.ckpt 等）" };
      if (!(MODEL_DIRS as readonly string[]).includes(dir)) return { ok: false, message: `目标子目录非法（允许：${MODEL_DIRS.join("/")}）` };
      try { const r = await installModel(sid, url, dir as ModelDir, filename); if (r.ok) invalidateComfyKnowledge(baseUrl); return { ok: r.ok, message: (r.output || "").slice(-500) }; }
      catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
    },
    installNode: async (gitUrl) => {
      if (!isValidGitUrl(gitUrl)) return { ok: false, message: "git 仓库 URL 未通过校验" };
      try { const r = await installCustomNode(sid, gitUrl); if (r.ok) invalidateComfyKnowledge(baseUrl); return { ok: r.ok, message: (r.output || "").slice(-500) }; }
      catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
    },
  };
}

// 超级智能体 · Phase 1（工程智能体的 ComfyUI 底座）。
// 权限：管理员 L3+（powerful + 花 LLM/GPU），且项目编辑者。LLM 白名单门控由
// invokeLLMWithKie 内部统一强制（唯一 LLM 入口）。ComfyUI 访问经 assertComfyuiAllowed。
// 不涉及任何 shell/子进程/沙箱——全程 HTTP 调 ComfyUI + LLM，与操作系统无关。
const managerProc = levelProcedure(3);
const superProc = levelProcedure(4); // 代码任务=任意执行级能力，限超级管理员

// 运行中任务的取消登记表：key=`${projectId}:${nodeId}` → 取消函数（comfy=置 abort 位；code=杀进程）。
const runningJobs = new Map<string, () => void>();
const jobKey = (projectId: number, nodeId: string | undefined) => `${projectId}:${nodeId ?? ""}`;

// 代码任务「连续对话」的会话登记表：key=jobKey → { 持久工作区目录, claude 会话 id, 最后使用时刻 }。
// 续接（--resume）需要 cwd 保持一致（claude 按 cwd 归档会话、上轮写的文件也在此），故工作区
// 跨轮持久，不再每轮删。清理：新开会话时删旧、显式「新对话」删、以及每次运行前扫掉 60 分钟空闲的。
// 仍与真实仓库隔离（独立临时目录 + 仅 --add-dir 该目录），只是「一次性」放宽为「一次会话」。
interface CodeSession { dir: string; sessionId?: string; lastUsed: number }
const codeSessions = new Map<string, CodeSession>();
const CODE_SESSION_TTL_MS = 60 * 60 * 1000;

function sweepStaleCodeSessions() {
  const cutoff = Date.now() - CODE_SESSION_TTL_MS;
  codeSessions.forEach((s, k) => {
    if (s.lastUsed < cutoff) { try { rmSync(s.dir, { recursive: true, force: true }); } catch { /* ignore */ } codeSessions.delete(k); }
  });
}

function disposeCodeSession(key: string) {
  const s = codeSessions.get(key);
  if (s) { try { rmSync(s.dir, { recursive: true, force: true }); } catch { /* ignore */ } codeSessions.delete(key); }
}

// buildComfyWorkflow 的「最终结果」缓存。工程智能体搭工作流是一次长请求（最多十几轮 LLM+ComfyUI
// 真机跑，动辄数分钟）。经公网隧道时，cloudflared 对单个 HTTP 响应有 ~100s 上限，长请求会被切断，
// 客户端拿到 network error——但服务端其实已跑完。为此：跑完后除了 HTTP 返回，同时把最终结果经 socket
// 广播（隧道 socket 已 attach，见 tunnel 血泪教训），并在此缓存一份，供客户端 getBuildResult 兜底重载。
interface CachedBuildResult { at: number; result: unknown }
const buildResults = new Map<string, CachedBuildResult>();
const BUILD_RESULT_TTL_MS = 15 * 60 * 1000;
function cacheBuildResult(key: string, result: unknown) {
  const now = Date.now();
  buildResults.set(key, { at: now, result });
  buildResults.forEach((v, k) => { if (now - v.at > BUILD_RESULT_TTL_MS) buildResults.delete(k); });
}

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
        customBaseUrl: z.string().max(512).optional(),
        model: z.string().max(64).optional(),
        maxIterations: z.number().int().min(1).max(60).optional(),
        /** 「加载全部资源」：系统提示不截断，列出服务器全部已装模型/LoRA/节点（配合大上下文模型）。 */
        showAllResources: z.boolean().optional(),
        /** 连续对话：上一版调通的 workflowJson，本轮在其基础上改。 */
        seedWorkflowJson: z.string().max(200_000).optional(),
        /** 连续对话：先前若干轮的精简历史。 */
        history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(20).optional(),
        /** 是否使用记忆体（资源记忆 + 工作流经验召回）。默认 true；关掉则忽略记忆、直接读真机。 */
        useMemory: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await assertComfyuiAllowed(ctx);

      const baseUrl = input.customBaseUrl?.trim() || ENV.comfyuiBaseUrl;
      if (!baseUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ComfyUI URL 未配置：请在节点里填写目标服务器或服务端设置 COMFYUI_BASE_URL" });
      }

      const useMemory = input.useMemory !== false; // 默认用记忆体；显式 false 才关闭
      const installTools = await resolveInstallTools(ctx, baseUrl); // 默认空（框架 inert）；满足前提才开放
      // useMemory=false：资源记忆也不用，强制读真机（仍写穿缓存，供他方复用）。
      const tools = { ...createComfyTools({ baseUrl, projectId: input.projectId, nodeId: input.nodeId, useMemory }), ...installTools };
      const llm = createAgentLLM(ctx, input.model); // LLM 白名单/密钥门控在 invokeLLMWithKie 内部强制

      // 从零编写时，检索参考范例：优先「工作流经验记忆体」召回本服务器成功搭通过的相似工作流（最高信号、
      // 尽量给全量图供直接参考），再加本项目画布上的 comfyui_workflow 节点、共享模板库里的相似工作流。
      // 续接（seedWorkflowJson）已有基底，不再注入以省上下文。useMemory=false 时不召回经验。
      // 失败教训/已知坑：召回本服务器过往在类似任务上踩过的坑，注入引擎开头主动规避（useMemory 时）。
      let knownPitfalls: string[] = [];
      if (useMemory) {
        try {
          knownPitfalls = await recallPitfalls(baseUrl, input.task, 10);
          if (knownPitfalls.length) {
            emitSuperAgentEvent(input.projectId, input.nodeId, {
              type: "memory",
              message: `已调用失败经验记忆体：注入 ${knownPitfalls.length} 条过往踩过的坑，本次将主动规避（避免重复造车）。`,
              data: { kind: "pitfalls", count: knownPitfalls.length },
            });
          }
        } catch { /* 召回失败不阻断 */ }
      }

      let referenceExamples: { label: string; workflowJson: string }[] = [];
      if (!input.seedWorkflowJson) {
        try {
          // 经验优先且尽量给全（8000 上限，绝大多数图可完整参考、不失真）。
          const exp = useMemory ? await recallWorkflowExperiences(baseUrl, input.task, 2, 8000).catch(() => []) : [];
          const expExamples = exp.map((e) => ({ label: `经验·${e.label}`, workflowJson: e.workflowJson }));
          const canvasCands = (await db.getNodesByProject(input.projectId).catch(() => []))
            .filter((n) => n.type === "comfyui_workflow")
            .map((n) => {
              const d = (n.data ?? {}) as Record<string, unknown>;
              return { label: n.title || String(d.templateLabel ?? "") || "画布工作流", note: (String(d.templateLabel ?? "") || undefined), workflowJson: String(d.workflowJson ?? "") };
            });
          const tplCands = (await db.listComfyNodeTemplates().catch(() => []))
            .filter((r) => r.nodeType === "comfyui_workflow")
            .map((r) => ({ label: r.label, note: r.note ?? undefined, workflowJson: String((r.payload as Record<string, unknown> | null)?.workflowJson ?? "") }));
          const picked = pickReferenceWorkflows(input.task, dedupeReferenceCandidates([...canvasCands, ...tplCands]), 2);
          // 经验在前（已按相关度排序、内容更全），再补画布/模板参考；整体去重同一份图、总数封顶 3。
          referenceExamples = dedupeReferenceCandidates([...expExamples, ...picked].map((x) => ({ ...x, note: undefined })))
            .map((x) => ({ label: x.label, workflowJson: x.workflowJson })).slice(0, 3);
          if (exp.length) {
            // 记忆体调用提醒：本次参考了 N 条历史成功经验（永不过期，如需清理到经验记忆面板手动删除）。
            emitSuperAgentEvent(input.projectId, input.nodeId, {
              type: "memory",
              message: `已调用工作流经验记忆体：参考了 ${exp.length} 条历史成功工作流（越用越快；如经验已过时，可在「工作流经验记忆」里手动删除）。`,
              data: { kind: "experience", count: exp.length, tasks: exp.map((e) => e.label).slice(0, 3) },
            });
          }
        } catch { /* 检索失败不阻断 */ }
      }

      const signal = { aborted: false };
      const key = jobKey(input.projectId, input.nodeId);
      runningJobs.set(key, () => { signal.aborted = true; });
      let result;
      try {
        result = await runComfyAgent({
          task: input.task,
          tools,
          llm,
          maxIterations: input.maxIterations ?? 20,
          emit: (e) => emitSuperAgentEvent(input.projectId, input.nodeId, e),
          signal,
          seedWorkflowJson: input.seedWorkflowJson,
          history: input.history,
          referenceExamples,
          showAllResources: input.showAllResources,
          knownPitfalls,
        });
      } finally {
        runningJobs.delete(key);
      }

      writeAuditLog({
        ctx,
        action: "superagent_comfy_build",
        detail: { projectId: input.projectId, task: input.task.slice(0, 200), status: result.status, iterations: result.iterations, baseUrl },
      });

      // 全量沉淀进「工作流经验记忆体」（best-effort，不阻断返回，与是否「使用」记忆解耦——始终学习）：
      // - 成功：完整工作流 + 分析/样例产物/迭代/LLM + 过程中克服的问题（lessons）。
      // - 失败/耗尽（非用户取消）：把拦路的问题当「踩过的坑」沉淀，下次同类任务主动规避、不重复造车。
      const lessons = extractRunLessons(result.log);
      if (result.status === "success" && result.workflowJson) {
        void recordWorkflowExperience({
          baseUrl, task: input.task, workflowJson: result.workflowJson, outputType: result.outputType ?? null,
          meta: {
            analysis: result.analysis ? { paramBindings: result.analysis.paramBindings, outputNodeIds: result.analysis.outputNodeIds, outputType: result.analysis.outputType ?? null } : undefined,
            images: result.images, videos: result.videos,
            iterations: result.iterations, llmModel: input.model ?? null,
            lessons: lessons.length ? lessons : undefined,
          },
        }).then((saved) => {
          if (saved) emitSuperAgentEvent(input.projectId, input.nodeId, {
            type: "memory",
            message: "已把本次成功工作流存入经验记忆体，下次相似任务将自动参考（永不过期，可手动清理）。",
            data: { kind: "experience-saved" },
          });
        }).catch(() => { /* 沉淀失败无妨 */ });
      } else if ((result.status === "failed" || result.status === "exhausted") && lessons.length) {
        // aborted（用户取消）不记；纯连接/超时噪声已被 extractRunLessons 过滤（lessons 为空则不记）。
        void recordWorkflowFailure({
          baseUrl, task: input.task, status: result.status, failReasons: lessons,
          workflowJson: result.workflowJson, meta: { iterations: result.iterations, llmModel: input.model ?? null },
        }).then((saved) => {
          if (saved) emitSuperAgentEvent(input.projectId, input.nodeId, {
            type: "memory",
            message: `已把本次失败教训（${lessons.length} 条踩过的坑）存入记忆体，下次同类任务将主动规避。`,
            data: { kind: "pitfall-saved", count: lessons.length },
          });
        }).catch(() => { /* 沉淀失败无妨 */ });
      }

      // 日志已流式推送；这里回传最终产物 + 精简日志（去掉可能很大的 data 字段）。
      const finalResult = {
        status: result.status,
        workflowJson: result.workflowJson,
        analysis: result.analysis,
        images: result.images,
        videos: result.videos,
        outputType: result.outputType,
        iterations: result.iterations,
        log: result.log.map((e) => ({ type: e.type, iteration: e.iteration, message: e.message })),
      };
      // 兜底：把最终结果经 socket 再送一份（隧道下 HTTP 可能已超时切断，socket 仍能送达）+ 缓存供重载。
      // 客户端据此在 network error 后自动回填，不再丢失已跑通的工作流。
      emitSuperAgentEvent(input.projectId, input.nodeId, { type: "result", message: "__final_result__", data: finalResult });
      cacheBuildResult(key, finalResult);
      return finalResult;
    }),

  // 兜底重载：客户端在长请求被隧道切断（network error）后，据此拉取服务端已跑完的最终结果。
  getBuildResult: managerProc
    .input(z.object({ projectId: z.number(), nodeId: z.string().max(64) }))
    .query(({ input }) => {
      const c = buildResults.get(jobKey(input.projectId, input.nodeId));
      return { result: c ? c.result : null };
    }),

  // ── 工作流经验记忆体（多方查询/管理）。永不自动过期，只手动删除/清空。L3+ 可读可管。 ──
  listWorkflowMemory: managerProc
    .input(z.object({ baseUrl: z.string().max(512).optional() }).optional())
    .query(async ({ input }) => {
      const rows = await listWorkflowExperiences(input?.baseUrl);
      // 不回传完整 workflowJson（可能很大）；给摘要 + 长度，详情按需再取。
      return rows.map((r) => ({
        id: r.id, baseUrl: r.baseUrl, task: r.task, status: r.status, nodeClasses: r.nodeClasses,
        outputType: r.outputType, usageCount: r.usageCount, createdAt: r.createdAt,
        workflowJsonLength: r.workflowJson.length,
        failReasons: r.meta?.failReasons ?? null, lessons: r.meta?.lessons ?? null,
      }));
    }),

  searchWorkflowMemory: managerProc
    .input(z.object({ query: z.string().max(200), baseUrl: z.string().max(512).optional(), limit: z.number().int().min(1).max(200).optional() }))
    .query(async ({ input }) => {
      const rows = await searchWorkflowExperiences(input.query, input.baseUrl, input.limit ?? 50);
      return rows.map((r) => ({
        id: r.id, baseUrl: r.baseUrl, task: r.task, status: r.status, nodeClasses: r.nodeClasses,
        outputType: r.outputType, usageCount: r.usageCount, createdAt: r.createdAt,
        workflowJsonLength: r.workflowJson.length,
        failReasons: r.meta?.failReasons ?? null, lessons: r.meta?.lessons ?? null,
      }));
    }),

  // 取一条经验的完整 workflowJson（前端「查看/套用」用）。
  getWorkflowMemory: managerProc
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const rows = await listWorkflowExperiences();
      const r = rows.find((x) => x.id === input.id);
      return r ? { id: r.id, task: r.task, workflowJson: r.workflowJson, nodeClasses: r.nodeClasses, outputType: r.outputType, createdAt: r.createdAt } : null;
    }),

  deleteWorkflowMemory: managerProc
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await deleteWorkflowExperience(input.id);
      writeAuditLog({ ctx, action: "superagent_workflow_memory_delete", detail: { id: input.id } });
      return { ok: true as const };
    }),

  clearWorkflowMemory: managerProc
    .input(z.object({ baseUrl: z.string().max(512).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      await clearWorkflowExperiences(input?.baseUrl);
      writeAuditLog({ ctx, action: "superagent_workflow_memory_clear", detail: { baseUrl: input?.baseUrl ?? "ALL" } });
      return { ok: true as const };
    }),

  // 是否可用（前端据此显示/隐藏「代码任务」入口）。任何 L3+ 都能查询状态。
  codeStatus: managerProc.query(() => ({ enabled: isCodeAgentEnabled(), bashAllowed: isBashAllowed() })),

  // Phase 2：无头 Claude Code 编码任务（受限工作目录 + commandPolicy）。
  // 权限：超级管理员 L4；且需开启「代码任务」（后台「工程智能体权限」或 env SUPER_AGENT_CODE_ENABLED=1；默认关闭、完全 inert）。
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
        /** 连续对话：续接本节点上一轮的 claude 会话（复用工作区 + --resume），claude 保留完整上下文与文件。 */
        resume: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      if (!isCodeAgentEnabled()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "代码智能体未启用：请在管理后台「配置体检 › 工程智能体权限」开启「代码任务」（或服务端设置 SUPER_AGENT_CODE_ENABLED=1，并按需放行 Bash）" });
      }

      sweepStaleCodeSessions();
      const key = jobKey(input.projectId, input.nodeId);
      // 续接：复用本节点持久工作区 + 上轮会话 id；否则开一次新会话（先删旧工作区）。
      const prior = codeSessions.get(key);
      const resuming = input.resume === true && !!prior && existsSync(prior.dir);
      let resumeSessionId: string | undefined;
      let workspace: string;
      if (resuming && prior) {
        workspace = prior.dir;
        resumeSessionId = prior.sessionId;
      } else {
        if (prior) disposeCodeSession(key); // 新会话：清掉上一段
        workspace = mkdtempSync(join(tmpdir(), "superagent-code-"));
      }
      const emit = (e: { type: string; message: string; data?: unknown }) => emitSuperAgentEvent(input.projectId, input.nodeId, e);
      let keepWorkspace = false;
      try {
        const handle = streamClaudeCode({
          task: frameCodeTask(input.task, resuming), // 首轮前置沙箱边界说明；续接不重复
          cwd: workspace,
          timeoutMs: (input.timeoutSec ?? 300) * 1000,
          argsBuilder: (policy) => buildClaudeArgs({
            ...policy,
            addDirs: [workspace],
            model: input.model,
            maxBudgetUsd: input.maxBudgetUsd ?? 2,
            resumeSessionId,
          }),
        });
        runningJobs.set(key, () => handle.kill()); // 取消=杀进程

        const result = await runCodeAgent({ lines: handle.lines, emit, onAbort: () => handle.kill() });
        handle.kill();
        const proc = await handle.done;
        const stderr = handle.stderr();
        const spawnError = handle.spawnError();

        // 拿到会话 id（新的或沿用上轮）→ 保留工作区并刷新使用时间，供下一轮 --resume 续接。
        // 续接工作区即使本轮失败也保留（否则一次失败毁掉整段连续对话）；新建工作区仅成功时保留。
        const newSessionId = result.sessionId ?? resumeSessionId;
        keepWorkspace = shouldKeepWorkspace({ hasSession: !!newSessionId, resuming, spawnError: !!spawnError });
        if (keepWorkspace && newSessionId) {
          codeSessions.set(key, { dir: workspace, sessionId: newSessionId, lastUsed: Date.now() });
        }

        // 失败/无结果时，把 claude 的 stderr / spawn 错误作为诊断信息浮出（认证失败、
        // 找不到 claude、Windows .cmd 坑、模型报错等真正原因大多在这里）。
        const failed = result.status === "failed" || result.status === "aborted";
        const diag = spawnError
          ? `无法启动 claude（${spawnError}）——检查 CLAUDE_BIN 是否指向 claude.cmd、Windows spawn 修复是否已更新重启。`
          : (failed && !result.result && stderr.trim()) ? stderr.trim().slice(-1500)
          : (failed && !result.result && proc.exitCode) ? `claude 退出码 ${proc.exitCode}${proc.timedOut ? "（超时）" : ""}，无输出。可能是认证未生效——在服务器命令行手测 \`claude -p "hi"\`。`
          : undefined;

        writeAuditLog({
          ctx,
          action: "superagent_code_task",
          detail: { projectId: input.projectId, task: input.task.slice(0, 200), status: result.status, blockedCommand: result.blockedCommand ?? null, costUsd: result.costUsd ?? null, numTurns: result.numTurns ?? null, exitCode: proc.exitCode, timedOut: proc.timedOut, spawnError, stderrTail: stderr.slice(-800) || null },
        });

        return {
          status: result.status,
          result: result.result ?? diag,
          blockedCommand: result.blockedCommand,
          costUsd: result.costUsd,
          numTurns: result.numTurns,
          timedOut: proc.timedOut,
          diagnostic: diag,
          sessionId: newSessionId, // 供前端保存，下一轮传 resume:true 续接
          log: result.events.map((e) => ({ type: e.type, message: e.message })),
        };
      } finally {
        runningJobs.delete(key);
        // 保留工作区供续接（会话登记表持有）；否则删掉这次一次性工作区。
        if (!keepWorkspace) { try { rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ } }
      }
    }),

  // 结束代码任务的连续对话：删掉该节点的持久工作区并清登记（前端「新对话」按钮）。
  resetCodeSession: superProc
    .input(z.object({ projectId: z.number(), nodeId: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      disposeCodeSession(jobKey(input.projectId, input.nodeId));
      return { ok: true as const };
    }),

  // 取消某节点上正在运行的任务（comfy=下一轮终止；code=杀进程）。L3+ 即可取消。
  cancel: managerProc
    .input(z.object({ projectId: z.number(), nodeId: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      const cancelFn = runningJobs.get(jobKey(input.projectId, input.nodeId));
      if (!cancelFn) return { cancelled: false as const };
      cancelFn();
      return { cancelled: true as const };
    }),
});
