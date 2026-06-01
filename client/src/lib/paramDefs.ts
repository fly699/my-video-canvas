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
  poyo_seedream_4: [sizeDef(ASPECT_FULL, "16:9"), resDef(RES_124, "2K"), nDef(15)],
  poyo_seedream: [sizeDef(ASPECT_FULL, "16:9"), resDef(RES_24, "2K")],
  poyo_seedream_5_lite: [sizeDef(ASPECT_FULL, "16:9"), resDef(RES_23, "2K")],
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
