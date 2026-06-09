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
  provider: "Forge" | "Poyo"; // upstream API the model is served by
  color: string;
  costTier: "低" | "中" | "高";
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
};

export const IMAGE_MODELS: readonly ImageModelMeta[] = [
  // --- Manus (built-in, free) ---
  { value: "manus_forge", label: "Manus Forge", desc: "内置 · 稳定", group: "Manus", family: "Manus", provider: "Manus", costNote: "内置", caps: ["内置", "离线兜底"] },

  // --- Poyo · Nano Banana (Google) ---
  { value: "poyo_nano_banana",     label: "Nano Banana",     desc: "预算 · 写实",        group: "Poyo", family: "Nano",     provider: "Poyo", cost: 5,  caps: ["T2I", "I2I"] },
  { value: "poyo_nano_banana_2",   label: "Nano Banana 2",   desc: "快速 · 4K",          group: "Poyo", family: "Nano",     provider: "Poyo", costNote: "模型页", caps: ["T2I", "I2I", "4K"] },
  { value: "poyo_nano_banana_pro", label: "Nano Banana Pro", desc: "文字/图表 · 4K",     group: "Poyo", family: "Nano",     provider: "Poyo", costNote: "模型页", caps: ["T2I", "编辑", "4K", "14图参考"] },

  // --- Poyo · GPT Image (OpenAI) ---
  { value: "poyo_gpt_4o_image", label: "GPT-4o Image",  desc: "GPT-4o · 蒙版编辑",  group: "Poyo", family: "GPT", provider: "Poyo", costNote: "模型页", caps: ["T2I", "I2I", "蒙版"] },
  { value: "poyo_gpt_image_15", label: "GPT Image 1.5", desc: "最佳文字 · logo",    group: "Poyo", family: "GPT", provider: "Poyo", costNote: "模型页", caps: ["T2I", "I2I", "蒙版"] },
  { value: "poyo_gpt_image",    label: "GPT Image 2",   desc: "类 GPT-4o · 创意",   group: "Poyo", family: "GPT", provider: "Poyo", cost: 2, costNote: "起 2cr × 1/2/4x", caps: ["T2I", "多图编辑", "4K"] },

  // --- Poyo · Flux (Black Forest Labs) ---
  { value: "poyo_flux",              label: "Flux 2 Pro",       desc: "高质量 · 写实",      group: "Poyo", family: "Flux", provider: "Poyo", costNote: "模型页", caps: ["T2I", "多图编辑", "2K"] },
  { value: "poyo_sdxl",              label: "Flux 2 Flex",      desc: "快速 · 多风格",      group: "Poyo", family: "Flux", provider: "Poyo", costNote: "模型页", caps: ["T2I", "多图编辑"] },
  { value: "poyo_flux_kontext_pro",  label: "Flux Kontext Pro", desc: "上下文编辑",         group: "Poyo", family: "Flux", provider: "Poyo", costNote: "模型页", caps: ["I2I", "编辑"] },
  { value: "poyo_flux_kontext_max",  label: "Flux Kontext Max", desc: "上下文编辑 · 排版",  group: "Poyo", family: "Flux", provider: "Poyo", costNote: "模型页", caps: ["I2I", "编辑", "排版"] },

  // --- Poyo · Seedream (ByteDance) ---
  { value: "poyo_seedream_4",      label: "Seedream 4",        desc: "4K · 多图 1-15",     group: "Poyo", family: "Seedream", provider: "Poyo", costNote: "模型页", caps: ["T2I", "编辑", "4K"] },
  { value: "poyo_seedream",        label: "Seedream 4.5",      desc: "4K · 精确控制",      group: "Poyo", family: "Seedream", provider: "Poyo", cost: 10, caps: ["T2I", "I2I", "编辑", "4K"] },
  { value: "poyo_seedream_5_lite", label: "Seedream 5.0 Lite", desc: "视觉推理 · 指令编辑", group: "Poyo", family: "Seedream", provider: "Poyo", cost: 5, caps: ["T2I", "I2I", "编辑", "3K"] },

  // --- Poyo · Wan (Alibaba) ---
  { value: "poyo_wan_image",     label: "Wan 2.7 Image",     desc: "思考式生成",   group: "Poyo", family: "Wan", provider: "Poyo", costNote: "模型页", caps: ["T2I", "自动编辑"] },
  { value: "poyo_wan_image_pro", label: "Wan 2.7 Image Pro", desc: "高质量版",     group: "Poyo", family: "Wan", provider: "Poyo", costNote: "模型页", caps: ["T2I", "自动编辑"] },

  // --- Poyo · Kling (Kuaishou) ---
  { value: "poyo_kling_o1_image", label: "Kling O1 Image", desc: "高一致性编辑 · 21:9", group: "Poyo", family: "Kling", provider: "Poyo", costNote: "分辨率×n", caps: ["编辑", "10图参考", "2K"] },
  { value: "poyo_kling_o3_image", label: "Kling O3 Image", desc: "高表现力 · 叙事",      group: "Poyo", family: "Kling", provider: "Poyo", costNote: "分辨率×n", caps: ["T2I", "编辑", "4K"] },

  // --- Poyo · others ---
  { value: "poyo_z_image",    label: "Z-Image",      desc: "超快 · 风格化", group: "Poyo", family: "Z",    provider: "Poyo", costNote: "模型页", caps: ["T2I", "自动编辑"] },
  { value: "poyo_grok_image", label: "Grok Imagine", desc: "xAI · 高对比",  group: "Poyo", family: "Grok", provider: "Poyo", costNote: "模型页", caps: ["T2I", "I2I"] },

  // --- Higgsfield ---
  { value: "hf_soul_standard", label: "Soul Standard",    desc: "旗舰 · 电影级",   group: "Higgsfield", family: "Soul",     provider: "Higgsfield", costNote: "HF 计费", caps: ["T2I", "参考图"] },
  { value: "hf_reve",          label: "Reve",             desc: "通用 · 快速",     group: "Higgsfield", family: "Reve",     provider: "Higgsfield", costNote: "HF 计费", caps: ["T2I"] },
  { value: "hf_seedream_v4",   label: "Seedream v4",      desc: "ByteDance · 4K",  group: "Higgsfield", family: "Seedream", provider: "Higgsfield", costNote: "HF 计费", caps: ["T2I", "I2I", "4K"] },
  { value: "hf_flux_pro",      label: "Flux Pro Kontext", desc: "上下文感知 · Max", group: "Higgsfield", family: "Flux",     provider: "Higgsfield", costNote: "HF 计费", caps: ["I2I", "编辑"] },

  // --- kie.ai (统一 jobs API；用「当前生效 kie key」计费，见工具栏 kie 余额) ---
  { value: "kie_nano_banana",       label: "Nano Banana",        desc: "Google · 写实",     group: "Kie", family: "Nano Banana", provider: "Kie", costNote: "kie 计费", caps: ["T2I"] },
  { value: "kie_nano_banana_pro",   label: "Nano Banana Pro",    desc: "文字/图表 · 4K",    group: "Kie", family: "Nano Banana", provider: "Kie", costNote: "kie 计费", caps: ["T2I", "4K"] },
  { value: "kie_nano_banana_edit",  label: "Nano Banana 编辑",   desc: "图生图 · 需参考图",  group: "Kie", family: "Nano Banana", provider: "Kie", costNote: "kie 计费", caps: ["I2I", "编辑"] },
  { value: "kie_seedream_v4",       label: "Seedream 4.0",       desc: "ByteDance · 4K",    group: "Kie", family: "Seedream",    provider: "Kie", costNote: "kie 计费", caps: ["T2I", "4K"] },
  { value: "kie_seedream_v4_edit",  label: "Seedream 4.0 编辑",  desc: "图生图 · 需参考图",  group: "Kie", family: "Seedream",    provider: "Kie", costNote: "kie 计费", caps: ["I2I", "编辑"] },
  { value: "kie_seedream_45",       label: "Seedream 4.5",       desc: "精确控制 · 4K",     group: "Kie", family: "Seedream",    provider: "Kie", costNote: "kie 计费", caps: ["T2I", "4K"] },
  { value: "kie_flux2_pro",         label: "Flux-2 Pro",         desc: "BFL · 高质量",      group: "Kie", family: "Flux-2",      provider: "Kie", costNote: "kie 计费", caps: ["T2I"] },
  { value: "kie_flux2_pro_i2i",     label: "Flux-2 Pro 图生图",  desc: "图生图 · 需参考图",  group: "Kie", family: "Flux-2",      provider: "Kie", costNote: "kie 计费", caps: ["I2I"] },
  { value: "kie_gpt_image_15",      label: "GPT Image 1.5",      desc: "最佳文字 · logo",   group: "Kie", family: "GPT Image",   provider: "Kie", costNote: "kie 计费", caps: ["T2I"] },
  { value: "kie_gpt_image_15_edit", label: "GPT Image 1.5 编辑", desc: "图生图 · 需参考图",  group: "Kie", family: "GPT Image",   provider: "Kie", costNote: "kie 计费", caps: ["I2I", "编辑"] },
  { value: "kie_imagen4",           label: "Imagen 4",           desc: "Google · 通用",     group: "Kie", family: "Imagen",      provider: "Kie", costNote: "kie 计费", caps: ["T2I"] },
  { value: "kie_z_image",           label: "Z-Image",            desc: "超快 · 风格化",     group: "Kie", family: "Z-Image",     provider: "Kie", costNote: "kie 计费", caps: ["T2I"] },
  { value: "kie_grok_image",        label: "Grok Image",         desc: "xAI · 高对比",      group: "Kie", family: "Grok",        provider: "Kie", costNote: "kie 计费", caps: ["T2I"] },
] as const;

export type ChatModelId = typeof CHAT_MODELS[number]["id"];
export type ImageModelId = (typeof IMAGE_MODELS)[number]["value"];
