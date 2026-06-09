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
  family: "Gemini" | "Claude" | "GPT";
  tag: string;
  provider: "Forge" | "Poyo" | "Kie"; // upstream API the model is served by
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
  Suno: 285, MiniMax: 30, OpenAI: 150, Local: 95, Dev: 20,
};
export function platformBadge(name: string): { bg: string; fg: string } {
  const h = PLATFORM_HUE[name] ?? 265;
  return { bg: `oklch(0.70 0.15 ${h} / 0.18)`, fg: `oklch(0.74 0.14 ${h})` };
}

export const IMAGE_MODELS: readonly ImageModelMeta[] = [
  // --- Manus (built-in, free) ---
  { value: "manus_forge", label: "Manus Forge", desc: "内置 · 稳定", group: "Manus", family: "Manus", provider: "Manus", costNote: "内置", caps: ["内置", "离线兜底"] },

  // --- Poyo · Nano Banana (Google) ---
  { value: "poyo_nano_banana",     label: "Nano Banana",     desc: "预算 · 写实",        group: "Poyo", family: "Nano",     provider: "Poyo", cost: 5,  caps: ["T2I", "I2I"] },
  { value: "poyo_nano_banana_2",   label: "Nano Banana 2",   desc: "快速 · 4K",          group: "Poyo", family: "Nano",     provider: "Poyo", costNote: "5-12 cr/张", caps: ["T2I", "I2I", "4K"] },
  { value: "poyo_nano_banana_pro", label: "Nano Banana Pro", desc: "文字/图表 · 4K",     group: "Poyo", family: "Nano",     provider: "Poyo", costNote: "18-35 cr/张", caps: ["T2I", "编辑", "4K", "14图参考"] },

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
  { value: "kie_gpt_image_15",      label: "GPT Image 1.5",      desc: "最佳文字 · logo",   group: "Kie", family: "GPT Image",   provider: "Kie", costNote: "模型页", caps: ["T2I"] },
  { value: "kie_gpt_image_15_edit", label: "GPT Image 1.5 编辑", desc: "图生图 · 需参考图",  group: "Kie", family: "GPT Image",   provider: "Kie", costNote: "模型页", caps: ["I2I", "编辑"], requiresRef: true },
  { value: "kie_imagen4",           label: "Imagen 4",           desc: "Google · 通用",     group: "Kie", family: "Imagen",      provider: "Kie", costNote: "4-12 点/张", caps: ["T2I"] },
  { value: "kie_z_image",           label: "Z-Image",            desc: "超快 · 风格化",     group: "Kie", family: "Z-Image",     provider: "Kie", costNote: "0.8 点/张", caps: ["T2I"] },
  { value: "kie_grok_image",        label: "Grok Image",         desc: "xAI · 高对比",      group: "Kie", family: "Grok",        provider: "Kie", costNote: "≈1 点/张", caps: ["T2I"] },
  // ── kie 第二批扩充 ──
  { value: "kie_nano_banana_2",     label: "Nano Banana 2",      desc: "Google · 1-4K",     group: "Kie", family: "Nano Banana", provider: "Kie", costNote: "8-18 点/张", caps: ["T2I", "4K"] },
  { value: "kie_flux2_flex",        label: "Flux-2 Flex",        desc: "BFL · 快速多风格",  group: "Kie", family: "Flux-2",      provider: "Kie", costNote: "14-24 点/张", caps: ["T2I"] },
  { value: "kie_flux2_flex_i2i",    label: "Flux-2 Flex 图生图", desc: "图生图 · 需参考图",  group: "Kie", family: "Flux-2",      provider: "Kie", costNote: "14-24 点/张", caps: ["I2I"], requiresRef: true },
  { value: "kie_gpt_image_2",       label: "GPT Image 2",        desc: "OpenAI · 1-4K",     group: "Kie", family: "GPT Image",   provider: "Kie", costNote: "6-16 点/张", caps: ["T2I", "4K"] },
  { value: "kie_gpt_image_2_i2i",   label: "GPT Image 2 图生图", desc: "图生图 · 需参考图",  group: "Kie", family: "GPT Image",   provider: "Kie", costNote: "6-16 点/张", caps: ["I2I"], requiresRef: true },
  { value: "kie_seedream_5lite",    label: "Seedream 5.0 Lite",  desc: "ByteDance · 高性价比", group: "Kie", family: "Seedream",  provider: "Kie", costNote: "5.5 点/张", caps: ["T2I"] },
  { value: "kie_seedream_5lite_i2i",label: "Seedream 5.0 Lite 编辑", desc: "图生图 · 需参考图", group: "Kie", family: "Seedream", provider: "Kie", costNote: "5.5 点/张", caps: ["I2I", "编辑"], requiresRef: true },
  { value: "kie_wan27_image",       label: "Wan 2.7 Image",      desc: "Alibaba · 性价比",  group: "Kie", family: "Wan",         provider: "Kie", costNote: "4.8 点/张", caps: ["T2I"] },
  { value: "kie_wan27_image_pro",   label: "Wan 2.7 Image Pro",  desc: "Alibaba · 高质量",  group: "Kie", family: "Wan",         provider: "Kie", costNote: "12 点/张", caps: ["T2I"] },
  { value: "kie_ideogram_v3",       label: "Ideogram V3",        desc: "排版/文字强",       group: "Kie", family: "Ideogram",    provider: "Kie", costNote: "3.5-10 点/张", caps: ["T2I"] },
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
