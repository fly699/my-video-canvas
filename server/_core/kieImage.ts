import { storagePut, resolveToAbsoluteUrl } from "server/storage";
import { isImagePersistenceEnabled } from "./storageConfig";
import { KIE_BASE_URL } from "./kie";
import { parseKieJobStatus } from "./kieVideo";
import type { GenerateImageOptions, GenerateImageResponse } from "./imageGeneration";

// kie.ai image models via the UNIFIED jobs API (POST /api/v1/jobs/createTask +
// GET /api/v1/jobs/recordInfo). `id` is kie's wire `model` value (from the API
// docs). Per-model fields below are VERBATIM from docs/kie-api.md — they differ
// per model and must not be sent uniformly (kie ignores unknown keys, but the
// reference-image field name and the aspect field genuinely differ):
//   - ref:    edit/i2i reference field name (image_urls vs input_urls). Presence
//             marks the model as edit (reference image required).
//   - aspect: which field the chosen ratio maps to — "aspect_ratio" for most,
//             "image_size" for Seedream 4.0 (a DIFFERENT value space: tokens like
//             `landscape_16_9`, not "16:9", so the ratio is translated).
//   - outFmt: whether the model accepts output_format (Google/Nano Banana only).
export interface KieImageSpec {
  id: string; label: string; family: string;
  /** 上游端点：jobs(统一 createTask,默认) | flux-kontext(/flux/kontext) | gpt4o(/gpt4o-image)。
   *  专属端点是扁平 body + 各自 record-info 轮询、响应形态不同。 */
  endpoint?: "jobs" | "flux-kontext" | "gpt4o";
  /** 参考图字段名（jobs: image_urls/input_urls 数组或 image_url 单数；flux: inputImage 单数;
   *  gpt4o: filesUrl 数组）。jobs 端点下 ref 存在=编辑模型(必填)；flux/gpt4o 下为可选(有图即编辑)。 */
  ref?: string;
  /** ref 字段为单个 URL 字符串（如 Qwen 的 image_url），而非数组。 */
  refSingle?: boolean;
  /** aspect 字段：aspect_ratio | image_size(令牌空间,Seedream) | image_size_raw(image_size
   *  字段但直接放 aspect 值,Qwen2)。 */
  aspect: "aspect_ratio" | "image_size" | "image_size_raw";
  /** Allowed aspect_ratio enum (verbatim from docs/kie-api.md). The chosen ratio
   *  is clamped to this set; `aspects[0]` is the default. Required for
   *  aspect="aspect_ratio" models (kie 422s on an empty/invalid aspect_ratio). */
  aspects?: readonly string[];
  /** Other REQUIRED input params this model needs (docs/kie-api.md) — e.g.
   *  Seedream 4.5 `quality`, GPT Image `quality`, Flux-2 Pro `resolution`.
   *  Omitting a required field makes kie reject the task. Values are the doc
   *  defaults so behaviour/cost matches kie's own default. */
  fixed?: Record<string, string>;
  outFmt?: boolean;
  /** 可由用户选择的 resolution 档位（如 GPT Image 2 的 1K/2K/4K，逐档计价）。
   *  options.resolution 合法时覆盖 fixed.resolution；首项/fixed 值为默认。 */
  resOptions?: readonly string[];
  /** 该模型 input schema 支持 `negative_prompt`（docs/kie-api.md：仅 Imagen4 家族 /
   *  Ideogram V3 / Qwen 系列）。置 true 才把节点的负向词发进 input.negative_prompt；
   *  其余 kie 图像模型文档无此字段，发了也会被忽略，故按文档只对支持者发送。 */
  negPrompt?: boolean;
}
// Common enum sets (docs/kie-api.md). First entry = default.
const A_NANO = ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "auto"] as const;
const A_NANO_PRO = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "auto"] as const;
const A_SEEDREAM45 = ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"] as const;
const A_FLUX = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"] as const;
const A_FLUX_I2I = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "auto"] as const;
const A_GPT = ["1:1", "2:3", "3:2"] as const;
const A_IMAGEN = ["1:1", "16:9", "9:16", "3:4", "4:3", "auto"] as const;
const A_Z = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;
const A_GROK = ["1:1", "2:3", "3:2", "16:9", "9:16"] as const;
const A_NANO2 = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9", "auto"] as const;
const A_GPT2 = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"] as const;
const A_WAN27 = ["1:1", "16:9", "4:3", "21:9", "3:4", "9:16", "8:1", "1:8"] as const;
const A_QWEN2 = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] as const;
const A_FLUX_KONTEXT = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
const A_4O = ["1:1", "3:2", "2:3"] as const;
export const KIE_IMAGE_MODELS: Record<string, KieImageSpec> = {
  // text-to-image
  kie_nano_banana:      { id: "google/nano-banana", label: "Nano Banana", family: "Nano Banana", aspect: "aspect_ratio", aspects: A_NANO, outFmt: true },
  kie_nano_banana_pro:  { id: "nano-banana-pro", label: "Nano Banana Pro", family: "Nano Banana", aspect: "aspect_ratio", aspects: A_NANO_PRO, outFmt: true },
  kie_seedream_v4:      { id: "bytedance/seedream-v4-text-to-image", label: "Seedream 4.0", family: "Seedream", aspect: "image_size" },
  kie_seedream_45:      { id: "seedream/4.5-text-to-image", label: "Seedream 4.5", family: "Seedream", aspect: "aspect_ratio", aspects: A_SEEDREAM45, fixed: { quality: "basic" } },
  kie_flux2_pro:        { id: "flux-2/pro-text-to-image", label: "Flux-2 Pro", family: "Flux-2", aspect: "aspect_ratio", aspects: A_FLUX, fixed: { resolution: "1K" } },
  kie_gpt_image_15:     { id: "gpt-image/1.5-text-to-image", label: "GPT Image 1.5", family: "GPT Image", aspect: "aspect_ratio", aspects: A_GPT, fixed: { quality: "medium" } },
  kie_imagen4:          { id: "google/imagen4", label: "Imagen 4", family: "Imagen", aspect: "aspect_ratio", aspects: A_IMAGEN, negPrompt: true },
  // Imagen 4 快/超清两档（docs/kie-api.md google/imagen4-fast|ultra；计价 kie-pricing.md:791-792）
  kie_imagen4_fast:     { id: "google/imagen4-fast", label: "Imagen 4 Fast", family: "Imagen", aspect: "aspect_ratio", aspects: A_IMAGEN, negPrompt: true },
  kie_imagen4_ultra:    { id: "google/imagen4-ultra", label: "Imagen 4 Ultra", family: "Imagen", aspect: "aspect_ratio", aspects: A_IMAGEN, negPrompt: true },
  kie_z_image:          { id: "z-image", label: "Z-Image", family: "Z-Image", aspect: "aspect_ratio", aspects: A_Z },
  kie_grok_image:       { id: "grok-imagine/text-to-image", label: "Grok Image", family: "Grok", aspect: "aspect_ratio", aspects: A_GROK },
  // image-to-image / edit (require reference image — note the field name differs!)
  kie_nano_banana_edit: { id: "google/nano-banana-edit", label: "Nano Banana 编辑", family: "Nano Banana", ref: "image_urls", aspect: "aspect_ratio", aspects: A_NANO, outFmt: true },
  kie_seedream_v4_edit: { id: "bytedance/seedream-v4-edit", label: "Seedream 4.0 编辑", family: "Seedream", ref: "image_urls", aspect: "image_size" },
  kie_flux2_pro_i2i:    { id: "flux-2/pro-image-to-image", label: "Flux-2 Pro 图生图", family: "Flux-2", ref: "input_urls", aspect: "aspect_ratio", aspects: A_FLUX_I2I, fixed: { resolution: "1K" } },
  kie_gpt_image_15_edit:{ id: "gpt-image/1.5-image-to-image", label: "GPT Image 1.5 编辑", family: "GPT Image", ref: "input_urls", aspect: "aspect_ratio", aspects: A_GPT, fixed: { quality: "medium" } },
  // ── 第二批扩充（均走 jobs/createTask，参数对照 docs/kie-api.md）──
  kie_nano_banana_2:   { id: "nano-banana-2", label: "Nano Banana 2", family: "Nano Banana", aspect: "aspect_ratio", aspects: A_NANO2, fixed: { resolution: "1K", output_format: "jpg" }, resOptions: ["1K", "2K", "4K"] },
  kie_flux2_flex:      { id: "flux-2/flex-text-to-image", label: "Flux-2 Flex", family: "Flux-2", aspect: "aspect_ratio", aspects: A_FLUX, fixed: { resolution: "1K" }, resOptions: ["1K", "2K"] },
  kie_flux2_flex_i2i:  { id: "flux-2/flex-image-to-image", label: "Flux-2 Flex 图生图", family: "Flux-2", ref: "input_urls", aspect: "aspect_ratio", aspects: A_FLUX_I2I, fixed: { resolution: "1K" }, resOptions: ["1K", "2K"] },
  kie_gpt_image_2:     { id: "gpt-image-2-text-to-image", label: "GPT Image 2", family: "GPT Image", aspect: "aspect_ratio", aspects: A_GPT2, fixed: { resolution: "1K" }, resOptions: ["1K", "2K", "4K"] },
  kie_gpt_image_2_i2i: { id: "gpt-image-2-image-to-image", label: "GPT Image 2 图生图", family: "GPT Image", ref: "input_urls", aspect: "aspect_ratio", aspects: A_GPT2, fixed: { resolution: "1K" }, resOptions: ["1K", "2K", "4K"] },
  kie_seedream_5lite:  { id: "seedream/5-lite-text-to-image", label: "Seedream 5.0 Lite", family: "Seedream", aspect: "aspect_ratio", aspects: A_SEEDREAM45, fixed: { quality: "basic" } },
  // ── #151 round2 新模型（v2 文档给全 schema）──
  // nano-banana-2-lite：createTask，aspect_ratio 必填(默认 auto，枚举同 nano-banana-2)，image_urls ≤10 可选（拆 t2i/i2i 两条对齐现架构）
  kie_nano_banana_2_lite:     { id: "nano-banana-2-lite", label: "Nano Banana 2 Lite", family: "Nano Banana", aspect: "aspect_ratio", aspects: A_NANO2 },
  kie_nano_banana_2_lite_i2i: { id: "nano-banana-2-lite", label: "Nano Banana 2 Lite 编辑", family: "Nano Banana", ref: "image_urls", aspect: "aspect_ratio", aspects: A_NANO2 },
  // Seedream 5 Pro 图生图：createTask，model=seedream/5-pro-image-to-image；prompt 3-5000、image_urls 必填、
  // aspect_ratio 8 值枚举、quality basic(1K,7点)/high(2K,14点) 必填——固定 basic 档
  kie_seedream_5pro_i2i: { id: "seedream/5-pro-image-to-image", label: "Seedream 5 Pro 编辑", family: "Seedream", ref: "image_urls", aspect: "aspect_ratio", aspects: A_SEEDREAM45, fixed: { quality: "basic" } },
  kie_seedream_5lite_i2i: { id: "seedream/5-lite-image-to-image", label: "Seedream 5.0 Lite 编辑", family: "Seedream", ref: "image_urls", aspect: "aspect_ratio", aspects: A_SEEDREAM45, fixed: { quality: "basic" } },
  kie_wan27_image:     { id: "wan/2-7-image", label: "Wan 2.7 Image", family: "Wan", aspect: "aspect_ratio", aspects: A_WAN27, fixed: { resolution: "1K" } },
  kie_wan27_image_pro: { id: "wan/2-7-image-pro", label: "Wan 2.7 Image Pro", family: "Wan", aspect: "aspect_ratio", aspects: A_WAN27, fixed: { resolution: "1K" } },
  kie_ideogram_v3:     { id: "ideogram/v3-text-to-image", label: "Ideogram V3", family: "Ideogram", aspect: "image_size", negPrompt: true },
  kie_qwen_image:      { id: "qwen/text-to-image", label: "Qwen Image", family: "Qwen", aspect: "image_size", negPrompt: true },
  // ── 特殊端点批：Qwen 图生图/编辑（参考图字段是单数 image_url；Qwen2 用 image_size 放 aspect 值）──
  kie_qwen_image_i2i:  { id: "qwen/image-to-image", label: "Qwen Image 图生图", family: "Qwen", ref: "image_url", refSingle: true, aspect: "image_size", negPrompt: true },
  kie_qwen_image_edit: { id: "qwen/image-edit", label: "Qwen Image 编辑", family: "Qwen", ref: "image_url", refSingle: true, aspect: "image_size", negPrompt: true },
  kie_qwen2_image_edit:{ id: "qwen2/image-edit", label: "Qwen2 Image 编辑", family: "Qwen", ref: "image_url", refSingle: true, aspect: "image_size_raw", aspects: A_QWEN2 },
  // ── 专属端点批：Flux Kontext（/flux/kontext）+ OpenAI 4o Image（/gpt4o-image）──
  // ref 在这两个端点下为「可选」（有图即编辑），不抛缺图错误（仅 jobs 端点的编辑模型必填）。
  kie_flux_kontext_pro: { id: "flux-kontext-pro", label: "Flux Kontext Pro", family: "Flux Kontext", endpoint: "flux-kontext", ref: "inputImage", aspect: "aspect_ratio", aspects: A_FLUX_KONTEXT },
  kie_flux_kontext_max: { id: "flux-kontext-max", label: "Flux Kontext Max", family: "Flux Kontext", endpoint: "flux-kontext", ref: "inputImage", aspect: "aspect_ratio", aspects: A_FLUX_KONTEXT },
  kie_gpt_4o_image:     { id: "gpt-4o-image", label: "GPT-4o Image", family: "GPT Image", endpoint: "gpt4o", ref: "filesUrl", aspect: "image_size_raw", aspects: A_4O },
};

// Seedream 4.0 uses `image_size` with a token vocabulary instead of "16:9" ratios.
// Translate the canvas's aspect-ratio string to the nearest Seedream token
// (docs/kie-api.md §Seedream4.0); default square_hd when unknown.
const SEEDREAM_SIZE: Record<string, string> = {
  "1:1": "square_hd", "16:9": "landscape_16_9", "9:16": "portrait_16_9",
  "4:3": "landscape_4_3", "3:4": "portrait_4_3", "3:2": "landscape_3_2",
  "2:3": "portrait_3_2", "21:9": "landscape_21_9",
};
// Ideogram V3 / Qwen text-to-image / Qwen image-edit 的 image_size 枚举只有 6 个基础
// 令牌（无 *_3_2 / *_21_9，docs/kie-api.md ideogram-v3 / qwen-text-to-image /
// qwen-image-edit）。用户选 3:2/2:3/21:9 时不能发 landscape_3_2 等（会 422），就近
// 映射到合法令牌——既不报错也不删用户的比例选项（功能不减）。
const REDUCED_IMAGE_SIZE: Record<string, string> = {
  "1:1": "square_hd", "16:9": "landscape_16_9", "9:16": "portrait_16_9",
  "4:3": "landscape_4_3", "3:4": "portrait_4_3",
  "3:2": "landscape_4_3", "2:3": "portrait_4_3", "21:9": "landscape_16_9",
};
const REDUCED_SIZE_MODELS = new Set(["kie_ideogram_v3", "kie_qwen_image", "kie_qwen_image_edit"]);

export function isKieImageModel(model?: string): boolean {
  return !!model && model in KIE_IMAGE_MODELS;
}

/** 文生图 → 同族图生图兄弟模型（jobs 端点）。带参考图却选中 t2i 模型时自动切换，
 *  否则参考图被静默丢弃——模型根本看不到图，「与参考图相同场景」类提示词（画面推演/
 *  多角度宫格/剧情推演等）必然产出无关画面（2026-07 真实故障：GPT Image 2 推演跑偏）。
 *  只登记同版本、参数兼容的精确配对，禁止跨版本猜配（如 Seedream 4.5 无同版编辑模型就不配）。 */
export const KIE_T2I_TO_I2I: Record<string, string> = {
  kie_nano_banana_2_lite: "kie_nano_banana_2_lite_i2i", // #151
  kie_nano_banana: "kie_nano_banana_edit",
  kie_seedream_v4: "kie_seedream_v4_edit",
  kie_flux2_pro: "kie_flux2_pro_i2i",
  kie_flux2_flex: "kie_flux2_flex_i2i",
  kie_gpt_image_15: "kie_gpt_image_15_edit",
  kie_gpt_image_2: "kie_gpt_image_2_i2i",
  kie_seedream_5lite: "kie_seedream_5lite_i2i",
  kie_qwen_image: "kie_qwen_image_i2i",
};

/** 把用户比例夹到模型枚举内：命中原样用；未命中按数值就近（对数距离）挑最接近项，
 *  而不是一律回落枚举首位——旧行为会把 21:9 宽幅源图夹成 auto/1:1 方图。
 *  未传比例仍回枚举首位默认；"auto" 等非数值令牌不参与就近比较。 */
export function clampAspectTo(aspects: readonly string[], aspect: string | undefined): string {
  // 未传比例：枚举含 "auto" 优先用 auto（图生图下 = 跟随输入图画幅，文生图下 = 模型自定），
  // 否则回枚举首位——这是编辑/i2i 模型「保持原图比例」的兜底（nano-banana-edit 首位是 1:1，
  // 旧行为把所有未传比例的编辑请求压成方图）。
  if (!aspect) return aspects.includes("auto") ? "auto" : aspects[0];
  if (!aspects.length) return aspects[0];
  if (aspects.includes(aspect)) return aspect;
  const ratioOf = (s: string): number => {
    const m = /^(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)$/.exec(s.trim());
    const v = m ? Number(m[1]) / Number(m[2]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : NaN;
  };
  const want = ratioOf(aspect);
  if (!Number.isFinite(want)) return aspects[0];
  let best = aspects[0];
  let bestDist = Infinity;
  for (const c of aspects) {
    const v = ratioOf(c);
    if (!Number.isFinite(v)) continue;
    const d = Math.abs(Math.log(v / want));
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

/** 该 kie 图像模型的 input schema 是否支持 negative_prompt（Imagen4 家族 / Ideogram V3 /
 *  Qwen 系列）。router 据此决定：支持者「干净 prompt + 单独传负向」，否则退回把负向词塞进
 *  prompt 当「Avoid: …」后缀（因 API 无该字段）。 */
export function kieImageSupportsNegative(model?: string): boolean {
  return !!model && KIE_IMAGE_MODELS[model]?.negPrompt === true;
}

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 100; // 5 min max — GPT Image 2 等新模型实测可超 3 分钟

// The resolved kie key is passed in by the router (which owns the kie auth via
// resolveKieKey); this function never touches the whitelist or env directly.
/** kie 上游瞬时故障判定（Internal Error/超时/5xx——kie 失败任务不计费，可安全重试）。 */
const isTransientKieError = (msg: string) => /internal error|try again|timeout|timed out|server error|\b50[234]\b/i.test(msg);

/** 带一次自动重试的 kie 图像生成：上游偶发 Internal Error（真机用户报障），盲目直报会让
 *  用户手动重来；瞬时错误自动重试 1 次（间隔 2.5s），仍失败则带模型名与归因提示抛出。 */
export async function generateImageKie(options: GenerateImageOptions): Promise<GenerateImageResponse> {
  try {
    return await generateImageKieOnce(options);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isTransientKieError(msg)) throw e;
    await new Promise((r) => setTimeout(r, 2500));
    try {
      return await generateImageKieOnce(options);
    } catch (e2) {
      const m2 = e2 instanceof Error ? e2.message : String(e2);
      throw new Error(`${m2}（模型 ${options.model}；上游 kie.ai 服务故障，已自动重试 1 次仍失败——非本系统问题，请稍后再试或更换模型）`);
    }
  }
}

async function generateImageKieOnce(options: GenerateImageOptions): Promise<GenerateImageResponse> {
  const apiKey = options.kieApiKey;
  if (!apiKey) throw new Error("kie API key 未解析（内部错误）");
  let spec = KIE_IMAGE_MODELS[options.model ?? ""];
  if (!spec) throw new Error(`未知 kie 图像模型：${options.model}`);

  // kie 从公网拉取参考图：相对路径（/manus-storage/...）它无法解析 → 4xx。
  // 与 poyoVideo.ts 完全同构（trim/filter → Set 去重保序 → resolveToAbsoluteUrl），
  // 该口径已在 Poyo 链路实测通过，勿引入差异。
  const rawRefs = Array.from(new Set(
    (options.originalImages ?? []).map((o) => o.url?.trim()).filter((u): u is string => Boolean(u)),
  ));
  // 带参考图但选中的是纯文生图模型（jobs 端点无 ref 字段）→ 自动切到同族图生图，
  // 否则参考图会被静默丢弃、产物与源图完全无关（画面推演/多角度宫格真实故障）。
  if (rawRefs.length && !spec.ref && !spec.endpoint) {
    const sibling = KIE_T2I_TO_I2I[options.model ?? ""];
    if (sibling && KIE_IMAGE_MODELS[sibling]) spec = KIE_IMAGE_MODELS[sibling];
  }

  const endpoint = spec.endpoint ?? "jobs";
  const aspect = options.size ?? options.reveAspectRatio;
  const clampAspect = (def: string): string => clampAspectTo(spec.aspects ?? [def], aspect);
  const refs = await Promise.all(rawRefs.map((u) => resolveToAbsoluteUrl(u)));

  // ── Build per-endpoint submit URL + body ──
  let submitUrl: string;
  let submitBody: Record<string, unknown>;
  if (endpoint === "flux-kontext") {
    // Flux Kontext: 扁平 body，inputImage 可选(有图即编辑)，aspectRatio 枚举，输出 png。
    const b: Record<string, unknown> = {
      model: spec.id, prompt: options.prompt,
      aspectRatio: clampAspect("16:9"), outputFormat: "png",
      enableTranslation: true, safetyTolerance: 2,
    };
    if (refs[0]) b.inputImage = refs[0];
    submitUrl = `${KIE_BASE_URL}/api/v1/flux/kontext/generate`;
    submitBody = b;
  } else if (endpoint === "gpt4o") {
    // GPT-4o Image: size 必填(1:1/3:2/2:3)，filesUrl 数组(≤5)可选(有图即编辑)，带回退。
    const b: Record<string, unknown> = {
      prompt: options.prompt || undefined, size: clampAspect("1:1"),
      enableFallback: true, fallbackModel: "FLUX_MAX",
    };
    if (refs.length) b.filesUrl = refs.slice(0, 5);
    submitUrl = `${KIE_BASE_URL}/api/v1/gpt4o-image/generate`;
    submitBody = b;
  } else {
    // 统一 jobs：参数嵌在 input 内（既有逻辑，零回归）。
    const input: Record<string, unknown> = { prompt: options.prompt };
    if (spec.outFmt) input.output_format = "png";
    if (spec.aspect === "image_size") {
      const sizeTable = REDUCED_SIZE_MODELS.has(options.model ?? "") ? REDUCED_IMAGE_SIZE : SEEDREAM_SIZE;
      input.image_size = (aspect && sizeTable[aspect]) || "square_hd";
    }
    else if (spec.aspect === "image_size_raw") input.image_size = clampAspect("1:1");
    else input.aspect_ratio = clampAspect("1:1");
    if (spec.fixed) for (const [k, v] of Object.entries(spec.fixed)) input[k] = v;
    // 用户可选分辨率档（合法时覆盖 fixed 默认；逐档计价，如 GPT Image 2 1K/2K/4K=6/10/16 点）
    if (spec.resOptions && options.resolution && spec.resOptions.includes(options.resolution)) {
      input.resolution = options.resolution;
    }
    // 负向提示词：仅对文档明确支持的模型发送（Imagen4 家族 / Ideogram V3 / Qwen 系列）。
    if (spec.negPrompt && options.negativePrompt?.trim()) input.negative_prompt = options.negativePrompt.trim();
    if (spec.ref) { // jobs 端点下 ref 存在 = 编辑模型，必填
      if (refs.length === 0) throw new Error(`${spec.label} 需要参考图，请先连接或上传参考图`);
      input[spec.ref] = spec.refSingle ? refs[0] : refs;
    }
    submitUrl = `${KIE_BASE_URL}/api/v1/jobs/createTask`;
    submitBody = { model: spec.id, input };
  }

  const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(submitBody),
    signal: AbortSignal.timeout(15_000),
  });
  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    throw new Error(`kie 图像提交失败 (${submitRes.status}): ${text.slice(0, 300)}`);
  }
  const submitData = (await submitRes.json()) as { code?: number; msg?: string; data?: { taskId?: string } };
  if (submitData.code !== 200 || !submitData.data?.taskId) {
    throw new Error(`kie 图像提交返回错误 (code ${submitData.code}): ${submitData.msg ?? ""}`);
  }
  const taskId = submitData.data.taskId;

  // ── Poll per-endpoint record URL until success/failed ──
  const recordUrl = kieImageRecordUrl(endpoint);
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await fetch(`${recordUrl}${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!statusRes.ok) {
      if (statusRes.status === 429 || statusRes.status >= 500) continue; // transient
      throw new Error(`kie 状态查询失败 (${statusRes.status})`);
    }
    const body = (await statusRes.json()) as KieImageRecordBody;
    // #317 状态判读抽为纯函数 parseKieImageRecord（轮询与「重新检测」找回共用同一判读，零口径漂移）。
    const st = parseKieImageRecord(endpoint, options.model, taskId, body);
    if (st.kind === "finished") {
      if (!st.urls.length) throw new Error("[CHARGED] kie 图像生成完成但未返回 URL（积分可能已扣，请勿重试）");
      return persistKieImages(st.urls);
    }
    if (st.kind === "failed") throw new Error(`kie 图像生成失败：${st.error ?? "未知错误"}`);
  }
  // #315/#317 超时不丢线索：任务已在平台侧提交、可能仍在生成——附 RECOVERABLE 标记
  // （provider+端点+taskId），前端失败红条据此显示「重新检测」免费找回结果。
  throw new Error(`kie 图像生成超时：任务可能仍在平台侧运行、完成后照常扣费——可稍候在节点失败提示上点「重新检测」免费找回结果 [RECOVERABLE:kie:${endpoint}:${taskId}]`);
}

/** kie 图像三端点的 record-info 查询 URL 前缀（轮询与找回共用）。 */
export function kieImageRecordUrl(endpoint: string): string {
  return endpoint === "flux-kontext"
    ? `${KIE_BASE_URL}/api/v1/flux/kontext/record-info?taskId=`
    : endpoint === "gpt4o"
    ? `${KIE_BASE_URL}/api/v1/gpt4o-image/record-info?taskId=`
    : `${KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId=`;
}

/** record-info 轮询响应统一把结果放在 data.response（回调才是 data.info，勿混用）：
 *    flux-kontext → response.resultImageUrl（单数驼峰）
 *    gpt4o        → response.result_urls（数组蛇形）
 *    jobs         → 字段不统一（successFlag/state、result_urls/resultUrls/…），
 *                   复用视频的 parseKieJobStatus 多形态解析（GPT Image 2 等新模型
 *                   实测返回 state="success"，旧解析只认 successFlag=1 → 误报超时）。 */
export type KieImageRecordBody = {
  code?: number;
  data?: Record<string, unknown> & {
    successFlag?: number; errorMessage?: string;
    response?: { resultImageUrl?: string; result_urls?: string[]; resultUrls?: string[] | string };
  };
};

/** #317 kie 图像任务状态判读（纯函数）：pending / finished(urls) / failed(error)。 */
export function parseKieImageRecord(
  endpoint: string, model: string | undefined, taskId: string, body: KieImageRecordBody,
): { kind: "pending" } | { kind: "finished"; urls: string[] } | { kind: "failed"; error?: string } {
  const d = body.data;
  if (!d) return { kind: "pending" };
  if (endpoint === "flux-kontext" || endpoint === "gpt4o") {
    if (d.successFlag === 1) {
      const urls = endpoint === "flux-kontext"
        ? (d.response?.resultImageUrl ? [d.response.resultImageUrl] : [])
        : (d.response?.result_urls ?? []);
      return { kind: "finished", urls };
    }
    if (d.successFlag === 2 || d.successFlag === 3) return { kind: "failed", error: d.errorMessage };
    return { kind: "pending" };
  }
  // jobs 端点：多形态解析（与视频共用）。
  const st = parseKieJobStatus(d, model ?? "", taskId);
  if (st.status === "finished") return { kind: "finished", urls: st.resultVideoUrls ?? [] };
  if (st.status === "failed") return { kind: "failed", error: st.errorMessage };
  return { kind: "pending" };
}

/** #317 结果找回：单次查询 kie 图像任务状态（不重新提交、零新扣费）。密钥由调用方按
 *  generate 同款三级链路（临时>分配>公用 + 白名单门控）解析后传入。finished → 走与
 *  正常轮询同一条 persistKieImages 转存链路。 */
export async function recheckKieImageTask(opts: { taskId: string; endpoint: "flux-kontext" | "gpt4o" | "jobs"; apiKey: string; model?: string }): Promise<{ done: boolean; url?: string; urls?: string[]; status: string; error?: string }> {
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(opts.taskId)) throw new Error("非法的任务 id");
  const res = await fetch(`${kieImageRecordUrl(opts.endpoint)}${encodeURIComponent(opts.taskId)}`, {
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`kie 状态查询失败 (${res.status})`);
  const body = (await res.json()) as KieImageRecordBody;
  const st = parseKieImageRecord(opts.endpoint, opts.model, opts.taskId, body);
  if (st.kind === "finished") {
    if (!st.urls.length) return { done: false, status: "failed", error: "生成完成但未返回 URL（积分可能已扣）" };
    const r = await persistKieImages(st.urls);
    return { done: true, url: r.url, urls: r.urls, status: "finished" };
  }
  if (st.kind === "failed") return { done: false, status: "failed", error: st.error ?? "未知错误" };
  return { done: false, status: "generating" };
}

// 把 kie 生成结果转存到我方存储，避免链接失效。
//
// 为什么：kie 的结果 URL 只保留 14 天就会被删除（见 API 文档「Data Retention」），
// 不转存的话画布里的图 14 天后就打不开。做法与现有 Poyo 图片完全一致（同一问题、
// 同一解法，只是过期窗口不同：Poyo ~24h / kie 14 天）——这就是“镜像 Poyo”的含义，
// 并非调用 Poyo，两者上游互相独立。
//
// 流程：
//   1. 看管理后台「存储设置」的 persistImage 开关（isImagePersistenceEnabled）。
//   2. 开 → 逐张 fetch kie 原图 → storagePut 存到我方 MinIO/S3/Forge → 返回我方长期 URL；
//      同时把 kie 原始 URL 放进 sourceUrl 作短期兜底。
//   3. 关 / 转存失败 → 回退用 kie 原始 URL（不占我方存储，但 14 天后会失效）。
async function persistKieImages(urls: string[]): Promise<GenerateImageResponse> {
  if (!(await isImagePersistenceEnabled())) {
    return { url: urls[0], urls, sourceUrl: urls[0], sourceUrls: urls, sourceAt: Date.now() };
  }
  const out: string[] = [];
  const src: string[] = [];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (!r.ok) { out.push(u); src.push(u); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get("content-type") ?? "image/png";
      const { url } = await storagePut(`generated/${Date.now()}-${out.length}.png`, buf, mime);
      out.push(url); src.push(u);
    } catch {
      out.push(u); src.push(u); // fall back to the kie URL on persist failure
    }
  }
  return { url: out[0], urls: out, sourceUrl: src[0], sourceUrls: src, sourceAt: Date.now() };
}
