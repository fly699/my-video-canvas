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

/** 拉取 /object_info 全量（每个节点类的输入/输出 schema）。best-effort，失败返回 null。 */
async function fetchObjectInfo(baseUrl: string): Promise<Record<string, unknown> | null> {
  try {
    const url = baseUrl.replace(/\/+$/, "") + "/object_info";
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 把一个输入项 `[typeSpec, opts?]` 拍平成一行给 LLM 看的字段说明（纯函数，便于单测）。 */
export function formatInputField(name: string, spec: unknown): string {
  const arr = Array.isArray(spec) ? spec : [spec];
  const typeSpec = arr[0];
  const optsObj = arr.length > 1 && arr[1] && typeof arr[1] === "object" ? (arr[1] as Record<string, unknown>) : undefined;
  const def = optsObj && "default" in optsObj ? optsObj.default : undefined;
  const defSuffix = def !== undefined ? `=${JSON.stringify(def)}` : "";
  if (Array.isArray(typeSpec)) {
    // 枚举输入：第一元素是合法值数组。
    const vals = typeSpec.map((v) => String(v));
    const shown = vals.slice(0, 24).join(",");
    const more = vals.length > 24 ? `,…(+${vals.length - 24})` : "";
    return `${name}: 枚举{${shown}${more}}${def !== undefined ? ` 默认${JSON.stringify(def)}` : ""}`;
  }
  const t = String(typeSpec ?? "?");
  const isValue = ["INT", "FLOAT", "STRING", "BOOLEAN", "NUMBER"].includes(t.toUpperCase());
  return isValue ? `${name}: ${t}${defSuffix}` : `${name}: <${t}>(连线)`;
}

/** 把 /object_info 里指定若干节点类的 schema 格式化成人类可读文本（纯函数，便于单测）。 */
export function formatNodeSchemas(info: Record<string, unknown> | null, classNames: string[]): string {
  if (!info) return "无法连接 /object_info，拿不到节点 schema；请凭常见字段 author，靠 validate 报错修正。";
  const blocks: string[] = [];
  for (const cls of classNames) {
    const entry = info[cls] as { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> }; output?: unknown[]; output_name?: unknown[] } | undefined;
    if (!entry) { blocks.push(`【${cls}】未安装/不存在（服务器 /object_info 无此节点类）。`); continue; }
    const req = entry.input?.required ?? {};
    const opt = entry.input?.optional ?? {};
    const reqLines = Object.entries(req).map(([n, s]) => formatInputField(n, s));
    const optLines = Object.entries(opt).map(([n, s]) => formatInputField(n, s));
    const outs = (entry.output_name?.length ? entry.output_name : entry.output) ?? [];
    const lines = [`【${cls}】 输出: ${(outs as unknown[]).map(String).join(", ") || "（无）"}`];
    if (reqLines.length) lines.push(`  必填: ${reqLines.join("；")}`);
    if (optLines.length) lines.push(`  可选: ${optLines.join("；")}`);
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n");
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
  // /object_info 全量拉一次即缓存：listResources 取键作节点目录、describeNodes 取每类 schema，共用。
  let objectInfoPromise: Promise<Record<string, unknown> | null> | null = null;
  const objectInfo = () => (objectInfoPromise ??= fetchObjectInfo(baseUrl));
  return {
    async listResources() {
      const [models, info] = await Promise.all([
        fetchComfyModels(baseUrl).catch(() => null),
        objectInfo(),
      ]);
      return {
        checkpoints: models?.ckpts ?? [],
        loras: models?.loras ?? [],
        vaes: models?.vaes ?? [],
        samplers: models?.samplers ?? [],
        schedulers: models?.schedulers ?? [],
        nodeClasses: info ? Object.keys(info) : [],
      };
    },
    async describeNodes(classNames) {
      return formatNodeSchemas(await objectInfo(), classNames);
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
