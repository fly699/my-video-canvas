import type { VideoProvider } from "../../../shared/types";

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
  provider: "Forge" | "Poyo" | "Kie" | "SelfHosted"; // upstream API the model is served by
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
] as const;

// Legacy export name — AIChatNode and scriptCreationTemplates reference CHAT_MODELS.
// Aliased to the unified list so there's a single source.
export const CHAT_MODELS = LLM_MODELS;

// ---------------------------------------------------------------------------
// Image generation models
// ---------------------------------------------------------------------------
// Shared between StoryboardNode, ImageGenNode, PromptNode.
//
// Fields:
//   value    — stable UI/enum value (also persisted in node payloads; NEVER
//              rename an existing one — only add). Must stay in sync with
//              `ImageGenModel` (shared/types.ts), the Zod enum (canvas.ts), and
//              the backend wire map (server/_core/imageGeneration.ts).
//   group    — top-level grouping for the picker (provider-level: Manus/Poyo/
//              Higgsfield). Kept for the existing optgroup rendering.
//   family   — model family badge (Nano/GPT/Flux/Seedream/Wan/Kling/Z/Grok/…).
//   provider — upstream provider (drives cost-source: Poyo→pricing doc,
//              Higgsfield→MCP, Manus→internal/free).
//   cost     — representative credits cost (Poyo: 1 credit = $0.005). Undefined
//              when the official pricing doc doesn't list a flat number
//              (those bill by resolution×n; the picker shows costNote/"—").
//   costNote — human-readable cost hint when `cost` alone is insufficient.
//   caps     — capability tags surfaced in the picker.
//
// Cost source: docs/poyo-credits-pricing.md (Poyo) / Higgsfield MCP (hf_*).
export type ImageModelMeta = {
  value: string;
  label: string;
  desc: string;
  group: "Manus" | "Poyo" | "Higgsfield" | "Kie";
  family: string;
  provider: "Manus" | "Poyo" | "Higgsfield" | "Kie";
  cost?: number;
  costNote?: string;
  caps?: string[];
  /** 图生图 / 编辑模型：必须提供参考图，否则上游会报错。驱动节点内的「需参考图」提示。 */
  requiresRef?: boolean;
};

/** 选定模型是否强制需要参考图（编辑 / 图生图）。供节点 UI 在缺图时给出提示。 */
export function imageModelRequiresRef(value?: string): boolean {
  if (!value) return false;
  return IMAGE_MODELS.find((m) => m.value === value)?.requiresRef ?? false;
}

// ── 来源平台分色标签（统一所有节点的模型下拉「来源平台」注释）──────────────────
// 每个上游平台一种色相，所有节点的模型选择器统一用它渲染来源标签（Poyo/Kie/Forge…），
// 便于一眼区分。脚本/对话节点的 Forge/Poyo 绿/蓝即源于此。
const PLATFORM_HUE: Record<string, number> = {
  Poyo: 240, Manus: 160, Forge: 160, Higgsfield: 310, Kie: 200,
  Suno: 285, MiniMax: 30, OpenAI: 150, Local: 95, Dev: 20, SelfHosted: 200,
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
  SelfHosted: -1, Manus: 0, Forge: 0, Kie: 1, Poyo: 2, Higgsfield: 3, Dev: 8,
};
export function modelGroupOrder(group: string): number {
  return GROUP_ORDER[group] ?? 4;
}

export const IMAGE_MODELS: readonly ImageModelMeta[] = [
  // --- Manus (built-in, free) ---
  { value: "manus_forge", label: "Manus Forge", desc: "内置 · 稳定", group: "Manus", family: "Manus", provider: "Manus", costNote: "内置", caps: ["内置", "离线兜底"] },

  // --- Poyo · Nano Banana (Google) ---
  { value: "poyo_nano_banana",     label: "Nano Banana",     desc: "预算 · 写实",        group: "Poyo", family: "Nano",     provider: "Poyo", cost: 5,  caps: ["T2I", "I2I"] },
  { value: "poyo_nano_banana_2",   label: "Nano Banana 2",   desc: "快速 · 4K",          group: "Poyo", family: "Nano",     provider: "Poyo", costNote: "5-12 cr/张", caps: ["T2I", "I2I", "4K"] },
  { value: "poyo_nano_banana_pro", label: "Nano Banana Pro", desc: "文字/图表 · 4K",     group: "Poyo", family: "Nano",     provider: "Poyo", costNote: "18-35 cr/张", caps: ["T2I", "编辑", "4K", "14图参考"] },
  { value: "poyo_nano_banana_2_new",      label: "Nano Banana 2 New",  desc: "Gemini 3.1 · 2K/4K",  group: "Poyo", family: "Nano", provider: "Poyo", costNote: "按分辨率(模型页)", caps: ["T2I", "I2I", "编辑", "4K", "14图参考"] },
  { value: "poyo_nano_banana_2_official", label: "Nano Banana 2 官方版", desc: "Gemini 3.1 · 0.5K-4K", group: "Poyo", family: "Nano", provider: "Poyo", costNote: "按分辨率(模型页)", caps: ["T2I", "I2I", "编辑", "4K", "14图参考"] },

  // --- Poyo · GPT Image (OpenAI) ---
  { value: "poyo_gpt_4o_image", label: "GPT-4o Image",  desc: "GPT-4o · 蒙版编辑",  group: "Poyo", family: "GPT", provider: "Poyo", costNote: "4 cr/张", caps: ["T2I", "I2I", "蒙版"] },
  { value: "poyo_gpt_image_15", label: "GPT Image 1.5", desc: "最佳文字 · logo",    group: "Poyo", family: "GPT", provider: "Poyo", costNote: "2 cr/张", caps: ["T2I", "I2I", "蒙版"] },
  { value: "poyo_gpt_image",    label: "GPT Image 2",   desc: "类 GPT-4o · 创意",   group: "Poyo", family: "GPT", provider: "Poyo", cost: 2, costNote: "起 2cr × 1/2/4x", caps: ["T2I", "多图编辑", "4K"] },

  // --- Poyo · Flux (Black Forest Labs) ---
  { value: "poyo_flux",              label: "Flux 2 Pro",       desc: "高质量 · 写实",      group: "Poyo", family: "Flux", provider: "Poyo", costNote: "6-9 cr/张", caps: ["T2I", "多图编辑", "2K"] },
  { value: "poyo_sdxl",              label: "Flux 2 Flex",      desc: "快速 · 多风格",      group: "Poyo", family: "Flux", provider: "Poyo", costNote: "18-27 cr/张", caps: ["T2I", "多图编辑"] },
  { value: "poyo_flux_kontext_pro",  label: "Flux Kontext Pro", desc: "上下文编辑",         group: "Poyo", family: "Flux", provider: "Poyo", costNote: "8 cr/张", caps: ["I2I", "编辑"] },
  { value: "poyo_flux_kontext_max",  label: "Flux Kontext Max", desc: "上下文编辑 · 排版",  group: "Poyo", family: "Flux", provider: "Poyo", costNote: "16 cr/张", caps: ["I2I", "编辑", "排版"] },

  // --- Poyo · Seedream (ByteDance) ---
  { value: "poyo_seedream_4",      label: "Seedream 4",        desc: "4K · 多图 1-15",     group: "Poyo", family: "Seedream", provider: "Poyo", costNote: "5 cr/张", caps: ["T2I", "编辑", "4K"] },
  { value: "poyo_seedream",        label: "Seedream 4.5",      desc: "4K · 精确控制",      group: "Poyo", family: "Seedream", provider: "Poyo", cost: 10, caps: ["T2I", "I2I", "编辑", "4K"] },
  { value: "poyo_seedream_5_lite", label: "Seedream 5.0 Lite", desc: "视觉推理 · 指令编辑", group: "Poyo", family: "Seedream", provider: "Poyo", cost: 5, caps: ["T2I", "I2I", "编辑", "3K"] },

  // --- Poyo · Wan (Alibaba) ---
  { value: "poyo_wan_image",     label: "Wan 2.7 Image",     desc: "思考式生成",   group: "Poyo", family: "Wan", provider: "Poyo", costNote: "4.2 cr/张", caps: ["T2I", "自动编辑"] },
  { value: "poyo_wan_image_pro", label: "Wan 2.7 Image Pro", desc: "高质量版",     group: "Poyo", family: "Wan", provider: "Poyo", costNote: "10.5 cr/张", caps: ["T2I", "自动编辑"] },

  // --- Poyo · Kling (Kuaishou) ---
  { value: "poyo_kling_o1_image", label: "Kling O1 Image", desc: "高一致性编辑 · 21:9", group: "Poyo", family: "Kling", provider: "Poyo", costNote: "分辨率×n", caps: ["编辑", "10图参考", "2K"] },
  { value: "poyo_kling_o3_image", label: "Kling O3 Image", desc: "高表现力 · 叙事",      group: "Poyo", family: "Kling", provider: "Poyo", costNote: "分辨率×n", caps: ["T2I", "编辑", "4K"] },

  // --- Poyo · others ---
  { value: "poyo_z_image",    label: "Z-Image",      desc: "超快 · 风格化", group: "Poyo", family: "Z",    provider: "Poyo", costNote: "2 cr/张", caps: ["T2I", "自动编辑"] },
  { value: "poyo_grok_image", label: "Grok Imagine", desc: "xAI · 高对比",  group: "Poyo", family: "Grok", provider: "Poyo", costNote: "6 cr/张", caps: ["T2I", "I2I"] },

  // --- Higgsfield ---
  { value: "hf_soul_standard", label: "Soul Standard",    desc: "旗舰 · 电影级",   group: "Higgsfield", family: "Soul",     provider: "Higgsfield", costNote: "HF 计费", caps: ["T2I", "参考图"] },
  { value: "hf_reve",          label: "Reve",             desc: "通用 · 快速",     group: "Higgsfield", family: "Reve",     provider: "Higgsfield", costNote: "HF 计费", caps: ["T2I"] },
  { value: "hf_seedream_v4",   label: "Seedream v4",      desc: "ByteDance · 4K",  group: "Higgsfield", family: "Seedream", provider: "Higgsfield", costNote: "HF 计费", caps: ["T2I", "I2I", "4K"] },
  { value: "hf_flux_pro",      label: "Flux Pro Kontext", desc: "上下文感知 · Max", group: "Higgsfield", family: "Flux",     provider: "Higgsfield", costNote: "HF 计费", caps: ["I2I", "编辑"] },

  // --- kie.ai (统一 jobs API；用「当前生效 kie key」计费，见工具栏 kie 余额) ---
  { value: "kie_nano_banana",       label: "Nano Banana",        desc: "Google · 写实",     group: "Kie", family: "Nano Banana", provider: "Kie", costNote: "4 点/张", caps: ["T2I"] },
  { value: "kie_nano_banana_pro",   label: "Nano Banana Pro",    desc: "文字/图表 · 4K",    group: "Kie", family: "Nano Banana", provider: "Kie", costNote: "18-24 点/张", caps: ["T2I", "4K"] },
  { value: "kie_nano_banana_edit",  label: "Nano Banana 编辑",   desc: "图生图 · 需参考图",  group: "Kie", family: "Nano Banana", provider: "Kie", costNote: "4 点/张", caps: ["I2I", "编辑"], requiresRef: true },
  { value: "kie_seedream_v4",       label: "Seedream 4.0",       desc: "ByteDance · 4K",    group: "Kie", family: "Seedream",    provider: "Kie", costNote: "模型页", caps: ["T2I", "4K"] },
  { value: "kie_seedream_v4_edit",  label: "Seedream 4.0 编辑",  desc: "图生图 · 需参考图",  group: "Kie", family: "Seedream",    provider: "Kie", costNote: "模型页", caps: ["I2I", "编辑"], requiresRef: true },
  { value: "kie_seedream_45",       label: "Seedream 4.5",       desc: "精确控制 · 4K",     group: "Kie", family: "Seedream",    provider: "Kie", costNote: "6.5 点/张", caps: ["T2I", "4K"] },
  { value: "kie_flux2_pro",         label: "Flux-2 Pro",         desc: "BFL · 高质量",      group: "Kie", family: "Flux-2",      provider: "Kie", costNote: "5-7 点/张", caps: ["T2I"] },
  { value: "kie_flux2_pro_i2i",     label: "Flux-2 Pro 图生图",  desc: "图生图 · 需参考图",  group: "Kie", family: "Flux-2",      provider: "Kie", costNote: "5-7 点/张", caps: ["I2I"], requiresRef: true },
  { value: "kie_gpt_image_15",      label: "GPT Image 1.5",      desc: "最佳文字 · logo",   group: "Kie", family: "GPT Image",   provider: "Kie", costNote: "4 点/张", caps: ["T2I"] },
  { value: "kie_gpt_image_15_edit", label: "GPT Image 1.5 编辑", desc: "图生图 · 需参考图",  group: "Kie", family: "GPT Image",   provider: "Kie", costNote: "4 点/张", caps: ["I2I", "编辑"], requiresRef: true },
  { value: "kie_imagen4",           label: "Imagen 4",           desc: "Google · 通用",     group: "Kie", family: "Imagen",      provider: "Kie", costNote: "4-12 点/张", caps: ["T2I"] },
  { value: "kie_imagen4_fast",      label: "Imagen 4 Fast",      desc: "Google · 快",       group: "Kie", family: "Imagen",      provider: "Kie", costNote: "4 点/张",  caps: ["T2I"] },
  { value: "kie_imagen4_ultra",     label: "Imagen 4 Ultra",     desc: "Google · 超清",     group: "Kie", family: "Imagen",      provider: "Kie", costNote: "12 点/张", caps: ["T2I"] },
  { value: "kie_z_image",           label: "Z-Image",            desc: "超快 · 风格化",     group: "Kie", family: "Z-Image",     provider: "Kie", costNote: "0.8 点/张", caps: ["T2I"] },
  { value: "kie_grok_image",        label: "Grok Image",         desc: "xAI · 高对比",      group: "Kie", family: "Grok",        provider: "Kie", costNote: "≈1 点/张", caps: ["T2I"] },
  // ── kie 第二批扩充 ──
  { value: "kie_nano_banana_2",     label: "Nano Banana 2",      desc: "Google · 1-4K",     group: "Kie", family: "Nano Banana", provider: "Kie", costNote: "1K 8/2K 12/4K 18 点", caps: ["T2I", "4K"] },
  { value: "kie_flux2_flex",        label: "Flux-2 Flex",        desc: "BFL · 快速多风格",  group: "Kie", family: "Flux-2",      provider: "Kie", costNote: "1K 14/2K 24 点", caps: ["T2I"] },
  { value: "kie_flux2_flex_i2i",    label: "Flux-2 Flex 图生图", desc: "图生图 · 需参考图",  group: "Kie", family: "Flux-2",      provider: "Kie", costNote: "1K 14/2K 24 点", caps: ["I2I"], requiresRef: true },
  { value: "kie_gpt_image_2",       label: "GPT Image 2",        desc: "OpenAI · 1-4K",     group: "Kie", family: "GPT Image",   provider: "Kie", costNote: "1K 6/2K 10/4K 16 点", caps: ["T2I", "4K"] },
  { value: "kie_gpt_image_2_i2i",   label: "GPT Image 2 图生图", desc: "图生图 · 需参考图",  group: "Kie", family: "GPT Image",   provider: "Kie", costNote: "1K 6/2K 10/4K 16 点", caps: ["I2I"], requiresRef: true },
  { value: "kie_seedream_5lite",    label: "Seedream 5.0 Lite",  desc: "ByteDance · 高性价比", group: "Kie", family: "Seedream",  provider: "Kie", costNote: "5.5 点/张", caps: ["T2I"] },
  { value: "kie_seedream_5lite_i2i",label: "Seedream 5.0 Lite 编辑", desc: "图生图 · 需参考图", group: "Kie", family: "Seedream", provider: "Kie", costNote: "5.5 点/张", caps: ["I2I", "编辑"], requiresRef: true },
  { value: "kie_wan27_image",       label: "Wan 2.7 Image",      desc: "Alibaba · 性价比",  group: "Kie", family: "Wan",         provider: "Kie", costNote: "4.8 点/张", caps: ["T2I"] },
  { value: "kie_wan27_image_pro",   label: "Wan 2.7 Image Pro",  desc: "Alibaba · 高质量",  group: "Kie", family: "Wan",         provider: "Kie", costNote: "12 点/张", caps: ["T2I"] },
  { value: "kie_ideogram_v3",       label: "Ideogram V3",        desc: "排版/文字强 · BALANCED 档",       group: "Kie", family: "Ideogram",    provider: "Kie", costNote: "7 点/张", caps: ["T2I"] },
  { value: "kie_qwen_image",        label: "Qwen Image",         desc: "通义 · 中文友好",   group: "Kie", family: "Qwen",        provider: "Kie", costNote: "4 点/百万像素", caps: ["T2I"] },
  { value: "kie_qwen_image_i2i",    label: "Qwen Image 图生图",  desc: "图生图 · 需参考图",  group: "Kie", family: "Qwen",        provider: "Kie", costNote: "4 点/百万像素", caps: ["I2I"], requiresRef: true },
  { value: "kie_qwen_image_edit",   label: "Qwen Image 编辑",    desc: "编辑 · 需参考图",    group: "Kie", family: "Qwen",        provider: "Kie", costNote: "5 点/百万像素", caps: ["I2I", "编辑"], requiresRef: true },
  { value: "kie_qwen2_image_edit",  label: "Qwen2 Image 编辑",   desc: "编辑 · 需参考图",    group: "Kie", family: "Qwen",        provider: "Kie", costNote: "5.6 点/张", caps: ["I2I", "编辑"], requiresRef: true },
  // ── 专属端点批（Flux Kontext / OpenAI 4o；有图即编辑、无图即文生图，参考图可选）──
  { value: "kie_flux_kontext_pro",  label: "Flux Kontext Pro",   desc: "上下文编辑 · 文/图",  group: "Kie", family: "Flux Kontext", provider: "Kie", costNote: "5 点/张",  caps: ["T2I", "I2I", "编辑"] },
  { value: "kie_flux_kontext_max",  label: "Flux Kontext Max",   desc: "上下文编辑 · 排版",   group: "Kie", family: "Flux Kontext", provider: "Kie", costNote: "10 点/张", caps: ["T2I", "I2I", "编辑", "排版"] },
  { value: "kie_gpt_4o_image",      label: "GPT-4o Image",       desc: "GPT-4o · 文/图编辑",  group: "Kie", family: "GPT Image",    provider: "Kie", costNote: "6 点/张",  caps: ["T2I", "I2I", "蒙版"] },
] as const;

export type ChatModelId = typeof CHAT_MODELS[number]["id"];
export type ImageModelId = (typeof IMAGE_MODELS)[number]["value"];

// ---------------------------------------------------------------------------
// Video generation models（视频任务节点）
// ---------------------------------------------------------------------------
// 单一数据源，供 VideoTaskNode 的模型选择器与管理后台「模型使能」枚举共用。
// Cost labels: Poyo from docs/poyo-credits-pricing.md (1 cr = $0.005). Models
// the doc only describes by dimension ("时长×分辨率") show 模型页. Higgsfield
// bills separately (标 HF 计费). kie own-key system: 临时 > 分配 > 公用.
export type VideoModelMeta = { value: VideoProvider; label: string; group: string; family: string; costLabel?: string; caps?: string[] };

export const VIDEO_MODELS: readonly VideoModelMeta[] = [
  // ── kie.ai (own key system: 临时 > 分配 > 公用; credits from docs/kie-pricing.md) ──
  { value: "kie_veo31_quality",       label: "Veo 3.1 Quality",     group: "Kie", family: "Veo",      costLabel: "720p 250/1080p 255/4K 380 点", caps: ["T2V", "I2V", "8s", "4K"] },
  { value: "kie_veo31_fast",          label: "Veo 3.1 Fast",        group: "Kie", family: "Veo",      costLabel: "720p 60/1080p 65/4K 180 点",   caps: ["T2V", "I2V", "8s", "4K"] },
  { value: "kie_kling26_t2v",         label: "Kling 2.6 文生视频",  group: "Kie", family: "Kling",    costLabel: "5s 55-110/10s 110-220 点",     caps: ["T2V", "原生音频", "5/10s"] },
  { value: "kie_kling26_i2v",         label: "Kling 2.6 图生视频",  group: "Kie", family: "Kling",    costLabel: "5s 55-110/10s 110-220 点",     caps: ["I2V", "原生音频", "5/10s"] },
  { value: "kie_kling30",             label: "Kling 3.0",           group: "Kie", family: "Kling",    costLabel: "std 14-20/pro 18-27/4K 67 点·秒",      caps: ["T2V", "首尾帧", "音频", "4K"] },
  { value: "kie_kling25turbo_t2v",    label: "Kling 2.5 Turbo 文生", group: "Kie", family: "Kling",   costLabel: "5s 42/10s 84 点",              caps: ["T2V", "5/10s"] },
  { value: "kie_kling25turbo_i2v",    label: "Kling 2.5 Turbo 图生", group: "Kie", family: "Kling",   costLabel: "5s 42/10s 84 点",              caps: ["I2V", "5/10s"] },
  { value: "kie_kling_v3turbo_t2v",   label: "Kling V3 Turbo 文生", group: "Kie", family: "Kling",   costLabel: "模型页",                       caps: ["T2V", "5/10s"] },
  { value: "kie_kling_v3turbo_i2v",   label: "Kling V3 Turbo 图生", group: "Kie", family: "Kling",   costLabel: "模型页",                       caps: ["I2V", "5/10s"] },
  { value: "kie_wan25_t2v",           label: "Wan 2.5 文生视频",    group: "Kie", family: "Wan",      costLabel: "5s 60-100/10s 120-200 点",     caps: ["T2V", "720p/1080p"] },
  { value: "kie_wan25_i2v",           label: "Wan 2.5 图生视频",    group: "Kie", family: "Wan",      costLabel: "5s 60-100/10s 120-200 点",     caps: ["I2V", "720p/1080p"] },
  { value: "kie_wan26_t2v",           label: "Wan 2.6 文生视频",    group: "Kie", family: "Wan",      costLabel: "5/10/15s 70-315 点",           caps: ["T2V", "5/10/15s"] },
  { value: "kie_wan26_i2v",           label: "Wan 2.6 图生视频",    group: "Kie", family: "Wan",      costLabel: "5/10/15s 70-315 点",           caps: ["I2V", "5/10/15s"] },
  { value: "kie_hailuo23_pro",        label: "Hailuo 2.3 Pro",      group: "Kie", family: "Hailuo",   costLabel: "6s 45-80/10s 90 点",           caps: ["I2V", "768P/1080P"] },
  { value: "kie_hailuo23_std",        label: "Hailuo 2.3 标准",     group: "Kie", family: "Hailuo",   costLabel: "6s 30-50/10s 50 点",           caps: ["I2V", "768P/1080P"] },
  { value: "kie_seedance2",           label: "Seedance 2.0",        group: "Kie", family: "Seedance", costLabel: "19-102 点·秒",                 caps: ["T2V", "首帧", "音频"] },
  { value: "kie_seedance2_fast",      label: "Seedance 2.0 Fast",   group: "Kie", family: "Seedance", costLabel: "15.5-33 点·秒",                caps: ["T2V", "首帧", "音频"] },
  { value: "kie_seedance2_mini",      label: "Seedance 2.0 Mini",   group: "Kie", family: "Seedance", costLabel: "480p 9.5/720p 20.5 点·秒",     caps: ["T2V", "多模态", "音频"] },
  // ── kie 视频 第二批扩充 ──
  { value: "kie_kling21_std",         label: "Kling 2.1 标准",      group: "Kie", family: "Kling",    costLabel: "标准 5s 25/10s 50 点",  caps: ["I2V", "5/10s"] },
  { value: "kie_kling21_pro",         label: "Kling 2.1 专业",      group: "Kie", family: "Kling",    costLabel: "专业 5s 50/10s 100 点", caps: ["I2V", "首尾帧"] },
  { value: "kie_kling21_master_t2v",  label: "Kling 2.1 Master 文生", group: "Kie", family: "Kling",  costLabel: "5s 160/10s 320 点",     caps: ["T2V", "5/10s", "旗舰"] },
  { value: "kie_kling21_master_i2v",  label: "Kling 2.1 Master 图生", group: "Kie", family: "Kling",  costLabel: "5s 160/10s 320 点",     caps: ["I2V", "5/10s", "旗舰"] },
  { value: "kie_wan22_t2v",           label: "Wan 2.2 文生(快)",    group: "Kie", family: "Wan",      costLabel: "480p 40/720p 80 点", caps: ["T2V", "720p"] },
  { value: "kie_wan22_i2v",           label: "Wan 2.2 图生(快)",    group: "Kie", family: "Wan",      costLabel: "480p 40/720p 80 点", caps: ["I2V", "720p"] },
  { value: "kie_wan27_t2v",           label: "Wan 2.7 文生视频",    group: "Kie", family: "Wan",      costLabel: "720p 16/1080p 24 点·秒", caps: ["T2V", "1080p"] },
  { value: "kie_wan27_i2v",           label: "Wan 2.7 图生视频",    group: "Kie", family: "Wan",      costLabel: "720p 16/1080p 24 点·秒", caps: ["I2V", "首尾帧"] },
  { value: "kie_hailuo02_std",        label: "Hailuo 02 标准",      group: "Kie", family: "Hailuo",   costLabel: "6s 30/10s 50 点",      caps: ["T2V", "768p"] },
  { value: "kie_hailuo02_pro_t2v",    label: "Hailuo 02 专业 文生", group: "Kie", family: "Hailuo",   costLabel: "57 点·条",          caps: ["T2V", "1080p"] },
  { value: "kie_hailuo02_pro_i2v",    label: "Hailuo 02 专业 图生", group: "Kie", family: "Hailuo",   costLabel: "57 点·条",          caps: ["I2V", "1080p"] },
  { value: "kie_grok_t2v",            label: "Grok Imagine 文生",   group: "Kie", family: "Grok",     costLabel: "480p 1.6/720p 3 点·秒",  caps: ["T2V", "6-30s"] },
  { value: "kie_grok_i2v",            label: "Grok Imagine 图生",   group: "Kie", family: "Grok",     costLabel: "480p 1.6/720p 3 点·秒",  caps: ["I2V", "6-30s"] },
  { value: "kie_happyhorse_t2v",      label: "HappyHorse 文生视频", group: "Kie", family: "HappyHorse", costLabel: "720p 28/1080p 48 点·秒", caps: ["T2V", "1080p"] },
  { value: "kie_happyhorse_i2v",      label: "HappyHorse 图生视频", group: "Kie", family: "HappyHorse", costLabel: "720p 28/1080p 48 点·秒", caps: ["I2V", "1080p"] },
  { value: "kie_happyhorse11_t2v",    label: "HappyHorse 1.1 文生", group: "Kie", family: "HappyHorse", costLabel: "720p 33/1080p 44 点·秒", caps: ["T2V", "1080p"] },
  { value: "kie_happyhorse11_r2v",    label: "HappyHorse 1.1 参考生", group: "Kie", family: "HappyHorse", costLabel: "720p 33/1080p 44 点·秒", caps: ["参考生", "多模态", "1080p"] },
  { value: "kie_happyhorse11_i2v",    label: "HappyHorse 1.1 图生", group: "Kie", family: "HappyHorse", costLabel: "720p 33/1080p 44 点·秒", caps: ["I2V", "1080p"] },
  { value: "kie_omnihuman15",         label: "OmniHuman 1.5 数字人", group: "Kie", family: "数字人", costLabel: "27 点·秒", caps: ["数字人", "图+音频", "对口型"] },
  { value: "kie_volcengine_lipsync",  label: "Volcengine 视频对口型", group: "Kie", family: "数字人", costLabel: "8 点·秒", caps: ["对口型", "视频+音频"] },
  // ── kie 视频 第三批：特殊输入（图+视频 / 图+音频）──
  { value: "kie_kling26_motion",      label: "Kling 2.6 动作控制",  group: "Kie", family: "Kling",      costLabel: "720p 11/1080p 18 点·秒",  caps: ["图+源视频", "动作迁移"] },
  { value: "kie_kling30_motion",      label: "Kling 3.0 动作控制",  group: "Kie", family: "Kling",      costLabel: "720p 20/1080p 27 点·秒",  caps: ["图+源视频", "动作迁移"] },
  { value: "kie_kling_avatar_std",    label: "Kling 数字人 标准",   group: "Kie", family: "Kling",      costLabel: "8 点·秒",                caps: ["图+音频", "对口型"] },
  { value: "kie_kling_avatar_pro",    label: "Kling 数字人 专业",   group: "Kie", family: "Kling",      costLabel: "16 点·秒",               caps: ["图+音频", "对口型"] },
  { value: "kie_wan_animate_move",    label: "Wan Animate 动作迁移", group: "Kie", family: "Wan",        costLabel: "480p 6/720p 12.5 点·秒",      caps: ["图+源视频"] },
  { value: "kie_wan_animate_replace", label: "Wan Animate 角色替换", group: "Kie", family: "Wan",        costLabel: "480p 6/720p 12.5 点·秒",      caps: ["图+源视频"] },
  { value: "kie_runway45",            label: "Runway Gen 4.5",      group: "Kie", family: "Runway",     costLabel: "720p 5s12/10s30·1080p 30 点",       caps: ["T2V", "I2V", "5/10s"] },
  { value: "kie_topaz_upscale",       label: "Topaz 视频放大",      group: "Kie", family: "Topaz",      costLabel: "1x/2x 8/4x 14 点·秒",    caps: ["视频放大", "需源视频"] },
  { value: "kie_runway_aleph",        label: "Runway Aleph 视频转视频", group: "Kie", family: "Runway",  costLabel: "110 点·条",              caps: ["视频转视频", "需源视频"] },
  // ── Sora ──
  { value: "poyo_sora2",              label: "Sora 2",              group: "Poyo", family: "Sora",     costLabel: "模型页",      caps: ["T2V", "I2V", "10/15s"] },
  { value: "poyo_sora2_pro",          label: "Sora 2 Pro",          group: "Poyo", family: "Sora",     costLabel: "100 cr/次",   caps: ["T2V", "I2V", "15/25s", "HD"] },
  { value: "poyo_sora2_official",     label: "Sora 2 官方版",       group: "Poyo", family: "Sora",     costLabel: "≈12 cr/s",    caps: ["T2V", "+1图", "4-20s"] },
  { value: "poyo_sora2_pro_official", label: "Sora 2 Pro 官方版",   group: "Poyo", family: "Sora",     costLabel: "100 cr/次",      caps: ["T2V", "I2V", "1080p"] },
  // ── Veo 3.1 ──
  { value: "poyo_veo",                label: "Veo 3.1 (Fast)",      group: "Poyo", family: "Veo",      costLabel: "模型页",      caps: ["T2V", "I2V", "8s", "4K"] },
  { value: "poyo_veo_fast",           label: "Veo 3.1 Fast",        group: "Poyo", family: "Veo",      costLabel: "模型页",      caps: ["T2V", "I2V", "8s", "4K"] },
  { value: "poyo_veo_quality",        label: "Veo 3.1 Quality",     group: "Poyo", family: "Veo",      costLabel: "模型页",      caps: ["T2V", "I2V", "8s", "4K"] },
  { value: "poyo_veo_lite",           label: "Veo 3.1 Lite",        group: "Poyo", family: "Veo",      costLabel: "模型页(低)",  caps: ["T2V", "8s"] },
  { value: "poyo_veo_fast_official",    label: "Veo 3.1 Fast 官方",   group: "Poyo", family: "Veo", costLabel: "按秒×分辨率±音频(模型页)", caps: ["T2V", "I2V", "4/6/8s", "4K", "音频"] },
  { value: "poyo_veo_quality_official", label: "Veo 3.1 Quality 官方", group: "Poyo", family: "Veo", costLabel: "按秒×分辨率±音频(模型页)", caps: ["T2V", "I2V", "参考生", "4/6/8s", "4K", "音频"] },
  { value: "poyo_veo_lite_official",    label: "Veo 3.1 Lite 官方",   group: "Poyo", family: "Veo", costLabel: "按秒×分辨率(模型页·低)", caps: ["T2V", "I2V", "4/6/8s", "音频"] },
  // ── Kling ──
  { value: "poyo_kling21_std",        label: "Kling 2.1 Standard",  group: "Poyo", family: "Kling",    costLabel: "5s 30/10s 60 cr/次",      caps: ["I2V", "5/10s"] },
  { value: "poyo_kling21_pro",        label: "Kling 2.1 Pro",       group: "Poyo", family: "Kling",    costLabel: "5s 55/10s 110 cr/次",      caps: ["I2V", "首尾帧"] },
  { value: "poyo_kling25_turbo",      label: "Kling 2.5 Turbo Pro", group: "Poyo", family: "Kling",    costLabel: "5s 42/10s 84 cr/次",      caps: ["T2V", "首尾帧"] },
  { value: "poyo_kling26",            label: "Kling 2.6",           group: "Poyo", family: "Kling",    costLabel: "≈13-24 cr/s", caps: ["T2V", "I2V", "原生音频"] },
  { value: "poyo_kling30_std",        label: "Kling 3.0 Standard",  group: "Poyo", family: "Kling",    costLabel: "720p 27/1080p 39 cr/s",      caps: ["T2V", "I2V", "音频", "多镜头"] },
  { value: "poyo_kling30_pro",        label: "Kling 3.0 Pro",       group: "Poyo", family: "Kling",    costLabel: "720p 39/1080p 49 cr/s",      caps: ["T2V", "I2V", "2K", "音频"] },
  { value: "poyo_kling30_4k",         label: "Kling 3.0 4K",        group: "Poyo", family: "Kling",    costLabel: "50 cr/s",     caps: ["4K", "音频", "多镜头"] },
  { value: "poyo_kling16_std",        label: "Kling 1.6 标准",      group: "Poyo", family: "Kling",    costLabel: "9 cr/s",      caps: ["T2V", "I2V", "参考"] },
  { value: "poyo_kling16_pro",        label: "Kling 1.6 专业",      group: "Poyo", family: "Kling",    costLabel: "15 cr/s",     caps: ["T2V", "I2V", "参考"] },
  { value: "poyo_kling30turbo_std",   label: "Kling 3.0 Turbo 标准", group: "Poyo", family: "Kling",   costLabel: "720p 17 cr/s",  caps: ["T2V", "I2V", "多镜头"] },
  { value: "poyo_kling30turbo_pro",   label: "Kling 3.0 Turbo 专业", group: "Poyo", family: "Kling",   costLabel: "1080p 22 cr/s", caps: ["T2V", "I2V", "多镜头"] },
  { value: "poyo_kling_o3_std",       label: "Kling O3 Standard",   group: "Poyo", family: "Kling",    costLabel: "10-13 cr/s",  caps: ["T2V", "I2V", "参考"] },
  { value: "poyo_kling_o3_pro",       label: "Kling O3 Pro",        group: "Poyo", family: "Kling",    costLabel: "13-16 cr/s",  caps: ["T2V", "I2V", "参考"] },
  { value: "poyo_kling_o3_4k",        label: "Kling O3 4K",         group: "Poyo", family: "Kling",    costLabel: "50 cr/s",     caps: ["4K", "参考"] },
  // ── Wan ──
  { value: "poyo_wan25_t2v",          label: "Wan 2.6 文生视频",    group: "Poyo", family: "Wan",      costLabel: "5s 80/1080p 120 cr/次",      caps: ["T2V", "多镜头"] },
  { value: "poyo_wan25_i2v",          label: "Wan 2.6 图生视频",    group: "Poyo", family: "Wan",      costLabel: "5s 80/1080p 120 cr/次",      caps: ["I2V", "多镜头"] },
  { value: "poyo_wan27_t2v",          label: "Wan 2.7 文生视频",    group: "Poyo", family: "Wan",      costLabel: "720p 12/1080p 18 cr/s", caps: ["T2V", "音频"] },
  { value: "poyo_wan27_i2v",          label: "Wan 2.7 图生视频",    group: "Poyo", family: "Wan",      costLabel: "720p 12/1080p 18 cr/s", caps: ["I2V", "首尾帧"] },
  { value: "poyo_wan27_ref",          label: "Wan 2.7 参考生视频",  group: "Poyo", family: "Wan",      costLabel: "720p 12/1080p 18 cr/s", caps: ["参考生", "多模态", "图/视频参考"] },
  { value: "poyo_wan22_t2v_fast",     label: "Wan 2.2 文生(快)",    group: "Poyo", family: "Wan",      costLabel: "480p 6/720p 12 cr",      caps: ["T2V", "720p"] },
  { value: "poyo_wan22_i2v_fast",     label: "Wan 2.2 图生(快)",    group: "Poyo", family: "Wan",      costLabel: "480p 6/720p 12 cr",      caps: ["I2V", "720p"] },
  // ── Seedance ──
  { value: "poyo_seedance1_pro",      label: "Seedance 1.0 Pro",    group: "Poyo", family: "Seedance", costLabel: "720p 21/1080p 43 cr/次(5s)",      caps: ["T2V", "I2V", "5/10s"] },
  { value: "poyo_seedance15_pro",     label: "Seedance 1.5 Pro",    group: "Poyo", family: "Seedance", costLabel: "480p 9/720p 16 cr起",      caps: ["T2V", "I2V", "音频"] },
  { value: "poyo_seedance",           label: "Seedance 2",          group: "Poyo", family: "Seedance", costLabel: "480p 10/720p 20/1080p 45 cr/s", caps: ["T2V", "首尾帧", "参考", "音频"] },
  { value: "poyo_seedance2_fast",     label: "Seedance 2 Fast",     group: "Poyo", family: "Seedance", costLabel: "模型页(低)",  caps: ["T2V", "720p", "音频"] },
  // ── Hailuo ──
  { value: "poyo_hailuo02",           label: "Hailuo 02",           group: "Poyo", family: "Hailuo",   costLabel: "768p 7 cr/s",      caps: ["T2V", "I2V", "768P"] },
  { value: "poyo_hailuo02_pro",       label: "Hailuo 02 Pro",       group: "Poyo", family: "Hailuo",   costLabel: "65 cr/次",      caps: ["1080P", "6s"] },
  { value: "poyo_hailuo23",           label: "Hailuo 2.3",          group: "Poyo", family: "Hailuo",   costLabel: "768p 35-70/1080p 60 cr/次",      caps: ["T2V", "+首帧", "1080p"] },
  // ── others ──
  { value: "poyo_happy_horse",        label: "Happy Horse",         group: "Poyo", family: "其他",     costLabel: "720p 16/1080p 32 cr/s",      caps: ["四工作流", "1080p"] },
  { value: "poyo_happy_horse_11",     label: "Happy Horse 1.1",     group: "Poyo", family: "其他",     costLabel: "720p 22/1080p 28 cr/s",      caps: ["T2V", "I2V", "参考生", "1080p"] },
  { value: "poyo_omni_flash",         label: "Omni Flash",          group: "Poyo", family: "其他",     costLabel: "120-450 cr/次（按分辨率/时长）", caps: ["T2V", "I2V", "V2V", "三图融合", "4K"] },
  { value: "poyo_grok_video",         label: "Grok Imagine",        group: "Poyo", family: "其他",     costLabel: "6s 30/10s 40 cr/次",      caps: ["T2V", "I2V", "6/10s"] },
  { value: "poyo_runway45",           label: "Runway Gen 4.5",      group: "Poyo", family: "Runway",   costLabel: "5s 75/10s 150 cr/次",      caps: ["T2V", "+1图", "5/10s"] },
  // ── Higgsfield (公共 API 仅 DoP 3 档；其余 Kling/Seedance/Veo 在私有后端) ──
  { value: "hf_dop_standard",         label: "DoP Standard",        group: "Higgsfield", family: "DoP", costLabel: "HF 计费",    caps: ["I2V", "运镜"] },
  { value: "hf_dop_lite",             label: "DoP Lite",            group: "Higgsfield", family: "DoP", costLabel: "HF 计费",    caps: ["I2V", "4s"] },
  { value: "hf_dop_turbo",            label: "DoP Turbo",           group: "Higgsfield", family: "DoP", costLabel: "HF 计费",    caps: ["I2V", "4s"] },
  { value: "mock",                    label: "Mock 测试",           group: "Dev",        family: "Dev", costLabel: "免费",       caps: ["测试"] },
] as const;

// ── 字幕转录（STT）模型 ──────────────────────────────────────────────────────
// 经内置 Forge（OpenAI 兼容）转录代理调用；与 image/video 一样进「管理员模型管理」
// 可禁用、「节点默认模型」可设默认。计费为内置服务（不计 kie 点 / Poyo cr）。
export type TranscribeModelMeta = {
  value: string;
  label: string;
  desc: string;
  group: "Forge";
  provider: "Forge";
  costNote: string;
};
export const TRANSCRIBE_MODELS: readonly TranscribeModelMeta[] = [
  { value: "whisper-1",              label: "Whisper v1",          desc: "默认 · 稳定",  group: "Forge", provider: "Forge", costNote: "内置" },
  { value: "gpt-4o-transcribe",      label: "GPT-4o Transcribe",   desc: "更准",         group: "Forge", provider: "Forge", costNote: "内置" },
  { value: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe", desc: "更快 / 更省", group: "Forge", provider: "Forge", costNote: "内置" },
] as const;
