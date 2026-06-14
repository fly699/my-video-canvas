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
      { name: "logline", type: "string", desc: "一句话故事（25-35 字：主角+冲突+赌注）" },
      { name: "content", type: "string", desc: "完整剧本正文" },
      { name: "aiGenre", type: "string", desc: "类型，如 短视频/电影/广告片/MV" },
      { name: "aiStyle", type: "string", desc: "视觉风格，如 电影感/赛博朋克/写实" },
      { name: "aiMood", type: "string", desc: "情感基调，如 温暖治愈/紧张刺激" },
      { name: "aiSceneCount", type: "number", desc: "目标分镜数 2-12" },
      { name: "aiTargetModel", type: "string", desc: "目标生成模型，如 qwen/flux/wan_local/kling" },
    ],
  },
  {
    type: "character", label: "角色/场景", purpose: "可复用的角色（人物）或场景设定，连到分镜/生成节点以保持跨镜一致（脸/服装/特征）",
    connectsTo: ["storyboard", "image_gen", "video_task", "prompt", "comfyui_image", "comfyui_video"],
    fields: [
      { name: "characterKind", type: "string", desc: "person（人物）或 scene（场景）" },
      { name: "name", type: "string", desc: "角色姓名（人物）" },
      { name: "role", type: "string", desc: "职业/角色定位，如 主角/侦探" },
      { name: "appearance", type: "string", desc: "外貌描述（发型/脸型/体型等）" },
      { name: "outfit", type: "string", desc: "服装，如 黑色西装+红领带" },
      { name: "signature", type: "string", desc: "标志性物件/特征，如 银怀表/左眼疤痕" },
      { name: "sceneName", type: "string", desc: "场景名（characterKind=scene 时）" },
      { name: "sceneDescription", type: "string", desc: "场景描述（characterKind=scene 时）" },
    ],
  },
  {
    type: "storyboard", label: "分镜", purpose: "单个分镜（镜头表的一行）：画面描述、生成提示词与 Shot List 字段。镜头表面板可按这些字段一键批量生关键帧图/生视频/配音",
    connectsTo: ["image_gen", "video_task", "prompt", "comfyui_image", "comfyui_video", "audio"],
    fields: [
      { name: "sceneNumber", type: "number", desc: "镜号（1,2,3… 连续递增；「按镜头表装配」按它排序成片，必填）" },
      { name: "description", type: "string", desc: "画面描述（中文，给人看；生成提示词放 promptText，勿堆在此）" },
      { name: "promptText", type: "string", desc: "图像/视频生成提示词（必填，详细到可直接喂生成模型）" },
      { name: "negativePrompt", type: "string", desc: "反向提示词" },
      { name: "dialogue", type: "string", desc: "对白/旁白（格式「角色名：台词」，纯旁白直接写文本；批量配音直接取用）" },
      { name: "transition", type: "string", desc: "切到下一镜的转场：cut/fade/dissolve/wipe/match-cut（装配成片按它设逐切点转场）" },
      { name: "shotType", type: "string", desc: "景别：ECU/CU/MS/MLS/WS/establishing" },
      { name: "cameraMovement", type: "string", desc: "运镜：static/pan-left/zoom-in 等" },
      { name: "duration", type: "number", desc: "时长（秒）" },
      { name: "lens", type: "string", desc: "焦段，如 35mm" },
      { name: "lighting", type: "string", desc: "灯光，如 soft key + 轮廓光, golden hour" },
      { name: "sfx", type: "string", desc: "音效/氛围声意图，如 雨声+远雷" },
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
    type: "merge", label: "合并", purpose: "把多个视频拼接成片。上游视频若能回溯到分镜，用户可在节点上一键「按镜头表装配」（镜号排序 + 逐镜转场 + 配音对位），无需手动排序",
    connectsTo: ["subtitle", "overlay", "asset"],
    fields: [
      { name: "transition", type: "string", desc: "全局转场：none/fade/dissolve（逐镜转场由装配按分镜 transition 自动设置）" },
    ],
  },
  {
    type: "audio", label: "音频", purpose: "AI 配乐(music)/配音(dubbing)或上传音频。逐镜配音不要手建——镜头表面板会按分镜 dialogue 批量生成",
    connectsTo: ["merge", "clip"],
    fields: [
      { name: "audioCategory", type: "string", desc: "music（配乐）或 dubbing（配音）" },
      { name: "ttsText", type: "string", desc: "配音文案（audioCategory=dubbing 时）" },
      { name: "musicPrompt", type: "string", desc: "配乐描述（audioCategory=music 时），如 轻快钢琴+弦乐" },
    ],
  },
  {
    type: "comfyui_workflow", label: "ComfyUI 自定义", purpose: "本地/云 ComfyUI 自定义工作流，按模板库的模板生成图/视频",
    connectsTo: ["merge", "asset", "video_task", "comfyui_video", "comfyui_workflow"],
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
  rows: { id: number; label: string; functionSummary: string; capabilities: string[]; outputType?: string; hasVideoOutput?: boolean; shotSeconds?: number | null }[],
  opts: { maxItems?: number; maxLen?: number } = {},
): string {
  const maxItems = opts.maxItems ?? 20;
  const maxLen = opts.maxLen ?? 2000;
  // Prefer video-capable + (implicitly) recently analyzed (caller pre-sorts).
  const lines = rows.slice(0, maxItems).map((r) => {
    const caps = r.capabilities?.length ? `[${r.capabilities.join("/")}]` : "";
    // Per-shot duration cap for video templates so the agent can plan enough shots.
    const dur = r.shotSeconds && r.shotSeconds > 0 ? `, 每镜≈${r.shotSeconds % 1 === 0 ? r.shotSeconds : r.shotSeconds.toFixed(1)}s` : "";
    return `• id=${r.id} 「${r.label}」(${r.outputType ?? "?"}${dur}) ${caps} ${r.functionSummary}`.trim();
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
  const r = sanitizeOperationDetailed(raw, opts);
  return "op" in r ? r.op : null;
}

/**
 * Same validation as {@link sanitizeOperation} but distinguishes "kept" from
 * "dropped + why" so the agent can tell the user *which* of the LLM's proposed
 * operations were silently discarded (hallucinated node types, fabricated
 * template ids, malformed connects, …) instead of them just vanishing.
 */
export function sanitizeOperationDetailed(
  raw: unknown,
  opts: { comfyOnly?: boolean; validTemplateIds?: Set<number> } = {},
): { op: AgentOperation } | { drop: string } {
  if (!raw || typeof raw !== "object") return { drop: "无法识别的操作（非对象）" };
  const o = raw as Record<string, unknown>;
  const op = o.op;
  if (op !== "create" && op !== "update" && op !== "connect" && op !== "delete") return { drop: `未知的操作类型「${String(op)}」` };
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  // note 是给人看的一句话理由，行内展示——超长（LLM 跑偏）截到 120 字防撑爆消息存储。
  const noteStr = (v: unknown) => { const t = str(v); return t && t.length > 120 ? t.slice(0, 120) + "…" : t; };

  if (op === "create") {
    const nodeType = str(o.nodeType) as NodeType | undefined;
    if (!nodeType || !SPEC_BY_TYPE.has(nodeType)) return { drop: `不支持的节点类型「${String(o.nodeType)}」` };
    // comfyOnly: drop any generation node that isn't comfyui_workflow.
    if (opts.comfyOnly && COMFY_ONLY_EXCLUDED.has(nodeType)) return { drop: `「仅 ComfyUI」模式下不支持 ${nodeType} 节点` };
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
      if (opts.comfyOnly && !hasValidTemplate) return { drop: "ComfyUI 工作流节点缺少有效模板" };
      // Any mode: a templateId that doesn't resolve is a hallucination → drop.
      if (payload.templateId != null && !hasValidTemplate) return { drop: `引用了不存在的工作流模板（id=${String(payload.templateId)}）` };
    }
    return {
      op: {
        op: "create", nodeType, tempId: str(o.tempId), title: str(o.title),
        payload, note: noteStr(o.note), sceneGroup: str(o.sceneGroup),
      },
    };
  }
  if (op === "connect") {
    const sourceRef = str(o.sourceRef), targetRef = str(o.targetRef);
    if (!sourceRef || !targetRef) return { drop: "连接操作缺少起点或终点引用" };
    return { op: { op: "connect", sourceRef, targetRef, sourceHandle: str(o.sourceHandle), targetHandle: str(o.targetHandle), note: noteStr(o.note) } };
  }
  if (op === "update") {
    const targetRef = str(o.targetRef);
    if (!targetRef) return { drop: "修改操作缺少目标节点引用" };
    const payload = (o.payload && typeof o.payload === "object") ? (o.payload as Record<string, unknown>) : {};
    return { op: { op: "update", targetRef, title: str(o.title), payload, note: noteStr(o.note) } };
  }
  // delete
  const targetRef = str(o.targetRef);
  if (!targetRef) return { drop: "删除操作缺少目标节点引用" };
  return { op: { op: "delete", targetRef, note: noteStr(o.note) } };
}
