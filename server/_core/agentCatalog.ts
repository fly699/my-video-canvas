import type { NodeType, AgentOperation } from "../../shared/types";

// ── Agent node catalog ────────────────────────────────────────────────────────
// The curated set of node types the Copilot agent may create/configure, plus the
// payload fields it may set on each. This is the single source of truth for both
// the LLM system prompt (so the model only proposes real nodes/fields) and the
// server-side validation (so we drop anything hallucinated before it reaches the
// client). Intentionally a SUBSET of all node types — the agent orchestrates the
// creative pipeline (script → storyboard/prompt → image/video → post), not admin
// or niche nodes.

export interface AgentFieldSpec {
  name: string;
  type: "string" | "number" | "boolean";
  desc: string;
}

export interface AgentNodeSpec {
  type: NodeType;
  label: string;
  purpose: string;
  fields: AgentFieldSpec[];
  /** Downstream node types this one may connect to (mirrors connectionRules). */
  connectsTo: NodeType[];
}

export const AGENT_NODE_CATALOG: AgentNodeSpec[] = [
  {
    type: "script", label: "脚本", purpose: "影片剧本/梗概的创作与编辑",
    connectsTo: ["storyboard", "prompt", "ai_chat", "character"],
    fields: [
      { name: "synopsis", type: "string", desc: "故事梗概（一句话或一段）" },
      { name: "content", type: "string", desc: "完整剧本正文" },
      { name: "aiGenre", type: "string", desc: "类型，如 短视频/电影/广告片/MV" },
      { name: "aiStyle", type: "string", desc: "视觉风格，如 电影感/赛博朋克/写实" },
      { name: "aiMood", type: "string", desc: "情感基调，如 温暖治愈/紧张刺激" },
      { name: "aiSceneCount", type: "number", desc: "目标分镜数 2-12" },
      { name: "aiTargetModel", type: "string", desc: "目标生成模型，如 qwen/flux/wan_local/kling" },
    ],
  },
  {
    type: "storyboard", label: "分镜", purpose: "单个分镜的画面描述与生成提示词",
    connectsTo: ["image_gen", "video_task", "prompt", "comfyui_image", "comfyui_video"],
    fields: [
      { name: "description", type: "string", desc: "画面描述（中文，看到什么）" },
      { name: "promptText", type: "string", desc: "图像/视频生成提示词" },
      { name: "negativePrompt", type: "string", desc: "反向提示词" },
      { name: "cameraMovement", type: "string", desc: "运镜：static/pan-left/zoom-in 等" },
      { name: "duration", type: "number", desc: "时长（秒）" },
      { name: "lens", type: "string", desc: "焦段，如 35mm" },
      { name: "colorTone", type: "string", desc: "调色，如 暖色 teal-orange" },
    ],
  },
  {
    type: "prompt", label: "提示词", purpose: "纯文本提示词，向下游图像/视频节点传递（仅 ComfyUI 模式下作为每个镜头的提示词容器）",
    connectsTo: ["image_gen", "video_task", "comfyui_image", "comfyui_video", "comfyui_workflow"],
    fields: [
      { name: "positivePrompt", type: "string", desc: "正向提示词（输出至下游）" },
      { name: "negativePrompt", type: "string", desc: "反向提示词" },
      { name: "style", type: "string", desc: "风格" },
      { name: "aspectRatio", type: "string", desc: "画面比例，如 16:9 / 9:16" },
    ],
  },
  {
    type: "image_gen", label: "图像生成", purpose: "云端 AI 文/图生图",
    connectsTo: ["video_task", "asset"],
    fields: [
      { name: "prompt", type: "string", desc: "图像提示词" },
      { name: "negativePrompt", type: "string", desc: "反向提示词" },
      { name: "style", type: "string", desc: "风格" },
      { name: "aspectRatio", type: "string", desc: "比例，如 16:9" },
    ],
  },
  {
    type: "comfyui_image", label: "ComfyUI 图像", purpose: "本地 ComfyUI 文/图生图",
    connectsTo: ["video_task", "comfyui_video", "asset"],
    fields: [
      { name: "prompt", type: "string", desc: "正向提示词" },
      { name: "negPrompt", type: "string", desc: "反向提示词" },
    ],
  },
  {
    type: "comfyui_video", label: "ComfyUI 视频", purpose: "本地 ComfyUI 文/图生视频",
    connectsTo: ["merge", "asset"],
    fields: [
      { name: "prompt", type: "string", desc: "正向提示词" },
      { name: "negPrompt", type: "string", desc: "反向提示词" },
    ],
  },
  {
    type: "video_task", label: "视频任务", purpose: "云端 AI 文/图生视频",
    connectsTo: ["merge", "clip", "asset"],
    fields: [
      { name: "prompt", type: "string", desc: "视频提示词" },
    ],
  },
  {
    type: "merge", label: "合并", purpose: "把多个视频按顺序拼接成片",
    connectsTo: ["subtitle", "overlay", "asset"],
    fields: [
      { name: "transition", type: "string", desc: "转场：none/fade/dissolve" },
    ],
  },
  {
    type: "audio", label: "音频", purpose: "AI 配乐/配音或上传音频",
    connectsTo: ["merge", "clip"],
    fields: [
      { name: "audioCategory", type: "string", desc: "music 或 voice" },
    ],
  },
  {
    type: "comfyui_workflow", label: "ComfyUI 自定义", purpose: "本地/云 ComfyUI 自定义工作流，按模板库的模板生成图/视频",
    connectsTo: ["merge", "asset", "video_task", "comfyui_video"],
    fields: [
      { name: "templateId", type: "number", desc: "引用「已分析的 ComfyUI 模板」中的模板 id" },
      { name: "prompt", type: "string", desc: "正向提示词（写入模板的 positive 角色参数）" },
      { name: "negPrompt", type: "string", desc: "反向提示词（写入 negative 角色参数）" },
    ],
  },
  {
    type: "note", label: "便签", purpose: "说明/批注，可连接任意节点",
    connectsTo: [],
    fields: [{ name: "content", type: "string", desc: "便签文本" }],
  },
];

const SPEC_BY_TYPE = new Map(AGENT_NODE_CATALOG.map((s) => [s.type, s]));

// In "仅 ComfyUI 生成" mode these node types are excluded. The generation nodes
// (image_gen / video_task / audio / comfyui_image / comfyui_video) are dropped so
// generation must go through comfyui_workflow (a library template materialized
// into a workflow node). `storyboard` is also excluded here: its built-in "AI 生成
// 分镜" uses cloud image models (inconsistent with ComfyUI-only), so per-shot
// prompts are carried by `prompt` nodes instead (script → prompt → comfyui_workflow).
const COMFY_ONLY_EXCLUDED = new Set<NodeType>(["image_gen", "video_task", "audio", "comfyui_image", "comfyui_video", "storyboard"]);

/** Render the catalog as compact text for the LLM system prompt. In comfyOnly
 *  mode, the excluded generation nodes are dropped so the model can't pick them. */
export function catalogText(opts: { comfyOnly?: boolean } = {}): string {
  return AGENT_NODE_CATALOG
    .filter((s) => !(opts.comfyOnly && COMFY_ONLY_EXCLUDED.has(s.type)))
    .map((s) => {
      const fields = s.fields.map((f) => `${f.name}(${f.type}): ${f.desc}`).join("; ");
      const to = s.connectsTo.length ? s.connectsTo.join(", ") : "（无固定下游）";
      return `• ${s.type} 「${s.label}」— ${s.purpose}\n  可设字段: ${fields}\n  可连接到: ${to}`;
    })
    .join("\n");
}

/** Render analyzed-template knowledge for the system prompt (bounded). */
export function templateKnowledgeText(
  rows: { id: number; label: string; functionSummary: string; capabilities: string[]; outputType?: string; hasVideoOutput?: boolean }[],
  opts: { maxItems?: number; maxLen?: number } = {},
): string {
  const maxItems = opts.maxItems ?? 20;
  const maxLen = opts.maxLen ?? 2000;
  // Prefer video-capable + (implicitly) recently analyzed (caller pre-sorts).
  const lines = rows.slice(0, maxItems).map((r) => {
    const caps = r.capabilities?.length ? `[${r.capabilities.join("/")}]` : "";
    return `• id=${r.id} 「${r.label}」(${r.outputType ?? "?"}) ${caps} ${r.functionSummary}`.trim();
  });
  let out = lines.join("\n");
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

/**
 * Validate + sanitize one raw operation from the LLM. Returns a cleaned op, or
 * null if it is structurally invalid (unknown create nodeType, missing refs).
 * Create-op payloads are filtered to the spec's whitelisted fields.
 */
export function sanitizeOperation(
  raw: unknown,
  opts: { comfyOnly?: boolean; validTemplateIds?: Set<number> } = {},
): AgentOperation | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const op = o.op;
  if (op !== "create" && op !== "update" && op !== "connect" && op !== "delete") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  if (op === "create") {
    const nodeType = str(o.nodeType) as NodeType | undefined;
    if (!nodeType || !SPEC_BY_TYPE.has(nodeType)) return null;
    // comfyOnly: drop any generation node that isn't comfyui_workflow.
    if (opts.comfyOnly && COMFY_ONLY_EXCLUDED.has(nodeType)) return null;
    const spec = SPEC_BY_TYPE.get(nodeType)!;
    const allowed = new Set(spec.fields.map((f) => f.name));
    const payload: Record<string, unknown> = {};
    if (o.payload && typeof o.payload === "object") {
      for (const [k, v] of Object.entries(o.payload as Record<string, unknown>)) {
        if (allowed.has(k)) payload[k] = v;
      }
    }
    // Hard-guard comfyui_workflow templateId against the real analyzed-template set
    // so the model can't fabricate a template (e.g. an invented name with a made-up
    // / missing id that materializes into an empty, un-runnable shell node).
    if (nodeType === "comfyui_workflow" && opts.validTemplateIds) {
      const tid = payload.templateId != null ? Number(payload.templateId) : NaN;
      const hasValidTemplate = Number.isInteger(tid) && opts.validTemplateIds.has(tid);
      // comfyOnly: a workflow node is meaningless without a real template → drop.
      if (opts.comfyOnly && !hasValidTemplate) return null;
      // Any mode: a templateId that doesn't resolve is a hallucination → drop.
      if (payload.templateId != null && !hasValidTemplate) return null;
    }
    return {
      op: "create", nodeType, tempId: str(o.tempId), title: str(o.title),
      payload, note: str(o.note),
    };
  }
  if (op === "connect") {
    const sourceRef = str(o.sourceRef), targetRef = str(o.targetRef);
    if (!sourceRef || !targetRef) return null;
    return { op: "connect", sourceRef, targetRef, sourceHandle: str(o.sourceHandle), targetHandle: str(o.targetHandle), note: str(o.note) };
  }
  if (op === "update") {
    const targetRef = str(o.targetRef);
    if (!targetRef) return null;
    const payload = (o.payload && typeof o.payload === "object") ? (o.payload as Record<string, unknown>) : {};
    return { op: "update", targetRef, title: str(o.title), payload, note: str(o.note) };
  }
  // delete
  const targetRef = str(o.targetRef);
  if (!targetRef) return null;
  return { op: "delete", targetRef, note: str(o.note) };
}
