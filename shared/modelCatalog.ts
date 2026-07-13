import type { VideoProvider } from "./types";

// ── 图像 / 视频生成模型清单（单一真源）──────────────────────────────────────
// 从 client/src/lib/models.ts 抽到 shared，供三方共用：
//   1. 客户端各节点的模型选择器（经 lib/models.ts 再导出，导入路径不变）；
//   2. 服务端画布助手目录（agentCatalog）向 LLM 输出可选模型清单并校验
//      image_gen.model / storyboard.imageModel / video_task.provider 的取值；
//   3. 管理后台「模型使能」枚举。
// 增删模型仍遵循原规则：value 一经发布绝不改名（节点 payload 持久化引用）。


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
  /** 行为备注（进画布助手模型清单与 UI 提示），如「每次固定返回一组约 6 张候选」。 */
  note?: string;
};

/** 选定模型是否强制需要参考图（编辑 / 图生图）。供节点 UI 在缺图时给出提示。 */
export function imageModelRequiresRef(value?: string): boolean {
  if (!value) return false;
  return IMAGE_MODELS.find((m) => m.value === value)?.requiresRef ?? false;
}

export const IMAGE_MODELS: readonly ImageModelMeta[] = [
  // --- Manus (built-in, free) ---
  { value: "manus_forge", label: "Manus Forge", desc: "内置 · 稳定", group: "Manus", family: "Manus", provider: "Manus", costNote: "内置", caps: ["内置", "离线兜底"] },

  // --- Poyo · Nano Banana (Google) ---
  { value: "poyo_nano_banana",     label: "Nano Banana",     desc: "预算 · 写实",        group: "Poyo", family: "Nano",     provider: "Poyo", cost: 5,  caps: ["T2I", "I2I"] },
  { value: "poyo_nano_banana_2",   label: "Nano Banana 2",   desc: "快速 · 4K",          group: "Poyo", family: "Nano",     provider: "Poyo", costNote: "5-12 cr/张", caps: ["T2I", "I2I", "4K"] },
  { value: "poyo_nano_banana_pro", label: "Nano Banana Pro", desc: "文字/图表 · 4K",     group: "Poyo", family: "Nano",     provider: "Poyo", costNote: "18-35 cr/张", caps: ["T2I", "编辑", "4K", "14图参考"] },
  { value: "poyo_nano_banana_2_new",      label: "Nano Banana 2 New",  desc: "Gemini 3.1 · 2K/4K",  group: "Poyo", family: "Nano", provider: "Poyo", costNote: "5-12 cr/张", caps: ["T2I", "I2I", "编辑", "4K", "14图参考"] },
  { value: "poyo_nano_banana_2_official", label: "Nano Banana 2 官方版", desc: "Gemini 3.1 · 0.5K-4K", group: "Poyo", family: "Nano", provider: "Poyo", costNote: "7-20 cr/张", caps: ["T2I", "I2I", "编辑", "4K", "14图参考"] },

  // --- Poyo · GPT Image (OpenAI) ---
  { value: "poyo_gpt_4o_image", label: "GPT-4o Image",  desc: "GPT-4o · 蒙版编辑",  group: "Poyo", family: "GPT", provider: "Poyo", costNote: "4 cr/张", caps: ["T2I", "I2I", "蒙版"] },
  { value: "poyo_gpt_image_15", label: "GPT Image 1.5", desc: "最佳文字 · logo",    group: "Poyo", family: "GPT", provider: "Poyo", costNote: "2 cr/张", caps: ["T2I", "I2I", "蒙版"] },
  { value: "poyo_gpt_image",    label: "GPT Image 2",   desc: "类 GPT-4o · 创意",   group: "Poyo", family: "GPT", provider: "Poyo", cost: 2, costNote: "起 2cr × 1/2/4x", caps: ["T2I", "多图编辑", "4K"] },

  // --- Poyo · Flux (Black Forest Labs) ---
  { value: "poyo_flux",              label: "Flux 2 Pro",       desc: "高质量 · 写实",      group: "Poyo", family: "Flux", provider: "Poyo", costNote: "18-27 cr/张", caps: ["T2I", "多图编辑", "2K"] },
  { value: "poyo_sdxl",              label: "Flux 2 Flex",      desc: "快速 · 多风格",      group: "Poyo", family: "Flux", provider: "Poyo", costNote: "6-9 cr/张", caps: ["T2I", "多图编辑"] },
  { value: "poyo_flux_kontext_pro",  label: "Flux Kontext Pro", desc: "上下文编辑",         group: "Poyo", family: "Flux", provider: "Poyo", costNote: "8 cr/张", caps: ["I2I", "编辑"] },
  { value: "poyo_flux_kontext_max",  label: "Flux Kontext Max", desc: "上下文编辑 · 排版",  group: "Poyo", family: "Flux", provider: "Poyo", costNote: "16 cr/张", caps: ["I2I", "编辑", "排版"] },

  // --- Poyo · Seedream (ByteDance) ---
  { value: "poyo_seedream_4",      label: "Seedream 4",        desc: "4K · 多图 1-15",     group: "Poyo", family: "Seedream", provider: "Poyo", costNote: "5 cr/张", caps: ["T2I", "编辑", "4K"] },
  { value: "poyo_seedream",        label: "Seedream 4.5",      desc: "4K · 精确控制",      group: "Poyo", family: "Seedream", provider: "Poyo", cost: 5, caps: ["T2I", "I2I", "编辑", "4K"] },
  { value: "poyo_seedream_5_lite", label: "Seedream 5.0 Lite", desc: "视觉推理 · 指令编辑", group: "Poyo", family: "Seedream", provider: "Poyo", cost: 5, caps: ["T2I", "I2I", "编辑", "3K"] },

  // --- Poyo · Wan (Alibaba) ---
  { value: "poyo_wan_image",     label: "Wan 2.7 Image",     desc: "思考式生成",   group: "Poyo", family: "Wan", provider: "Poyo", costNote: "4.2 cr/张", caps: ["T2I", "自动编辑"] },
  { value: "poyo_wan_image_pro", label: "Wan 2.7 Image Pro", desc: "高质量版",     group: "Poyo", family: "Wan", provider: "Poyo", costNote: "10.5 cr/张", caps: ["T2I", "自动编辑"] },

  // --- Poyo · Kling (Kuaishou) ---
  { value: "poyo_kling_o1_image", label: "Kling O1 Image", desc: "高一致性编辑 · 21:9", group: "Poyo", family: "Kling", provider: "Poyo", costNote: "3.5 cr/张", caps: ["编辑", "10图参考", "2K"] },
  { value: "poyo_kling_o3_image", label: "Kling O3 Image", desc: "高表现力 · 叙事",      group: "Poyo", family: "Kling", provider: "Poyo", costNote: "分辨率×n", caps: ["T2I", "编辑", "4K"] },

  // --- Poyo · others ---
  { value: "poyo_z_image",    label: "Z-Image",      desc: "超快 · 风格化", group: "Poyo", family: "Z",    provider: "Poyo", costNote: "2 cr/张", caps: ["T2I", "自动编辑"] },
  { value: "poyo_grok_image", label: "Grok Imagine", desc: "xAI · 高对比",  group: "Poyo", family: "Grok", provider: "Poyo", costNote: "6 cr/张", caps: ["T2I", "I2I"], note: "每次固定返回一组约 6 张候选（按次计费，张数不可控）" },
  // ── #151 round2 新模型（计价按 2026-07-round2-final.json）──
  { value: "poyo_seedream_5_pro",     label: "Seedream 5.0 Pro",     desc: "字节旗舰 · 排版/多参考", group: "Poyo", family: "Seedream", provider: "Poyo", cost: 15, caps: ["T2I", "编辑", "10图参考", "2K"] },
  { value: "poyo_grok_image_quality", label: "Grok Imagine 高清版",  desc: "xAI · 1K/2K 高质量",     group: "Poyo", family: "Grok",     provider: "Poyo", costNote: "8-11 cr/张", caps: ["T2I", "编辑", "2K"] },
  { value: "poyo_flux_dev",           label: "Flux Dev",             desc: "BFL · 开源开发版",       group: "Poyo", family: "Flux",     provider: "Poyo", costNote: "4 cr/百万像素", caps: ["T2I", "I2I"] },
  { value: "poyo_flux_schnell",       label: "Flux Schnell",         desc: "BFL · 极速极廉",         group: "Poyo", family: "Flux",     provider: "Poyo", costNote: "0.48 cr/百万像素", caps: ["T2I"] },
  { value: "poyo_nano_banana_2_lite", label: "Nano Banana 2 Lite",   desc: "Gemini Lite · 高性价比", group: "Poyo", family: "Nano",     provider: "Poyo", cost: 5, caps: ["T2I", "编辑"] },

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
  { value: "kie_grok_image",        label: "Grok Image",         desc: "xAI · 高对比",      group: "Kie", family: "Grok",        provider: "Kie", costNote: "≈1 点/张", caps: ["T2I"], note: "每次固定返回一组约 6 张候选（按次计费，张数不可控）" },
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
  // ── #151 round2 新模型 ──
  { value: "kie_nano_banana_2_lite",     label: "Nano Banana 2 Lite",      desc: "Google Lite · 廉价",  group: "Kie", family: "Nano Banana", provider: "Kie", costNote: "4 点/张", caps: ["T2I"] },
  { value: "kie_nano_banana_2_lite_i2i", label: "Nano Banana 2 Lite 编辑", desc: "图生图 · ≤10图",      group: "Kie", family: "Nano Banana", provider: "Kie", costNote: "4 点/张", caps: ["I2I", "编辑"], requiresRef: true },
  { value: "kie_seedream_5pro_i2i",      label: "Seedream 5 Pro 编辑",     desc: "字节旗舰 · 图生图",   group: "Kie", family: "Seedream",    provider: "Kie", costNote: "7 点/张", caps: ["I2I", "编辑"], requiresRef: true },
] as const;

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
  { value: "poyo_sora2_pro_official", label: "Sora 2 Pro 官方版",   group: "Poyo", family: "Sora",     costLabel: "720p 48/1024p 80/1080p 112 cr/s",      caps: ["T2V", "I2V", "1080p"] },
  // ── Veo 3.1 ──
  { value: "poyo_veo",                label: "Veo 3.1 (Fast)",      group: "Poyo", family: "Veo",      costLabel: "模型页",      caps: ["T2V", "I2V", "8s", "4K"] },
  { value: "poyo_veo_fast",           label: "Veo 3.1 Fast",        group: "Poyo", family: "Veo",      costLabel: "模型页",      caps: ["T2V", "I2V", "8s", "4K"] },
  { value: "poyo_veo_quality",        label: "Veo 3.1 Quality",     group: "Poyo", family: "Veo",      costLabel: "模型页",      caps: ["T2V", "I2V", "8s", "4K"] },
  { value: "poyo_veo_lite",           label: "Veo 3.1 Lite",        group: "Poyo", family: "Veo",      costLabel: "模型页(低)",  caps: ["T2V", "8s"] },
  { value: "poyo_veo_fast_official",    label: "Veo 3.1 Fast 官方",   group: "Poyo", family: "Veo", costLabel: "≈10-15 cr/s(4K 30-35)", caps: ["T2V", "I2V", "4/6/8s", "4K", "音频"] },
  { value: "poyo_veo_quality_official", label: "Veo 3.1 Quality 官方", group: "Poyo", family: "Veo", costLabel: "≈24-48 cr/s(4K 48-72)", caps: ["T2V", "I2V", "参考生", "4/6/8s", "4K", "音频"] },
  { value: "poyo_veo_lite_official",    label: "Veo 3.1 Lite 官方",   group: "Poyo", family: "Veo", costLabel: "≈3.6-6 cr/s", caps: ["T2V", "I2V", "4/6/8s", "音频"] },
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
  { value: "poyo_seedance15_pro",     label: "Seedance 1.5 Pro",    group: "Poyo", family: "Seedance", costLabel: "480p 9-21/720p 16-42 cr/次(音频×2)",      caps: ["T2V", "I2V", "音频"] },
  { value: "poyo_seedance",           label: "Seedance 2",          group: "Poyo", family: "Seedance", costLabel: "480p 20/720p 40/1080p 90 cr/s", caps: ["T2V", "首尾帧", "参考", "音频"] },
  { value: "poyo_seedance2_fast",     label: "Seedance 2 Fast",     group: "Poyo", family: "Seedance", costLabel: "模型页(低)",  caps: ["T2V", "720p", "音频"] },
  // ── Hailuo ──
  { value: "poyo_hailuo02",           label: "Hailuo 02",           group: "Poyo", family: "Hailuo",   costLabel: "768p 7 cr/s",      caps: ["T2V", "I2V", "768P"] },
  { value: "poyo_hailuo02_pro",       label: "Hailuo 02 Pro",       group: "Poyo", family: "Hailuo",   costLabel: "65 cr/次",      caps: ["1080P", "6s"] },
  { value: "poyo_hailuo23",           label: "Hailuo 2.3",          group: "Poyo", family: "Hailuo",   costLabel: "768p 35-70/1080p 60 cr/次",      caps: ["T2V", "+首帧", "1080p"] },
  // ── others ──
  { value: "poyo_happy_horse",        label: "Happy Horse",         group: "Poyo", family: "其他",     costLabel: "720p 16/1080p 32 cr/s",      caps: ["四工作流", "1080p"] },
  { value: "poyo_happy_horse_11",     label: "Happy Horse 1.1",     group: "Poyo", family: "其他",     costLabel: "720p 22/1080p 28 cr/s",      caps: ["T2V", "I2V", "参考生", "1080p"] },
  { value: "poyo_omni_flash",         label: "Omni Flash",          group: "Poyo", family: "其他",     costLabel: "720p/1080p 120-220/4K 250-450 cr/次", caps: ["T2V", "I2V", "V2V", "三图融合", "4K"] },
  { value: "poyo_grok_video",         label: "Grok Imagine",        group: "Poyo", family: "其他",     costLabel: "6s 30/10s 40 cr/次",      caps: ["T2V", "I2V", "6/10s"] },
  // ── #151 round2 新模型（计价按 2026-07-round2-final.json）──
  { value: "poyo_grok_video_15",       label: "Grok Imagine Video 1.5", group: "Poyo", family: "其他",     costLabel: "480p 14.5/720p 25 cr/s",  caps: ["I2V", "1-15s"] },
  { value: "poyo_kling_avatar2_std",   label: "Kling Avatar 2.0 标准",  group: "Poyo", family: "Kling",    costLabel: "7 cr/s",                  caps: ["数字人", "图+音频"] },
  { value: "poyo_kling_avatar2_pro",   label: "Kling Avatar 2.0 专业",  group: "Poyo", family: "Kling",    costLabel: "14 cr/s",                 caps: ["数字人", "图+音频"] },
  { value: "poyo_seedance2_mini",      label: "Seedance 2 Mini",        group: "Poyo", family: "Seedance", costLabel: "480p 10/720p 24 cr/s",    caps: ["T2V", "首尾帧", "参考", "音频"] },
  { value: "poyo_wan25_text",          label: "Wan 2.5 文生视频",       group: "Poyo", family: "Wan",      costLabel: "480p 30/720p 60/1080p 90 cr/次(5s)", caps: ["T2V", "5/10s"] },
  { value: "poyo_wan25_image",         label: "Wan 2.5 图生视频",       group: "Poyo", family: "Wan",      costLabel: "480p 30/720p 60/1080p 90 cr/次(5s)", caps: ["I2V", "5/10s"] },
  { value: "poyo_wan_animate_move",    label: "Wan Animate 动作迁移",   group: "Poyo", family: "Wan",      costLabel: "480p 7/580p 12/720p 15 cr/s", caps: ["视频+图", "角色动画"] },
  { value: "poyo_wan_animate_replace", label: "Wan Animate 角色替换",   group: "Poyo", family: "Wan",      costLabel: "480p 7/580p 12/720p 15 cr/s", caps: ["视频+图", "角色替换"] },
  { value: "poyo_runway45",           label: "Runway Gen 4.5",      group: "Poyo", family: "Runway",   costLabel: "5s 75/10s 150 cr/次",      caps: ["T2V", "+1图", "5/10s"] },
  // ── Higgsfield (公共 API 仅 DoP 3 档；其余 Kling/Seedance/Veo 在私有后端) ──
  { value: "hf_dop_standard",         label: "DoP Standard",        group: "Higgsfield", family: "DoP", costLabel: "HF 计费",    caps: ["I2V", "运镜"] },
  { value: "hf_dop_lite",             label: "DoP Lite",            group: "Higgsfield", family: "DoP", costLabel: "HF 计费",    caps: ["I2V", "4s"] },
  { value: "hf_dop_turbo",            label: "DoP Turbo",           group: "Higgsfield", family: "DoP", costLabel: "HF 计费",    caps: ["I2V", "4s"] },
  { value: "mock",                    label: "Mock 测试",           group: "Dev",        family: "Dev", costLabel: "免费",       caps: ["测试"] },
] as const;
