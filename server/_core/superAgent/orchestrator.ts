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
  baseUrl: string;
  tools: ComfyAgentTools;
  llm: AgentLLM;
  maxSubtasks?: number;
  maxIterations?: number;
  useMemory?: boolean;
  /** 取消信号：置位后不再开始新子任务。 */
  signal?: { aborted: boolean };
  emit?: (e: AgentEvent) => void;
  /** 便于单测：注入自定义子任务拆解器（默认用 LLM decomposeGoal）。 */
  decompose?: (llm: AgentLLM, goal: string, max: number) => Promise<OrchestrationSubtask[]>;
}

/** 编排主流程：分解 → 逐个子任务搭建（失败重试一次）→ 记忆沉淀/召回/剪枝 → 汇总。 */
export async function runOrchestration(opts: RunOrchestrationOptions): Promise<OrchestrationResult> {
  const { goal, baseUrl, tools, llm } = opts;
  const maxSubtasks = Math.min(Math.max(opts.maxSubtasks ?? 6, 1), 12);
  const maxIterations = opts.maxIterations ?? 20;
  const useMemory = opts.useMemory !== false;
  const emit = opts.emit ?? (() => {});
  const decompose = opts.decompose ?? decomposeGoal;

  emit({ type: "action", iteration: 0, message: "编排：分解复杂目标为子任务…" });
  const subtasks = (await decompose(llm, goal, maxSubtasks)).slice(0, maxSubtasks);
  emit({ type: "action", iteration: 0, message: `编排：拆出 ${subtasks.length} 个子任务`, data: { subtasks: subtasks.map((s) => s.title) } });

  const curRes = await tools.listResources().catch(() => null);
  const results: OrchestrationSubResult[] = [];

  for (let i = 0; i < subtasks.length; i++) {
    if (opts.signal?.aborted) break;
    const st = subtasks[i];
    const tag = `[子任务 ${i + 1}/${subtasks.length}] ${st.title}`;
    emit({ type: "action", iteration: i + 1, message: `${tag}：开始搭建` });

    const pitfalls = useMemory ? await recallPitfalls(baseUrl, st.task, 10, curRes).catch(() => []) : [];
    const exp = useMemory ? await recallWorkflowExperiences(baseUrl, st.task, 2, 8000).catch(() => []) : [];
    const referenceExamples = exp.map((e) => ({ label: `经验·${e.label}`, workflowJson: e.workflowJson }));

    const runOnce = (task: string, extraPitfalls: string[]) => runComfyAgent({
      task, tools, llm, maxIterations, signal: opts.signal,
      emit: (e) => emit({ ...e, message: `${tag} · ${e.message}` }),
      referenceExamples, knownPitfalls: [...pitfalls, ...extraPitfalls],
    });

    let r = await runOnce(st.task, []);
    let retried = false;
    // 失败重试一次：把本次失败原因喂回，要求换方案（非用户取消、且有信息量时）。
    if (r.status !== "success" && r.status !== "aborted") {
      const lessons = extractRunLessons(r.log);
      if (lessons.length) {
        retried = true;
        emit({ type: "action", iteration: i + 1, message: `${tag}：首次未通过，带教训重试一次` });
        r = await runOnce(`${st.task}\n\n（上次未成功，遇到的问题：${clip(lessons.join("；"), 800)}。请换一种方案规避这些问题。）`, lessons);
      }
    }

    // 记忆沉淀（与是否使用记忆解耦，始终学习）。
    const lessons = extractRunLessons(r.log);
    if (r.status === "success" && r.workflowJson) {
      void recordWorkflowExperience({
        baseUrl, task: st.task, workflowJson: r.workflowJson, outputType: r.outputType ?? null,
        meta: { images: r.images, videos: r.videos, iterations: r.iterations, lessons: lessons.length ? lessons : undefined },
      }).catch(() => {});
    } else if ((r.status === "failed" || r.status === "exhausted") && lessons.length) {
      void recordWorkflowFailure({ baseUrl, task: st.task, status: r.status, failReasons: lessons, workflowJson: r.workflowJson }).catch(() => {});
    }

    results.push({
      title: st.title, task: st.task, status: r.status,
      workflowJson: r.workflowJson, images: r.images, videos: r.videos, outputType: r.outputType,
      iterations: r.iterations, retried,
      error: r.status !== "success" ? (lessons[0] ?? "未调通") : undefined,
    });
    emit({ type: "tool_result", iteration: i + 1, message: `${tag}：${r.status === "success" ? "✅ 已调通" : "未调通"}`, data: { status: r.status } });
  }

  // 自愈剪枝：按当前资源清理已解决的过时坑。
  if (curRes) void pruneResolvedPitfalls(baseUrl, curRes).catch(() => {});

  const successCount = results.filter((r) => r.status === "success").length;
  emit({ type: "done", iteration: subtasks.length, message: `编排完成：${successCount}/${results.length} 个子任务调通` });
  return { goal, subtasks: results, successCount };
}
