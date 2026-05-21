// Chat models (shared between AIChatNode and any future chat components)
export const CHAT_MODELS = [
  { id: "gemini-2.5-flash",          label: "Gemini 2.5 Flash",  tag: "默认" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5",  tag: "快速" },
  { id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6", tag: "智能" },
  { id: "gpt-5.2",                   label: "GPT-5.2",           tag: "Poyo" },
] as const;

// Image generation models (shared between StoryboardNode, ImageGenNode, PromptNode)
export const IMAGE_MODELS = [
  { value: "manus_forge",      label: "Manus Forge",        desc: "内置 · 稳定",   group: "Manus" },
  { value: "poyo_flux",        label: "Flux 2 Pro",         desc: "高质量 · 写实", group: "Poyo" },
  { value: "poyo_sdxl",        label: "Flux 2 Flex",        desc: "快速 · 多风格", group: "Poyo" },
  { value: "poyo_gpt_image",   label: "GPT Image 2",        desc: "类 GPT-4o · 创意", group: "Poyo" },
  { value: "hf_soul_standard", label: "Soul Standard",      desc: "旗舰 · 电影级", group: "Higgsfield" },
  { value: "hf_reve",          label: "Reve Text-to-Image", desc: "通用 · 快速",   group: "Higgsfield" },
] as const;

export type ChatModelId = typeof CHAT_MODELS[number]["id"];
export type ImageModelId = typeof IMAGE_MODELS[number]["value"];
