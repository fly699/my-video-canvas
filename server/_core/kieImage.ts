import { storagePut } from "server/storage";
import { isImagePersistenceEnabled } from "./storageConfig";
import { KIE_BASE_URL } from "./kie";
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
  ref?: "image_urls" | "input_urls";
  aspect: "aspect_ratio" | "image_size";
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
export const KIE_IMAGE_MODELS: Record<string, KieImageSpec> = {
  // text-to-image
  kie_nano_banana:      { id: "google/nano-banana", label: "Nano Banana", family: "Nano Banana", aspect: "aspect_ratio", aspects: A_NANO, outFmt: true },
  kie_nano_banana_pro:  { id: "nano-banana-pro", label: "Nano Banana Pro", family: "Nano Banana", aspect: "aspect_ratio", aspects: A_NANO_PRO, outFmt: true },
  kie_seedream_v4:      { id: "bytedance/seedream-v4-text-to-image", label: "Seedream 4.0", family: "Seedream", aspect: "image_size" },
  kie_seedream_45:      { id: "seedream/4.5-text-to-image", label: "Seedream 4.5", family: "Seedream", aspect: "aspect_ratio", aspects: A_SEEDREAM45, fixed: { quality: "basic" } },
  kie_flux2_pro:        { id: "flux-2/pro-text-to-image", label: "Flux-2 Pro", family: "Flux-2", aspect: "aspect_ratio", aspects: A_FLUX, fixed: { resolution: "1K" } },
  kie_gpt_image_15:     { id: "gpt-image/1.5-text-to-image", label: "GPT Image 1.5", family: "GPT Image", aspect: "aspect_ratio", aspects: A_GPT, fixed: { quality: "medium" } },
  kie_imagen4:          { id: "google/imagen4", label: "Imagen 4", family: "Imagen", aspect: "aspect_ratio", aspects: A_IMAGEN },
  kie_z_image:          { id: "z-image", label: "Z-Image", family: "Z-Image", aspect: "aspect_ratio", aspects: A_Z },
  kie_grok_image:       { id: "grok-imagine/text-to-image", label: "Grok Image", family: "Grok", aspect: "aspect_ratio", aspects: A_GROK },
  // image-to-image / edit (require reference image — note the field name differs!)
  kie_nano_banana_edit: { id: "google/nano-banana-edit", label: "Nano Banana 编辑", family: "Nano Banana", ref: "image_urls", aspect: "aspect_ratio", aspects: A_NANO, outFmt: true },
  kie_seedream_v4_edit: { id: "bytedance/seedream-v4-edit", label: "Seedream 4.0 编辑", family: "Seedream", ref: "image_urls", aspect: "image_size" },
  kie_flux2_pro_i2i:    { id: "flux-2/pro-image-to-image", label: "Flux-2 Pro 图生图", family: "Flux-2", ref: "input_urls", aspect: "aspect_ratio", aspects: A_FLUX_I2I, fixed: { resolution: "1K" } },
  kie_gpt_image_15_edit:{ id: "gpt-image/1.5-image-to-image", label: "GPT Image 1.5 编辑", family: "GPT Image", ref: "input_urls", aspect: "aspect_ratio", aspects: A_GPT, fixed: { quality: "medium" } },
};

// Seedream 4.0 uses `image_size` with a token vocabulary instead of "16:9" ratios.
// Translate the canvas's aspect-ratio string to the nearest Seedream token
// (docs/kie-api.md §Seedream4.0); default square_hd when unknown.
const SEEDREAM_SIZE: Record<string, string> = {
  "1:1": "square_hd", "16:9": "landscape_16_9", "9:16": "portrait_16_9",
  "4:3": "landscape_4_3", "3:4": "portrait_4_3", "3:2": "landscape_3_2",
  "2:3": "portrait_3_2", "21:9": "landscape_21_9",
};

export function isKieImageModel(model?: string): boolean {
  return !!model && model in KIE_IMAGE_MODELS;
}

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 60; // 3 min max — kie market models can be slower than Poyo

// The resolved kie key is passed in by the router (which owns the kie auth via
// resolveKieKey); this function never touches the whitelist or env directly.
export async function generateImageKie(options: GenerateImageOptions): Promise<GenerateImageResponse> {
  const apiKey = options.kieApiKey;
  if (!apiKey) throw new Error("kie API key 未解析（内部错误）");
  const spec = KIE_IMAGE_MODELS[options.model ?? ""];
  if (!spec) throw new Error(`未知 kie 图像模型：${options.model}`);

  const input: Record<string, unknown> = { prompt: options.prompt };
  if (spec.outFmt) input.output_format = "png"; // Google models only — others 422-safe but cleaner to omit
  const aspect = options.size ?? options.reveAspectRatio;
  // ALWAYS set the aspect field with a model-valid value — kie 422s on an empty
  // OR out-of-enum aspect_ratio (e.g. sending "16:9" to GPT Image which only
  // allows 1:1/2:3/3:2). Clamp the chosen ratio to the model's enum, else default.
  if (spec.aspect === "image_size") {
    // Seedream 4.0 uses the image_size token space; default square_hd.
    input.image_size = (aspect && SEEDREAM_SIZE[aspect]) || "square_hd";
  } else {
    const allowed = spec.aspects ?? ["1:1"];
    input.aspect_ratio = aspect && allowed.includes(aspect) ? aspect : allowed[0];
  }
  // Required per-model params (quality / resolution) — kie rejects without them.
  if (spec.fixed) for (const [k, v] of Object.entries(spec.fixed)) input[k] = v;
  if (spec.ref) {
    const refs = (options.originalImages ?? []).map((o) => o.url).filter((u): u is string => !!u);
    if (refs.length === 0) throw new Error(`${spec.label} 需要参考图，请先连接或上传参考图`);
    input[spec.ref] = refs; // image_urls (Seedream/Nano) vs input_urls (Flux-2/GPT)
  }

  // createTask
  const submitRes = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: spec.id, input }),
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

  // poll recordInfo until success/failed
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await fetch(`${KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!statusRes.ok) {
      if (statusRes.status === 429 || statusRes.status >= 500) continue; // transient
      throw new Error(`kie 状态查询失败 (${statusRes.status})`);
    }
    const body = (await statusRes.json()) as {
      code?: number;
      data?: { successFlag?: number; errorMessage?: string; response?: { result_urls?: string[]; resultUrls?: string[] | string } };
    };
    const d = body.data;
    if (!d) continue;
    if (d.successFlag === 1) {
      // result_urls (array) for market models; some endpoints use resultUrls (may be a JSON string).
      let urls = d.response?.result_urls ?? [];
      if (!urls.length && d.response?.resultUrls) {
        const ru = d.response.resultUrls;
        urls = Array.isArray(ru) ? ru : (() => { try { return JSON.parse(ru) as string[]; } catch { return []; } })();
      }
      if (!urls.length) throw new Error("[CHARGED] kie 图像生成完成但未返回 URL（积分可能已扣，请勿重试）");
      return persistKieImages(urls);
    }
    if (d.successFlag === 2 || d.successFlag === 3) {
      throw new Error(`kie 图像生成失败：${d.errorMessage ?? "未知错误"}`);
    }
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
