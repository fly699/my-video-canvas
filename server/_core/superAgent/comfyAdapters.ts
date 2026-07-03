// 超级智能体 · Phase 1 —— 用现有 comfyui.ts 过程兑现引擎所需的 ComfyAgentTools，
// 并用 invokeLLMWithKie 兑现 AgentLLM。全程 HTTP + LLM，无 shell/子进程。
import {
  fetchComfyModels,
  validateWorkflow,
  executeCustomWorkflow,
  analyzeWorkflow,
  type WorkflowValidationResult,
  type WorkflowValidationIssue,
} from "../comfyui";
import { invokeLLMWithKie } from "../llmWithKie";
import { extractTextContent } from "../llm";
import type { TrpcContext } from "../context";
import type { ComfyAgentTools, AgentLLM } from "./comfyAgent";

/** 把结构化的校验结果拍平成给 LLM 看的人类可读错误行（纯函数，便于单测）。 */
export function formatValidationErrors(r: WorkflowValidationResult): string[] {
  const out: string[] = [];
  const issue = (e: WorkflowValidationIssue) => {
    const opt = e.options && e.options.length ? `（合法值示例：${e.options.slice(0, 8).join(", ")}）` : "";
    const cur = e.current != null ? `当前="${e.current}" ` : "";
    return `节点 ${e.nodeId}(${e.classType}).${e.field}：${cur}${opt}`;
  };
  if (!r.objectInfoAvailable) {
    out.push("无法连接目标服务器 /object_info：跳过枚举/节点存在性预检，仅做结构检查（悬空连线仍会检出）。");
  }
  for (const n of r.missingNodes) out.push(`缺少节点类型（自定义节点未安装）：${n}`);
  for (const e of r.invalidEnums) out.push(`取值非法（该名字在服务器不存在）：${issue(e)}`);
  for (const e of r.missingRequired) out.push(`必填输入缺失（既没连线也没值）：${issue(e)}`);
  for (const e of r.danglingLinks) out.push(`悬空连线（指向不存在的节点）：${issue(e)}`);
  return out;
}

/** 直接取 /object_info 的键作为已安装节点类清单（best-effort，失败返回空）。 */
async function fetchNodeClasses(baseUrl: string): Promise<string[]> {
  try {
    const url = baseUrl.replace(/\/+$/, "") + "/object_info";
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const info = (await res.json()) as Record<string, unknown>;
    return Object.keys(info);
  } catch {
    return [];
  }
}

export interface ComfyToolsAdapterOptions {
  baseUrl: string;
  /** 官方云 ComfyUI 用 X-API-Key；本地自建为 undefined。 */
  apiKey?: string;
  projectId?: number;
  nodeId?: string;
}

/** 用 comfyui.ts 过程兑现引擎工具接口。 */
export function createComfyTools(opts: ComfyToolsAdapterOptions): ComfyAgentTools {
  const { baseUrl, apiKey, projectId, nodeId } = opts;
  return {
    async listResources() {
      const [models, nodeClasses] = await Promise.all([
        fetchComfyModels(baseUrl).catch(() => null),
        fetchNodeClasses(baseUrl),
      ]);
      return {
        checkpoints: models?.ckpts ?? [],
        loras: models?.loras ?? [],
        vaes: models?.vaes ?? [],
        samplers: models?.samplers ?? [],
        schedulers: models?.schedulers ?? [],
        nodeClasses,
      };
    },
    async validate(workflowJson) {
      try {
        const r = await validateWorkflow(workflowJson, baseUrl);
        return { ok: r.ok, errors: formatValidationErrors(r) };
      } catch (e) {
        // JSON 解析失败等 → 当作一条校验错误喂回，让 LLM 修正。
        return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
      }
    },
    async execute(workflowJson) {
      try {
        const { urls, outputType } = await executeCustomWorkflow(baseUrl, {
          workflowJson,
          paramValues: {},
          outputType: "auto",
          projectId,
          nodeId,
          apiKey,
        });
        return {
          ok: true,
          images: outputType === "image" ? urls : undefined,
          videos: outputType === "video" ? urls : undefined,
          outputType,
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    async analyze(workflowJson) {
      const a = await analyzeWorkflow(workflowJson, baseUrl);
      return {
        paramBindings: a.detectedParams,
        outputNodeIds: a.outputNodeIds,
        outputType: a.outputType,
      };
    },
  };
}

/** 用统一 LLM 入口兑现引擎的 AgentLLM。model 缺省时由 invokeLLMWithKie 走出厂默认。 */
export function createAgentLLM(ctx: TrpcContext, model?: string): AgentLLM {
  return {
    async complete(messages) {
      const res = await invokeLLMWithKie(ctx, { messages, model, maxTokens: 8000 });
      return extractTextContent(res);
    },
  };
}
