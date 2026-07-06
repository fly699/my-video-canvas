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
export async function generateImageKie(options: GenerateImageOptions): Promise<GenerateImageResponse> {
  const apiKey = options.kieApiKey;
  if (!apiKey) throw new Error("kie API key 未解析（内部错误）");
  const spec = KIE_IMAGE_MODELS[options.model ?? ""];
  if (!spec) throw new Error(`未知 kie 图像模型：${options.model}`);

  const endpoint = spec.endpoint ?? "jobs";
  const aspect = options.size ?? options.reveAspectRatio;
  const clampAspect = (def: string): string => {
    const a = spec.aspects ?? [def];
    return aspect && a.includes(aspect) ? aspect : a[0];
  };
  // kie 从公网拉取参考图：相对路径（/manus-storage/...）它无法解析 → 4xx。
  // 与 poyoVideo.ts 完全同构（trim/filter → Set 去重保序 → resolveToAbsoluteUrl），
  // 该口径已在 Poyo 链路实测通过，勿引入差异。
  const rawRefs = Array.from(new Set(
    (options.originalImages ?? []).map((o) => o.url?.trim()).filter((u): u is string => Boolean(u)),
  ));
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
  const recordUrl = endpoint === "flux-kontext"
    ? `${KIE_BASE_URL}/api/v1/flux/kontext/record-info?taskId=`
    : endpoint === "gpt4o"
    ? `${KIE_BASE_URL}/api/v1/gpt4o-image/record-info?taskId=`
    : `${KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId=`;
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
    const body = (await statusRes.json()) as {
      code?: number;
      data?: Record<string, unknown> & {
        successFlag?: number; errorMessage?: string;
        // record-info 轮询响应统一把结果放在 data.response（回调才是 data.info，勿混用）：
        //   flux-kontext → response.resultImageUrl（单数驼峰）
        //   gpt4o        → response.result_urls（数组蛇形）
        //   jobs         → 字段不统一（successFlag/state、result_urls/resultUrls/…），
        //                  复用视频的 parseKieJobStatus 多形态解析（GPT Image 2 等新模型
        //                  实测返回 state="success"，旧解析只认 successFlag=1 → 误报超时）
        response?: { resultImageUrl?: string; result_urls?: string[]; resultUrls?: string[] | string };
      };
    };
    const d = body.data;
    if (!d) continue;
    if (endpoint === "flux-kontext" || endpoint === "gpt4o") {
      if (d.successFlag === 1) {
        const urls = endpoint === "flux-kontext"
          ? (d.response?.resultImageUrl ? [d.response.resultImageUrl] : [])
          : (d.response?.result_urls ?? []);
        if (!urls.length) throw new Error("[CHARGED] kie 图像生成完成但未返回 URL（积分可能已扣，请勿重试）");
        return persistKieImages(urls);
      }
      if (d.successFlag === 2 || d.successFlag === 3) {
        throw new Error(`kie 图像生成失败：${d.errorMessage ?? "未知错误"}`);
      }
      continue;
    }
    // jobs 端点：多形态解析（与视频共用）。
    const st = parseKieJobStatus(d, options.model, taskId);
    if (st.status === "finished") return persistKieImages(st.resultVideoUrls ?? []);
    if (st.status === "failed") throw new Error(`kie 图像生成失败：${st.errorMessage ?? "未知错误"}`);
  }
  throw new Error("kie 图像生成超时");
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
