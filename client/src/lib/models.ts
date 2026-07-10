// 图像/视频模型清单已抽到 shared/modelCatalog（服务端画布助手目录同源消费）；
// 这里再导出以保持全站既有导入路径（ModelPicker / costEstimate / 管理后台等）不变。
import { IMAGE_MODELS } from "../../../shared/modelCatalog";
export { IMAGE_MODELS, VIDEO_MODELS, imageModelRequiresRef } from "../../../shared/modelCatalog";
export type { ImageModelMeta, VideoModelMeta } from "../../../shared/modelCatalog";

// ---------------------------------------------------------------------------
// LLM / chat models — single source of truth
// ---------------------------------------------------------------------------
// Used by ScriptNode (via LLMModelPicker re-export), AIChatNode, and the
// scriptCreationTemplates recommendedLlm references. The backend keeps a
// parallel AVAILABLE_MODELS list (server/_core/llm.ts) that must stay aligned
// (id set), since a const can't be shared across the client/server bundle
// boundary here.
//
// Routing (llm.ts resolveApiUrl): gpt* and claude-sonnet-4-5-20250929 → Poyo;
// others → Forge/Manus. The `provider` field below must match that routing.
// Cost is token-based, so we show a relative tier rather than a credit number.
// group = family for the classified picker. NEVER drop an id (old node
// payloads persist `aiLlmModel` / `model`); only add or mark hidden.
export type LLMModelMeta = {
  id: string;
  label: string;
  short: string;       // compact chip label
  family: "Gemini" | "Claude" | "GPT" | "Qwen";
  tag: string;
  provider: "Forge" | "Poyo" | "Kie" | "SelfHosted" | "Custom"; // upstream API the model is served by
  color: string;
  costTier: "低" | "中" | "高";
  /** 点数标注（kie 模型用真实价格，单位：点/百万tokens，入/出）。docs/kie-pricing.md。
   *  其它平台按 token 计费、无固定点数，留空只显示 costTier。 */
  costNote?: string;
  hidden?: boolean;    // kept for back-compat but not listed
  /** 是否支持图片输入（看图）。本部署里 Poyo 的 Claude 不接受 image_url、Forge 的 Claude
   *  也不稳定，故 Claude 系标记为非视觉；GPT / Gemini 支持。供「看图识人」等需要视觉的功能
   *  过滤模型选择器。 */
  vision?: boolean;
};

export const LLM_MODELS: readonly LLMModelMeta[] = [
  // 自建 LLM 模型不再写死在此——由管理员后台「模型管理 › 自建 LLM」配置，前端经
  // useSelfHostedLlmModels() 动态并入各选择器。
  // Gemini (Google) — routed to Forge
  { id: "gemini-3-flash-preview",    label: "Gemini 3 Flash",    short: "Gemini3", family: "Gemini", tag: "最新", provider: "Forge", color: "oklch(0.68 0.18 160)", costTier: "低", vision: true },
  // No longer served by the upstream gateway (returns unknown-model). Hidden from
  // the picker; the backend remaps this id to gemini-3-flash-preview (MODEL_ALIASES
  // in server/_core/llm.ts) so old node payloads still run. Kept here (not dropped)
  // so the persisted id still resolves for display.
  { id: "gemini-2.5-flash",          label: "Gemini 2.5 Flash",  short: "Gemini",  family: "Gemini", tag: "快速", provider: "Forge", color: "oklch(0.68 0.18 160)", costTier: "低", hidden: true },
  // Claude (Anthropic) — Sonnet 4.6 on Forge; Sonnet 4.5 is Poyo's Anthropic
  // model (docs/poyo-llm-api.md); Haiku on Forge.
  { id: "claude-sonnet-4-6",          label: "Claude Sonnet 4.6", short: "Sonnet", family: "Claude", tag: "旗舰", provider: "Forge", color: "oklch(0.68 0.18 280)", costTier: "高" },
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", short: "Sonnet", family: "Claude", tag: "默认", provider: "Poyo",  color: "oklch(0.68 0.18 280)", costTier: "高" },
  { id: "claude-haiku-4-5-20251001",  label: "Claude Haiku 4.5",  short: "Haiku",  family: "Claude", tag: "快速", provider: "Forge", color: "oklch(0.68 0.18 55)",  costTier: "低" },
  // GPT (OpenAI) — routed to Poyo
  { id: "gpt-5.2",                   label: "GPT-5.2",           short: "GPT-5.2", family: "GPT",    tag: "强力", provider: "Poyo",  color: "oklch(0.62 0.16 240)", costTier: "中", vision: true },
  // ── kie.ai chat (own key system; ids = kie wire model, server/_core/kieLLM.ts) ──
  { id: "kie_claude_opus_48",   label: "Claude Opus 4.8（kie）",   short: "Opus",   family: "Claude", tag: "kie·旗舰", provider: "Kie", color: "oklch(0.68 0.18 280)", costTier: "高", costNote: "入400/出2000" },
  { id: "kie_claude_opus_47",   label: "Claude Opus 4.7（kie）",   short: "Opus47", family: "Claude", tag: "kie",     provider: "Kie", color: "oklch(0.68 0.18 280)", costTier: "高", costNote: "入285/出1430" },
  { id: "kie_claude_opus_46",   label: "Claude Opus 4.6（kie）",   short: "Opus46", family: "Claude", tag: "kie",     provider: "Kie", color: "oklch(0.68 0.18 280)", costTier: "高", costNote: "入285/出1430" },
  { id: "kie_claude_opus_45",   label: "Claude Opus 4.5（kie）",   short: "Opus45", family: "Claude", tag: "kie",     provider: "Kie", color: "oklch(0.68 0.18 280)", costTier: "高", costNote: "入285/出1430" },
  { id: "kie_claude_sonnet_46", label: "Claude Sonnet 4.6（kie）", short: "Sonnet", family: "Claude", tag: "kie",     provider: "Kie", color: "oklch(0.68 0.18 280)", costTier: "高", costNote: "入170/出855" },
  { id: "kie_claude_sonnet_45", label: "Claude Sonnet 4.5（kie）", short: "Son45",  family: "Claude", tag: "kie",     provider: "Kie", color: "oklch(0.68 0.18 280)", costTier: "高", costNote: "入170/出855" },
  { id: "kie_claude_haiku_45",  label: "Claude Haiku 4.5（kie）",  short: "Haiku",  family: "Claude", tag: "kie·快",   provider: "Kie", color: "oklch(0.68 0.18 55)",  costTier: "低", costNote: "入55/出285" },
  { id: "kie_claude_fable_5",   label: "Claude Fable 5（kie）",    short: "Fable",  family: "Claude", tag: "kie",     provider: "Kie", color: "oklch(0.68 0.18 280)", costTier: "高", costNote: "入800/出4000" },
  { id: "kie_gemini_3_pro",     label: "Gemini 3 Pro（kie）",      short: "G3Pro",  family: "Gemini", tag: "kie",     provider: "Kie", color: "oklch(0.68 0.18 160)", costTier: "中", vision: true, costNote: "入100/出700" },
  { id: "kie_gemini_3_flash",   label: "Gemini 3 Flash（kie）",    short: "G3Flash",family: "Gemini", tag: "kie·快",   provider: "Kie", color: "oklch(0.68 0.18 160)", costTier: "低", vision: true, costNote: "入30/出180" },
  { id: "kie_gpt_5_5",          label: "GPT 5.5（kie）",           short: "GPT5.5", family: "GPT",    tag: "kie·旗舰", provider: "Kie", color: "oklch(0.62 0.16 240)", costTier: "高", vision: true, costNote: "入280/出1680" },
  { id: "kie_gpt_5_4",          label: "GPT 5.4（kie）",           short: "GPT5.4", family: "GPT",    tag: "kie",     provider: "Kie", color: "oklch(0.62 0.16 240)", costTier: "中", vision: true, costNote: "入140/出1120" },
  { id: "kie_gpt_5_2",          label: "GPT 5.2（kie）",           short: "GPT5.2", family: "GPT",    tag: "kie",     provider: "Kie", color: "oklch(0.62 0.16 240)", costTier: "中", vision: true, costNote: "入87.5/出700" },
  { id: "kie_gemini_31_pro",    label: "Gemini 3.1 Pro（kie）",    short: "G31Pro", family: "Gemini", tag: "kie",     provider: "Kie", color: "oklch(0.68 0.18 160)", costTier: "中", vision: true, costNote: "入100/出700" },
  { id: "kie_gemini_25_pro",    label: "Gemini 2.5 Pro（kie）",    short: "G25Pro", family: "Gemini", tag: "kie",     provider: "Kie", color: "oklch(0.68 0.18 160)", costTier: "中", vision: true, costNote: "入76/出600" },
  { id: "kie_gemini_25_flash",  label: "Gemini 2.5 Flash（kie）",  short: "G25Fl",  family: "Gemini", tag: "kie·快",   provider: "Kie", color: "oklch(0.68 0.18 160)", costTier: "低", vision: true, costNote: "入18/出150" },
  { id: "kie_gemini_35_flash",  label: "Gemini 3.5 Flash（kie）",  short: "G35Fl",  family: "Gemini", tag: "kie",     provider: "Kie", color: "oklch(0.68 0.18 160)", costTier: "中", vision: true, costNote: "入90/出540" },
  { id: "kie_gpt_5_codex",      label: "GPT 5 Codex（kie）",       short: "Codex5", family: "GPT",    tag: "kie·代码", provider: "Kie", color: "oklch(0.62 0.16 240)", costTier: "中", costNote: "入100/出800" },
  { id: "kie_gpt_51_codex",     label: "GPT 5.1 Codex（kie）",     short: "Cdx51",  family: "GPT",    tag: "kie·代码", provider: "Kie", color: "oklch(0.62 0.16 240)", costTier: "中", costNote: "入100/出800" },
  { id: "kie_gpt_52_codex",     label: "GPT 5.2 Codex（kie）",     short: "Cdx52",  family: "GPT",    tag: "kie·代码", provider: "Kie", color: "oklch(0.62 0.16 240)", costTier: "高", costNote: "入140/出1120" },
  { id: "kie_gpt_53_codex",     label: "GPT 5.3 Codex（kie）",     short: "Cdx53",  family: "GPT",    tag: "kie·代码", provider: "Kie", color: "oklch(0.62 0.16 240)", costTier: "高", costNote: "入140/出1120" },
  { id: "kie_gpt_54_codex",     label: "GPT 5.4 Codex（kie）",     short: "Cdx54",  family: "GPT",    tag: "kie·代码", provider: "Kie", color: "oklch(0.62 0.16 240)", costTier: "高", costNote: "入140/出1120" },
  // ── 自定义模型（用户自带 API Key，直连 OpenAI / Anthropic 官方端点）──
  // 密钥与底层模型名「前端工具栏录入 > 后端 env」解析；前端经请求头 x-openai-key /
  // x-anthropic-key（+ x-*-model）随所有 LLM 请求透传（main.tsx）。server/_core/customLlm.ts。
  { id: "custom_openai",        label: "ChatGPT（自定义密钥）",    short: "GPT·自", family: "GPT",    tag: "自带key", provider: "Custom", color: "oklch(0.62 0.16 240)", costTier: "中", vision: true },
  { id: "custom_claude",        label: "Claude（自定义密钥）",     short: "Cl·自",  family: "Claude", tag: "自带key", provider: "Custom", color: "oklch(0.68 0.18 280)", costTier: "高", vision: true },
] as const;

// Legacy export name — AIChatNode and scriptCreationTemplates reference CHAT_MODELS.
// Aliased to the unified list so there's a single source.
export const CHAT_MODELS = LLM_MODELS;

// ---------------------------------------------------------------------------

// ── 来源平台分色标签（统一所有节点的模型下拉「来源平台」注释）──────────────────
// 每个上游平台一种色相，所有节点的模型选择器统一用它渲染来源标签（Poyo/Kie/Forge…），
// 便于一眼区分。脚本/对话节点的 Forge/Poyo 绿/蓝即源于此。
const PLATFORM_HUE: Record<string, number> = {
  Poyo: 240, Manus: 160, Forge: 160, Higgsfield: 310, Kie: 200,
  Suno: 285, MiniMax: 30, OpenAI: 150, Local: 95, Dev: 20, SelfHosted: 200, Custom: 320, Groq: 25,
};
export function platformBadge(name: string): { bg: string; fg: string } {
  const h = PLATFORM_HUE[name] ?? 265;
  return { bg: `oklch(0.70 0.15 ${h} / 0.18)`, fg: `oklch(0.74 0.14 ${h})` };
}

// 模型下拉里「来源平台 / 分组」的排序优先级：**自建 LLM 置顶**（管理员自己配的基建、
// 零云成本，理应最显眼），其后内置(Manus/Forge)，再 **Kie 排在 Poyo 之前**，再到
// Higgsfield，最后 Dev。所有节点（图像 / 视频 / LLM）的下拉统一按此排序。
// 注意：SelfHosted 未登记时会落到默认值 4、被埋在长长的 kie 列表最底（用户配了却"看不到"），
// 故必须显式置顶（-1），与各 picker「self-hosted 数组前插」的本意一致。
const GROUP_ORDER: Record<string, number> = {
  // 自定义模型（用户自带 key）置于自建之后、内置之前——既显眼又不抢自建基建的头位。
  SelfHosted: -1, Groq: -0.8, Custom: -0.5, Manus: 0, Forge: 0, Kie: 1, Poyo: 2, Higgsfield: 3, Dev: 8,
};
export function modelGroupOrder(group: string): number {
  return GROUP_ORDER[group] ?? 4;
}


export type ChatModelId = typeof CHAT_MODELS[number]["id"];
export type ImageModelId = (typeof IMAGE_MODELS)[number]["value"];



// ── 字幕转录（STT）模型 ──────────────────────────────────────────────────────
// 经内置 Forge（OpenAI 兼容）转录代理调用；与 image/video 一样进「管理员模型管理」
// 可禁用、「节点默认模型」可设默认。计费为内置服务（不计 kie 点 / Poyo cr）。
export type TranscribeModelMeta = {
  value: string;
  label: string;
  desc: string;
  group: "Forge" | "Groq" | "SelfHosted";
  provider: "Forge" | "Groq" | "SelfHosted";
  costNote: string;
};
export const TRANSCRIBE_MODELS: readonly TranscribeModelMeta[] = [
  { value: "whisper-1",              label: "Whisper v1",          desc: "默认 · 稳定",  group: "Forge", provider: "Forge", costNote: "内置" },
  { value: "gpt-4o-transcribe",      label: "GPT-4o Transcribe",   desc: "更准",         group: "Forge", provider: "Forge", costNote: "内置" },
  { value: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe", desc: "更快 / 更省", group: "Forge", provider: "Forge", costNote: "内置" },
  // Groq / 自建 whisper：需把转写端点指过去（TRANSCRIBE_API_URL/KEY，见部署文档）。模型名与
  // OpenAI 不同，故单列——选它前确认端点已切到 Groq 或本机 whisper，否则会报「模型不存在」。
  { value: "whisper-large-v3",       label: "Whisper large-v3",     desc: "Groq/自建 · 词级", group: "Groq", provider: "Groq", costNote: "按端点" },
  { value: "whisper-large-v3-turbo", label: "Whisper large-v3 turbo", desc: "Groq/自建 · 更快", group: "Groq", provider: "Groq", costNote: "按端点" },
] as const;
