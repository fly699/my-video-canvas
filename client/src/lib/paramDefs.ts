// ---------------------------------------------------------------------------
// Schema-driven parameter definitions (shared by image — and later video — nodes)
// ---------------------------------------------------------------------------
// Instead of hand-writing a conditional <select> block per model (which scales
// terribly as the model list grows), each model declares a list of ParamDef.
// The <ParamControls> renderer (components/canvas/ParamControls.tsx) turns these
// into controls bound to the node payload via `update(key, value)`.
//
// `key` is the node-payload field the control reads/writes. Image models write
// to the generic fields (imageSize / imageResolution / imageN /
// imageOutputFormat) plus the legacy `poyoQuality` for GPT quality — these are
// forwarded to the backend's POYO_IMAGE_SPECS builder.

export type ParamDef =
  | { key: string; type: "select"; label: string; options: readonly string[] | readonly { value: string; label: string }[]; default?: string }
  | { key: string; type: "number"; label: string; min?: number; max?: number; step?: number; default?: number }
  | { key: string; type: "toggle"; label: string; default?: boolean };

// ---- Option sets (from docs/poyo-image-api.md) ----
const ASPECT_FULL = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"] as const;
const ASPECT_AUTO = ["auto", ...ASPECT_FULL] as const;
const GPT_SIZES = ["auto", "1:1", "2:3", "3:2", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"] as const;
const GROK_SIZES = ["2:3", "3:2", "1:1", "16:9", "9:16"] as const;
const Z_SIZES = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;
const FLUX_KONTEXT_SIZES = ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21"] as const;
const WAN_SIZES = ["1024x1024", "768x1024", "1024x768", "576x1024", "1024x576", "512x512"] as const;

const RES_124 = ["1K", "2K", "4K"] as const;
const RES_12 = ["1K", "2K"] as const;
const RES_24 = ["2K", "4K"] as const;
const RES_23 = ["2K", "3K"] as const;
const FMT_PNG_JPG = ["png", "jpg"] as const;
const FMT_KLING = ["jpeg", "png", "webp"] as const;
const QUALITY = ["low", "medium", "high"] as const;

const sizeDef = (options: readonly string[], def?: string): ParamDef => ({ key: "imageSize", type: "select", label: "尺寸 / 比例", options, default: def });
const resDef = (options: readonly string[], def?: string): ParamDef => ({ key: "imageResolution", type: "select", label: "分辨率", options, default: def });
const nDef = (max: number): ParamDef => ({ key: "imageN", type: "number", label: "数量 n", min: 1, max, step: 1, default: 1 });
const fmtDef = (options: readonly string[]): ParamDef => ({ key: "imageOutputFormat", type: "select", label: "格式", options, default: options[0] });
const qualityDef: ParamDef = { key: "poyoQuality", type: "select", label: "质量", options: QUALITY, default: "medium" };

// ---- Per-model image param specs ----
// Keyed by IMAGE_MODELS `value`. Models absent here (manus_forge, hf_*) are
// handled by their own bespoke controls in the node.
export const IMAGE_MODEL_PARAMS: Record<string, ParamDef[]> = {
  // Nano Banana
  poyo_nano_banana: [],
  poyo_nano_banana_2: [],
  poyo_nano_banana_pro: [sizeDef(ASPECT_AUTO, "auto"), resDef(RES_124, "1K"), fmtDef(FMT_PNG_JPG)],
  // GPT Image
  poyo_gpt_4o_image: [],
  poyo_gpt_image_15: [qualityDef],
  poyo_gpt_image: [sizeDef(GPT_SIZES, "auto"), resDef(RES_124, "1K"), qualityDef],
  // Flux
  poyo_flux: [sizeDef(ASPECT_FULL, "16:9")],
  poyo_sdxl: [sizeDef(ASPECT_FULL, "16:9")],
  poyo_flux_kontext_pro: [sizeDef(FLUX_KONTEXT_SIZES, "1:1"), fmtDef(FMT_PNG_JPG)],
  poyo_flux_kontext_max: [sizeDef(FLUX_KONTEXT_SIZES, "1:1"), fmtDef(FMT_PNG_JPG)],
  // Seedream
  // seedream-4 has a documented separate `resolution` field (1K/2K/4K).
  poyo_seedream_4: [sizeDef(ASPECT_FULL, "16:9"), resDef(RES_124, "2K"), nDef(15)],
  // seedream-4.5 / 5.0-lite: per docs the resolution preset IS a `size` value
  // (no separate resolution field) — so fold 2K/4K (resp. 2K/3K) into `size`
  // alongside the aspect-ratio presets, and don't send a `resolution` field.
  poyo_seedream: [sizeDef(["2K", "4K", ...ASPECT_FULL], "2K")],
  poyo_seedream_5_lite: [sizeDef(["2K", "3K", ...ASPECT_FULL], "2K")],
  // Wan
  poyo_wan_image: [sizeDef(WAN_SIZES, "1024x1024"), nDef(4)],
  poyo_wan_image_pro: [sizeDef(WAN_SIZES, "1024x1024"), nDef(4)],
  // Kling
  poyo_kling_o1_image: [sizeDef(ASPECT_AUTO, "auto"), resDef(RES_12, "1K"), nDef(9), fmtDef(FMT_KLING)],
  poyo_kling_o3_image: [sizeDef(ASPECT_AUTO, "auto"), resDef(RES_124, "1K"), nDef(9), fmtDef(FMT_KLING)],
  // Others
  poyo_z_image: [sizeDef(Z_SIZES, "16:9")],
  poyo_grok_image: [sizeDef(GROK_SIZES, "16:9")],
};

/** Normalize a ParamDef option list to {value,label}[] for rendering. */
export function paramOptions(def: Extract<ParamDef, { type: "select" }>): { value: string; label: string }[] {
  return def.options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

// Resolve the effective value of an image param: the persisted payload value,
// else the ParamDef default. The controls only DISPLAY def.default — they don't
// persist it until the user interacts — so a model whose field is required
// upstream (e.g. z-image text-to-image `size`) would otherwise submit empty.
// Used at submit time to forward the value the user actually sees.
export function resolveImageParam(model: string | undefined, key: string, persisted: unknown): unknown {
  if (persisted !== undefined && persisted !== "") return persisted;
  if (!model) return persisted;
  const def = (IMAGE_MODEL_PARAMS[model] ?? []).find((d) => d.key === key);
  return def?.default ?? persisted;
}

// poyo 模型的「尺寸/比例」解析（修复「统一画面比例对 poyo 图像模型失效」）：
// 优先级 = 用户在节点上显式选的 imageSize > 规划统一比例（仅当该模型的 imageSize 选项确实
// 接受这个比例字符串时）> 模型默认。
// 为什么需要：智能体/配方的统一比例此前只写进 legacy `poyoAspectRatio` 字段，而本函数的旧
// 实现（resolveImageParam）总会把 `imageSize` 填成模型默认；服务端 `size = imageSize ?? poyoAspectRatio`
// 永远取默认 imageSize，poyoAspectRatio 被彻底遮蔽 → 统一比例对 poyo 无效。
// 模型感知是必须的：多数 poyo 模型的 imageSize 直接收 "16:9" 这类比例串，但 WAN 只收
// "1024x1024" 这类 WxH token（塞 "9:16" 会被 poyo 拒），故仅当比例在该模型选项内才采用。
export function resolvePoyoImageSize(model: string | undefined, persistedImageSize: unknown, unifiedAspect: unknown): unknown {
  if (persistedImageSize !== undefined && persistedImageSize !== "") return persistedImageSize;
  if (typeof unifiedAspect === "string" && unifiedAspect && model) {
    const def = (IMAGE_MODEL_PARAMS[model] ?? []).find((d) => d.key === "imageSize");
    if (def?.type === "select") {
      const values = paramOptions(def).map((o) => o.value);
      if (values.includes(unifiedAspect)) return unifiedAspect;
    }
  }
  return resolveImageParam(model, "imageSize", persistedImageSize);
}
