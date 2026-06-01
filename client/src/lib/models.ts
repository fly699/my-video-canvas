// Chat models (shared between AIChatNode and any future chat components)
export const CHAT_MODELS = [
  { id: "gemini-2.5-flash",          label: "Gemini 2.5 Flash",  tag: "默认" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5",  tag: "快速" },
  { id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6", tag: "智能" },
  { id: "gpt-5.2",                   label: "GPT-5.2",           tag: "Poyo" },
] as const;

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
  group: "Manus" | "Poyo" | "Higgsfield";
  family: string;
  provider: "Manus" | "Poyo" | "Higgsfield";
  cost?: number;
  costNote?: string;
  caps?: string[];
};

export const IMAGE_MODELS: readonly ImageModelMeta[] = [
  // --- Manus (built-in, free) ---
  { value: "manus_forge", label: "Manus Forge", desc: "内置 · 稳定", group: "Manus", family: "Manus", provider: "Manus", cost: 0, caps: ["内置", "离线兜底"] },

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
] as const;

export type ChatModelId = typeof CHAT_MODELS[number]["id"];
export type ImageModelId = (typeof IMAGE_MODELS)[number]["value"];
