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
import { runComfyAgent, extractRunLessons, type ComfyAgentTools, type AgentEvent } from "../_core/superAgent/comfyAgent";
import { runOrchestration } from "../_core/superAgent/orchestrator";
import { createComfyTools, createAgentLLM, pickReferenceWorkflows, dedupeReferenceCandidates } from "../_core/superAgent/comfyAdapters";
import { pickLeastLoaded } from "../_core/superAgent/serverAssign";
import { parseGitHubRepo, cloneRepoInto, publicRemote } from "../_core/superAgent/gitClone";
import { emitSuperAgentEvent } from "../_core/superAgent/socket";
import { buildClaudeArgs, runCodeAgent, frameCodeTask, shouldKeepWorkspace, planCodeRepair, buildCodeRepairPrompt } from "../_core/superAgent/codeAgent";
import { streamClaudeCode, isCodeAgentEnabled, isBashAllowed } from "../_core/superAgent/claudeProcess";
import { getSuperAgentConfig } from "../_core/superAgent/config";
import { invalidateComfyKnowledge, getComfyKnowledge } from "../_core/comfyKnowledge";
import { runImageQc } from "../_core/imageQcCore";
import {
  recordWorkflowExperience, recallWorkflowExperiences, recordWorkflowFailure, recallPitfalls, pruneResolvedPitfalls,
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
/** 装完模型/节点后：强制重学资源记忆（拿到最新已装清单），并清理「缺件已补齐」的过时坑（自愈）。best-effort。 */
async function afterComfyInstall(baseUrl: string): Promise<void> {
  invalidateComfyKnowledge(baseUrl); // 资源记忆失效 → 下面 force 重学最新已装清单
  try {
    const k = await getComfyKnowledge(baseUrl, { force: true });
    await pruneResolvedPitfalls(baseUrl, k.resources);
  } catch { /* 重学/清理失败无妨，下次召回时也会自动跳过过时坑 */ }
}

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
      try { const r = await installModel(sid, url, dir as ModelDir, filename); if (r.ok) await afterComfyInstall(baseUrl); return { ok: r.ok, message: (r.output || "").slice(-500) }; }
      catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
    },
    installNode: async (gitUrl) => {
      if (!isValidGitUrl(gitUrl)) return { ok: false, message: "git 仓库 URL 未通过校验" };
      try { const r = await installCustomNode(sid, gitUrl); if (r.ok) await afterComfyInstall(baseUrl); return { ok: r.ok, message: (r.output || "").slice(-500) }; }
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

// #170 单份构建的「在飞负载」计数（按服务器 url）：无显式地址时择空闲机自分配，多节点并发自动均衡。
const serverLoad = new Map<string, number>();
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
        /** B1 产物验收：execute 成功后用视觉模型质检首张产物图（符合度/畸形/黑屏等硬伤），
         *  未过把原因喂回引擎修错循环（整个 run 仅拒一次）。默认关（额外一次视觉调用费用）。 */
        verifyOutput: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await assertComfyuiAllowed(ctx);

      // 地址解析：节点自定义 > 环境变量 COMFYUI_BASE_URL > 后台「全局服务器列表」（多台时按在飞负载
      // 最少自选，实现自动分配/均衡；#170）。此前只查到 ENV 就停——用户在后台设了「默认服务器」（存 DB
      // 全局列表）读不到、每个工程智能体节点都误报「未配置」（与 orchestrate/canvas resolveComfyBase 不一致的翻车）。
      let baseUrl = input.customBaseUrl?.trim() || ENV.comfyuiBaseUrl || "";
      if (!baseUrl) {
        const globals = await db.getComfyGlobalServers().catch(() => []);
        baseUrl = pickLeastLoaded(globals, serverLoad) ?? "";
      }
      if (!baseUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ComfyUI URL 未配置：请在管理后台「ComfyUI 服务器」页添加全局默认地址，或在节点里填写目标服务器/设置 COMFYUI_BASE_URL" });
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
      // 本次真实看到的服务器资源（useMemory=false 时 createComfyTools 已 force 读真机 → 这里拿到的是最新已装清单）。
      // 供「召回时剔除过时坑」+「构建结束按最新资源 prune 已解决的坑」共用，只取一次（内部有 knowledgePromise 复用）。
      const curRes = await tools.listResources().catch(() => null);
      let knownPitfalls: string[] = [];
      if (useMemory) {
        try {
          // 传入当前资源 → 召回时自动剔除「缺件已补齐」的过时坑（装上缺失节点/模型后不再误报）。
          knownPitfalls = await recallPitfalls(baseUrl, input.task, 10, curRes);
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
      serverLoad.set(baseUrl, (serverLoad.get(baseUrl) ?? 0) + 1); // #170 计入在飞负载（供无地址节点自分配择空闲机）
      let result;
      let buildRetried = false;
      try {
        const engineOpts = {
          task: input.task,
          tools,
          llm,
          maxIterations: input.maxIterations ?? 50,
          emit: (e: AgentEvent) => emitSuperAgentEvent(input.projectId, input.nodeId, e),
          signal,
          seedWorkflowJson: input.seedWorkflowJson,
          history: input.history,
          referenceExamples,
          showAllResources: input.showAllResources ?? true,
          knownPitfalls,
          // B1 产物验收：视觉模型质检首张产物图（runImageQc 与图像节点 A1 质检共用核心，
          // 门控/计费/日志经统一入口继承）。仅图像产物；无图（纯视频等）按通过处理。
          verifyProduct: input.verifyOutput ? async ({ images }: { images: string[] }) => {
            if (!images.length) return { ok: true, reasons: [] };
            const v = await runImageQc(ctx, { imageUrl: images[0], prompt: input.task.slice(0, 2000) });
            return { ok: v.pass, reasons: v.pass ? [] : [...v.issues, ...(v.suggestion ? [`修正建议：${v.suggestion}`] : [])] };
          } : undefined,
        };
        result = await runComfyAgent(engineOpts);
        // B1 批2：整轮未通（失败/耗尽，非用户取消）且有可诊断教训 → 带教训整体重试一次，
        // 与编排器子任务的「失败带教训重试」同机制（换方案重来常能救活卡死的运行）。
        if ((result.status === "failed" || result.status === "exhausted") && !signal.aborted) {
          const lessons0 = extractRunLessons(result.log);
          if (lessons0.length) {
            buildRetried = true;
            emitSuperAgentEvent(input.projectId, input.nodeId, {
              type: "action",
              message: `首轮未通过，带 ${lessons0.length} 条教训自动重试一次（换方案规避已知问题）…`,
              data: { kind: "build-retry", lessons: lessons0.slice(0, 5) },
            });
            const clipJoin = (arr: string[], n: number) => { const s = arr.join("；"); return s.length > n ? s.slice(0, n) + "…" : s; };
            result = await runComfyAgent({
              ...engineOpts,
              task: `${input.task}\n\n（上次未成功，遇到的问题：${clipJoin(lessons0, 800)}。请换一种方案规避这些问题。）`,
              knownPitfalls: [...knownPitfalls, ...lessons0],
            });
          }
        }
      } finally {
        runningJobs.delete(key);
        serverLoad.set(baseUrl, Math.max(0, (serverLoad.get(baseUrl) ?? 1) - 1));
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

      // 构建结束顺手「自愈剪枝」：按本次真实看到的资源删掉已补齐的过时坑。
      // 尤其「不用记忆」跑（useMemory=false，force 读真机拿到最新已装清单）等于一次「刷新记忆」——
      // 把之前误报的缺件坑清理掉。curRes 为空/资源缺失时 isPitfallReasonResolved 只会保留、绝不误删。
      if (curRes) {
        void pruneResolvedPitfalls(baseUrl, curRes).then((removed) => {
          if (removed > 0) emitSuperAgentEvent(input.projectId, input.nodeId, {
            type: "memory",
            message: `已自动清理 ${removed} 条过时的失败坑（相关缺失节点/模型现已就绪）。`,
            data: { kind: "pitfall-pruned", count: removed },
          });
        }).catch(() => { /* 剪枝失败无妨 */ });
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
        retried: buildRetried,
        log: result.log.map((e) => ({ type: e.type, iteration: e.iteration, message: e.message })),
      };
      // 兜底：把最终结果经 socket 再送一份（隧道下 HTTP 可能已超时切断，socket 仍能送达）+ 缓存供重载。
      // 客户端据此在 network error 后自动回填，不再丢失已跑通的工作流。
      emitSuperAgentEvent(input.projectId, input.nodeId, { type: "result", message: "__final_result__", data: finalResult });
      cacheBuildResult(key, finalResult);
      return finalResult;
    }),

  // 编排（B 阶段）：把一个复杂目标自动拆成若干 ComfyUI 子任务，逐个派给工程智能体搭建调通、失败自动
  // 重试，全程带记忆。这是「画布助手全自动指挥工程智能体多轮完成复杂任务」的服务端入口。权限同 build（L3+）。
  orchestrate: managerProc
    .input(
      z.object({
        projectId: z.number(),
        nodeId: z.string().max(64).optional(),
        goal: z.string().min(1).max(4000),
        customBaseUrl: z.string().max(512).optional(),
        model: z.string().max(64).optional(),
        maxSubtasks: z.number().int().min(1).max(12).optional(),
        maxIterations: z.number().int().min(1).max(60).optional(),
        useMemory: z.boolean().optional(),
        /** B1 产物验收：每个子任务 execute 成功后质检首张产物图，未过喂回修一轮（同 build）。默认关。 */
        verifyOutput: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "editor");
      await assertComfyuiAllowed(ctx);
      // #162 多服务器负载均衡：指定了 customBaseUrl 只用它；否则拉取全局服务器列表在多台间均衡分配。
      const explicit = input.customBaseUrl?.trim();
      let servers = explicit ? [explicit] : (await db.getComfyGlobalServers().catch(() => [])).map((s) => s.trim()).filter(Boolean);
      if (!servers.length && ENV.comfyuiBaseUrl) servers = [ENV.comfyuiBaseUrl];
      if (!servers.length) throw new TRPCError({ code: "BAD_REQUEST", message: "ComfyUI URL 未配置：请在管理后台添加全局服务器、或在节点填写目标服务器/设置 COMFYUI_BASE_URL" });
      const baseUrl = servers[0];

      const useMemory = input.useMemory !== false;
      // 每台服务器预解析安装工具（默认空）+ 各自一套 comfy 工具（记忆/资源按服务器归属）。
      const installByServer = new Map<string, Pick<ComfyAgentTools, "installModel" | "installNode">>();
      for (const s of servers) installByServer.set(s, await resolveInstallTools(ctx, s));
      const makeTools = (s: string): ComfyAgentTools => ({ ...createComfyTools({ baseUrl: s, projectId: input.projectId, nodeId: input.nodeId, useMemory }), ...(installByServer.get(s) ?? {}) });
      const llm = createAgentLLM(ctx, input.model);

      const signal = { aborted: false };
      const key = jobKey(input.projectId, input.nodeId);
      runningJobs.set(key, () => { signal.aborted = true; });
      let result;
      try {
        result = await runOrchestration({
          goal: input.goal, baseUrl, tools: makeTools(baseUrl), servers, makeTools, llm, signal, useMemory,
          maxSubtasks: input.maxSubtasks, maxIterations: input.maxIterations ?? 50,
          emit: (e) => emitSuperAgentEvent(input.projectId, input.nodeId, e),
          // B1 产物验收：按子任务描述质检首张产物图（与 build 同口径，runImageQc 统一门控/计费/日志）。
          verifyProduct: input.verifyOutput ? async (subtaskTask, { images }) => {
            if (!images.length) return { ok: true, reasons: [] };
            const v = await runImageQc(ctx, { imageUrl: images[0], prompt: subtaskTask.slice(0, 2000) });
            return { ok: v.pass, reasons: v.pass ? [] : [...v.issues, ...(v.suggestion ? [`修正建议：${v.suggestion}`] : [])] };
          } : undefined,
        });
      } finally {
        runningJobs.delete(key);
      }

      writeAuditLog({
        ctx, action: "superagent_comfy_build",
        detail: { projectId: input.projectId, task: `[编排] ${input.goal.slice(0, 180)}`, status: `${result.successCount}/${result.subtasks.length}`, iterations: result.subtasks.reduce((a, s) => a + s.iterations, 0), baseUrl },
      });

      const finalResult = { kind: "orchestration" as const, goal: result.goal, successCount: result.successCount, subtasks: result.subtasks };
      // 隧道兜底：socket 再送一份 + 缓存供 getBuildResult 重载。
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
        // 代码任务常把整段代码内联进 task（工件「运行」），8000 太小易触顶——放宽到 40000。
        task: z.string().min(1).max(40_000),
        model: z.string().max(64).optional(),
        /** 成本封顶（美元），1–20，默认 2。 */
        maxBudgetUsd: z.number().min(0.1).max(20).optional(),
        /** 硬超时（秒），30–900，默认 300。 */
        timeoutSec: z.number().int().min(30).max(900).optional(),
        /** 连续对话：续接本节点上一轮的 claude 会话（复用工作区 + --resume），claude 保留完整上下文与文件。 */
        resume: z.boolean().optional(),
        /** #173 连 GitHub：仓库定位（owner/repo 或 https://github.com/...），新会话时用 PAT 克隆进工作区。 */
        gitRepo: z.string().max(200).optional(),
        /** GitHub 访问令牌（PAT，用户自带）：不落库、仅本次克隆/推送用，日志脱敏。 */
        gitToken: z.string().max(256).optional(),
        /** 克隆分支（可选）。 */
        gitBranch: z.string().max(100).optional(),
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

      // #173 GitHub 连接参数校验：在建工作区之前完成（不依赖 workspace 的纯参数校验），
      // 避免校验失败时把已经 mkdtemp 出来的临时目录泄漏在磁盘上（B-BUG-2）。
      let gitRepoParsed: ReturnType<typeof parseGitHubRepo> | undefined;
      if (!resuming && input.gitRepo) {
        gitRepoParsed = parseGitHubRepo(input.gitRepo);
        if (!gitRepoParsed) throw new TRPCError({ code: "BAD_REQUEST", message: "GitHub 仓库地址无效（仅支持 github.com 的 owner/repo）" });
        if (!isBashAllowed()) throw new TRPCError({ code: "BAD_REQUEST", message: "连接 Git 仓库需服务端放行 Shell（SUPER_AGENT_CODE_ALLOW_BASH=1）" });
        if (!input.gitToken) throw new TRPCError({ code: "BAD_REQUEST", message: "缺少 GitHub 访问令牌（PAT）——请在设置里填写个人访问令牌" });
      }

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

      // #173 连 GitHub：新会话且带仓库 → 用 PAT 克隆进工作区（token 不落库、输出脱敏）。
      // 续接沿用已克隆的工作区，不重复克隆。克隆需放行 Shell（git 是外部命令）。参数校验已在上方完成。
      let clonedRepo: string | undefined;
      if (!resuming && input.gitRepo && gitRepoParsed) {
        const repo = gitRepoParsed;
        const cr = await cloneRepoInto(workspace, repo, input.gitToken!, input.gitBranch);
        emit({ type: cr.ok ? "action" : "error", message: cr.ok ? `📦 ${cr.message}` : `GitHub 克隆失败：${cr.message}` });
        if (!cr.ok) { try { rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ } throw new TRPCError({ code: "BAD_REQUEST", message: "GitHub 克隆失败：" + cr.message }); }
        clonedRepo = publicRemote(repo);
      }
      const taskWithRepo = clonedRepo
        ? `${input.task}\n\n（工作区已克隆 GitHub 仓库 ${clonedRepo}，就在当前目录；已配置好推送凭据，如需提交可 git add/commit/push。）`
        : input.task;

      let keepWorkspace = false;
      try {
        const capUsd = input.maxBudgetUsd ?? 2;
        let cancelled = false; // 用户取消（runningJobs 回调）→ 绝不自动修复重跑
        const runOnce = async (taskText: string, resumeId: string | undefined, budgetUsd: number) => {
          const handle = streamClaudeCode({
            task: taskText,
            cwd: workspace,
            timeoutMs: (input.timeoutSec ?? 300) * 1000,
            argsBuilder: (policy) => buildClaudeArgs({
              ...policy,
              addDirs: [workspace],
              model: input.model,
              maxBudgetUsd: budgetUsd,
              resumeSessionId: resumeId,
            }),
          });
          runningJobs.set(key, () => { cancelled = true; handle.kill(); }); // 取消=杀进程
          const result = await runCodeAgent({ lines: handle.lines, emit, onAbort: () => handle.kill() });
          handle.kill();
          const proc = await handle.done;
          return { result, proc, stderr: handle.stderr(), spawnError: handle.spawnError() };
        };

        // 首轮（首轮前置沙箱边界说明；续接不重复）。
        let round = await runOnce(frameCodeTask(taskWithRepo, resuming), resumeSessionId, capUsd);
        let { result, proc, stderr, spawnError } = round;
        let repaired = false;

        // B1 批2：真失败自动带错误 --resume 修一轮（取消/拦截/超时/spawn 失败/无会话不修；
        // 两轮合计成本 ≤ maxBudgetUsd，预算逻辑见 planCodeRepair）。
        const sid0 = result.sessionId ?? resumeSessionId;
        const plan = planCodeRepair({
          status: result.status, cancelled, blockedCommand: result.blockedCommand,
          timedOut: proc.timedOut, spawnError: !!spawnError, hasSession: !!sid0,
          costUsd: result.costUsd, maxBudgetUsd: capUsd,
        });
        if (plan.repair && sid0) {
          repaired = true;
          const firstCost = result.costUsd;
          emit({ type: "command", message: `⚙️ 首轮失败，自动带错误修复一轮（剩余预算 $${plan.budgetUsd}）…` });
          const errText = result.result?.trim() || stderr.trim().slice(-1200) || undefined;
          round = await runOnce(buildCodeRepairPrompt(errText), sid0, plan.budgetUsd!);
          ({ result, proc, stderr, spawnError } = round);
          // 两轮成本合并上报；修复轮未回会话 id 时沿用首轮的（同一会话续接）。
          if (firstCost != null || result.costUsd != null) result = { ...result, costUsd: (firstCost ?? 0) + (result.costUsd ?? 0) };
          if (!result.sessionId) result = { ...result, sessionId: sid0 };
        }

        // 拿到会话 id（新的或沿用上轮）→ 保留工作区并刷新使用时间，供下一轮 --resume 续接。
        // 续接工作区即使本轮失败也保留（否则一次失败毁掉整段连续对话）；新建工作区仅成功时保留。
        const newSessionId = result.sessionId ?? resumeSessionId;
        // 修复轮本质是 --resume 续接（首轮已建会话），按续接口径决定工作区去留。
        keepWorkspace = shouldKeepWorkspace({ hasSession: !!newSessionId, resuming: resuming || repaired, spawnError: !!spawnError });
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
          detail: { projectId: input.projectId, task: input.task.slice(0, 200), status: result.status, repaired, blockedCommand: result.blockedCommand ?? null, costUsd: result.costUsd ?? null, numTurns: result.numTurns ?? null, exitCode: proc.exitCode, timedOut: proc.timedOut, spawnError, stderrTail: stderr.slice(-800) || null },
        });

        return {
          status: result.status,
          result: result.result ?? diag,
          blockedCommand: result.blockedCommand,
          costUsd: result.costUsd,
          numTurns: result.numTurns,
          timedOut: proc.timedOut,
          repaired, // B1 批2：本次结果经过了一轮自动修复
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
