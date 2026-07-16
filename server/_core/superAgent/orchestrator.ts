// 工程智能体「编排器」(B 阶段)：把一个复杂目标自动拆成若干 ComfyUI 子任务，逐个派给工程智能体
// 引擎（runComfyAgent）搭建调通，失败自动重试一次（把失败原因喂回换方案），全程带记忆体（召回经验/
// 已知坑、沉淀成功/失败、自愈剪枝）。这是「画布助手全自动指挥工程智能体多轮完成复杂任务」的服务端核心。
//
// 复用既有模块：createComfyTools / createAgentLLM（适配层）、runComfyAgent（引擎）、comfyExperience（记忆）。
// 不改动 buildComfyWorkflow（隧道超时/socket 兜底逻辑保持不动），编排器自成一套简洁循环。
import { runComfyAgent, extractRunLessons, type AgentEvent, type ComfyAgentTools, type AgentLLM } from "./comfyAgent";
import {
  recallWorkflowExperiences, recallPitfalls, recordWorkflowExperience, recordWorkflowFailure, pruneResolvedPitfalls,
} from "../comfyExperience";

export interface OrchestrationSubtask { title: string; task: string }
export interface OrchestrationSubResult {
  title: string; task: string;
  status: "success" | "failed" | "exhausted" | "aborted";
  workflowJson?: string; images?: string[]; videos?: string[]; outputType?: "image" | "video";
  iterations: number; retried: boolean; error?: string;
}
export interface OrchestrationResult {
  goal: string;
  subtasks: OrchestrationSubResult[];
  successCount: number;
}

const clip = (s: string, n = 4000) => (s.length > n ? s.slice(0, n) + "…" : s);

/** 从 LLM 文本里稳健解析 {subtasks:[{title,task}]}；失败回退为「整个目标当单个子任务」。纯函数，便于单测。 */
export function parseSubtasks(text: string, goal: string, max: number): OrchestrationSubtask[] {
  const tryParse = (s: string): OrchestrationSubtask[] | null => {
    try {
      const obj = JSON.parse(s) as { subtasks?: unknown };
      const arr = Array.isArray(obj?.subtasks) ? obj.subtasks : Array.isArray(obj) ? (obj as unknown[]) : null;
      if (!arr) return null;
      const out = arr
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          const task = typeof o.task === "string" ? o.task.trim() : typeof o.description === "string" ? o.description.trim() : "";
          const title = typeof o.title === "string" && o.title.trim() ? o.title.trim() : task.slice(0, 40);
          return task ? { title, task } : null;
        })
        .filter((x): x is OrchestrationSubtask => !!x);
      return out.length ? out : null;
    } catch { return null; }
  };
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const cands = [fenced?.[1], (() => { const a = text.indexOf("{"), b = text.lastIndexOf("}"); return a !== -1 && b > a ? text.slice(a, b + 1) : undefined; })()].filter(Boolean) as string[];
  for (const c of cands) { const r = tryParse(c); if (r) return r.slice(0, max); }
  // 兜底：拆不出就把整个目标当一个子任务，绝不空手。
  return [{ title: goal.slice(0, 40), task: goal }];
}

const DECOMPOSE_SYSTEM =
  "你是 ComfyUI 工程编排师。把用户的复杂目标拆解为【相互独立、可分别在 ComfyUI 上搭建调通】的若干子任务" +
  "（每个子任务 = 一份可独立跑通的工作流，如「文生图出关键帧」「图生视频」「高清放大」等）。" +
  '只返回一个 JSON：{"subtasks":[{"title":"简短标题","task":"给工程智能体的详细工作流描述（出图/出视频、用什么大模型/LoRA/风格/分辨率/关键节点）"}]}。' +
  "子任务要少而精、按执行顺序排列，不要把一件事拆得过碎。";

/** 用 LLM 把复杂目标拆成子任务清单。 */
export async function decomposeGoal(llm: AgentLLM, goal: string, max: number): Promise<OrchestrationSubtask[]> {
  const raw = await llm.complete([
    { role: "system", content: DECOMPOSE_SYSTEM },
    { role: "user", content: `目标：${goal}\n最多拆成 ${max} 个子任务。` },
  ]);
  return parseSubtasks(raw, goal, max);
}

export interface RunOrchestrationOptions {
  goal: string;
  /** 单服务器（向后兼容）。多服务器负载均衡请用 servers + makeTools。 */
  baseUrl: string;
  tools: ComfyAgentTools;
  llm: AgentLLM;
  /** #162 多服务器：编排把子任务在这些服务器间负载均衡分配（并行、择空闲）。缺省=[baseUrl] 单机。 */
  servers?: string[];
  /** #162 每台服务器一套工具（createComfyTools(baseUrl) + 该机安装工具）。缺省对所有服务器复用 tools。 */
  makeTools?: (baseUrl: string) => ComfyAgentTools;
  maxSubtasks?: number;
  maxIterations?: number;
  useMemory?: boolean;
  /** 取消信号：置位后不再开始新子任务。 */
  signal?: { aborted: boolean };
  emit?: (e: AgentEvent) => void;
  /** 便于单测：注入自定义子任务拆解器（默认用 LLM decomposeGoal）。 */
  decompose?: (llm: AgentLLM, goal: string, max: number) => Promise<OrchestrationSubtask[]>;
  /** B1 产物验收：每个子任务 execute 成功后质检产物（入参=该子任务原始描述 + 产物），
   *  未过由引擎把拒因喂回修一轮（每次 run 仅拒一次，见 runComfyAgent.verifyProduct）。 */
  verifyProduct?: (subtaskTask: string, r: { images: string[]; videos: string[] }) => Promise<{ ok: boolean; reasons: string[] }>;
}

const normServer = (u: string) => u.replace(/\/+$/, "").trim();

/** 编排主流程：分解 → 子任务在多台 ComfyUI 服务器间负载均衡搭建（失败换机重试一次）→ 记忆沉淀/召回/剪枝 → 汇总。 */
export async function runOrchestration(opts: RunOrchestrationOptions): Promise<OrchestrationResult> {
  const { goal, llm } = opts;
  const maxSubtasks = Math.min(Math.max(opts.maxSubtasks ?? 6, 1), 12);
  const maxIterations = opts.maxIterations ?? 20;
  const useMemory = opts.useMemory !== false;
  const emit = opts.emit ?? (() => {});
  const decompose = opts.decompose ?? decomposeGoal;
  // 服务器池：多台去重归一化；缺省单机（= baseUrl）。makeTools 缺省对所有机复用传入的 tools。
  const servers = Array.from(new Set((opts.servers && opts.servers.length ? opts.servers : [opts.baseUrl]).map(normServer).filter(Boolean)));
  const makeTools = opts.makeTools ?? (() => opts.tools);
  const toolsCache = new Map<string, ComfyAgentTools>();
  const toolsFor = (s: string) => { let t = toolsCache.get(s); if (!t) { t = makeTools(s); toolsCache.set(s, t); } return t; };

  emit({ type: "action", iteration: 0, message: "编排：分解复杂目标为子任务…" });
  const subtasks = (await decompose(llm, goal, maxSubtasks)).slice(0, maxSubtasks);
  emit({ type: "action", iteration: 0, message: `编排：拆出 ${subtasks.length} 个子任务${servers.length > 1 ? `，将在 ${servers.length} 台服务器间负载均衡` : ""}`, data: { subtasks: subtasks.map((s) => s.title), servers: servers.length } });

  // 每台服务器的资源（供记忆召回/剪枝），懒取一次。
  const resCache = new Map<string, Awaited<ReturnType<ComfyAgentTools["listResources"]>> | null>();
  const resFor = async (s: string) => {
    if (resCache.has(s)) return resCache.get(s)!;
    const r = await toolsFor(s).listResources().catch(() => null);
    resCache.set(s, r); return r;
  };
  // 负载计数：择当前在飞子任务最少的服务器（简单显卡池均衡）。
  const load = new Map<string, number>(servers.map((s) => [s, 0]));
  const pickServer = (exclude?: string) => {
    const pool = servers.filter((s) => s !== exclude);
    const cands = pool.length ? pool : servers;
    return cands.reduce((best, s) => ((load.get(s) ?? 0) < (load.get(best) ?? 0) ? s : best), cands[0]);
  };

  const results: (OrchestrationSubResult | undefined)[] = new Array(subtasks.length);

  const runSubtaskOnce = (server: string, st: OrchestrationSubtask, tag: string, task: string, pitfalls: string[], referenceExamples: { label: string; workflowJson: string }[]) =>
    runComfyAgent({
      task, tools: toolsFor(server), llm, maxIterations, signal: opts.signal,
      emit: (e) => emit({ ...e, message: `${tag}${servers.length > 1 ? `@${server}` : ""} · ${e.message}` }),
      referenceExamples, knownPitfalls: pitfalls,
      // 产物验收用子任务的原始描述（st.task）做符合度判定，不用带教训重试时改写过的 task。
      verifyProduct: opts.verifyProduct ? (r) => opts.verifyProduct!(st.task, r) : undefined,
    });

  const processSubtask = async (i: number) => {
    if (opts.signal?.aborted) return;
    const st = subtasks[i];
    const tag = `[子任务 ${i + 1}/${subtasks.length}] ${st.title}`;
    let server = pickServer();
    load.set(server, (load.get(server) ?? 0) + 1);
    try {
      const curRes = await resFor(server);
      const pitfalls = useMemory ? await recallPitfalls(server, st.task, 10, curRes).catch(() => []) : [];
      const exp = useMemory ? await recallWorkflowExperiences(server, st.task, 2, 8000).catch(() => []) : [];
      const refs = exp.map((e) => ({ label: `经验·${e.label}`, workflowJson: e.workflowJson }));
      emit({ type: "action", iteration: i + 1, message: `${tag}：开始搭建${servers.length > 1 ? `（服务器 ${server}）` : ""}` });

      let r = await runSubtaskOnce(server, st, tag, st.task, pitfalls, refs);
      let retried = false;
      if (r.status !== "success" && r.status !== "aborted") {
        const lessons0 = extractRunLessons(r.log);
        if (lessons0.length) {
          retried = true;
          // 失败换机重试（多机时择另一台，均衡+规避个别机故障）。
          load.set(server, (load.get(server) ?? 1) - 1);
          const server2 = pickServer(server); server = server2;
          load.set(server, (load.get(server) ?? 0) + 1);
          emit({ type: "action", iteration: i + 1, message: `${tag}：首次未通过，带教训重试${servers.length > 1 ? `（改用服务器 ${server}）` : "一次"}` });
          const curRes2 = await resFor(server);
          const pitfalls2 = useMemory ? await recallPitfalls(server, st.task, 10, curRes2).catch(() => []) : [];
          r = await runSubtaskOnce(server, st, tag, `${st.task}\n\n（上次未成功，遇到的问题：${clip(lessons0.join("；"), 800)}。请换一种方案规避这些问题。）`, [...pitfalls2, ...lessons0], refs);
        }
      }

      const lessons = extractRunLessons(r.log);
      if (r.status === "success" && r.workflowJson) {
        void recordWorkflowExperience({
          baseUrl: server, task: st.task, workflowJson: r.workflowJson, outputType: r.outputType ?? null,
          meta: { images: r.images, videos: r.videos, iterations: r.iterations, lessons: lessons.length ? lessons : undefined },
        }).catch(() => {});
      } else if ((r.status === "failed" || r.status === "exhausted") && lessons.length) {
        void recordWorkflowFailure({ baseUrl: server, task: st.task, status: r.status, failReasons: lessons, workflowJson: r.workflowJson }).catch(() => {});
      }
      results[i] = {
        title: st.title, task: st.task, status: r.status,
        workflowJson: r.workflowJson, images: r.images, videos: r.videos, outputType: r.outputType,
        iterations: r.iterations, retried,
        error: r.status !== "success" ? (lessons[0] ?? "未调通") : undefined,
      };
      emit({ type: "tool_result", iteration: i + 1, message: `${tag}：${r.status === "success" ? "✅ 已调通" : "未调通"}`, data: { status: r.status, server } });
    } finally {
      load.set(server, Math.max(0, (load.get(server) ?? 1) - 1));
    }
  };

  // 并发度 = 服务器数（单机则串行，与原行为一致）。工作协程从共享游标取子任务，按 pickServer 均衡派机。
  let cursor = 0;
  const worker = async () => {
    while (!opts.signal?.aborted) {
      const i = cursor++;
      if (i >= subtasks.length) break;
      await processSubtask(i);
    }
  };
  await Promise.all(servers.map(() => worker()));

  // 自愈剪枝：对用过的每台服务器按其资源清理过时坑。
  for (const s of servers) { const r = resCache.get(s); if (r) void pruneResolvedPitfalls(s, r).catch(() => {}); }

  const out = results.filter((x): x is OrchestrationSubResult => !!x);
  const successCount = out.filter((r) => r.status === "success").length;
  emit({ type: "done", iteration: subtasks.length, message: `编排完成：${successCount}/${out.length} 个子任务调通${servers.length > 1 ? `（${servers.length} 台服务器）` : ""}` });
  return { goal, subtasks: out, successCount };
}
