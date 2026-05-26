import { ENV } from "./env";
import { storagePut, resolveToAbsoluteUrl } from "../storage";
import { isImagePersistenceEnabled } from "./storageConfig";

const HIGGSFIELD_BASE = "https://platform.higgsfield.ai";
const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 60; // 4 min max

// ── Auth helper ───────────────────────────────────────────────────────────────

function getAuthHeader(): string {
  // Higgsfield's official auth format is `Authorization: Key <KEY_ID>:<KEY_SECRET>`
  // (per platform.higgsfield.ai docs + official SDK). Both parts are required.
  if (!ENV.higgsfieldApiKey) throw new Error("HIGGSFIELD_API_KEY 未配置");
  if (!ENV.higgsfieldApiSecret) throw new Error("HIGGSFIELD_API_SECRET 未配置（官方要求 KEY_ID:KEY_SECRET 两段）");
  return `Key ${ENV.higgsfieldApiKey}:${ENV.higgsfieldApiSecret}`;
}

// ── Image Generation ──────────────────────────────────────────────────────────

export type HiggsfieldImageModel =
  | "higgsfield-ai/soul/standard"
  | "reve/text-to-image"
  | "bytedance/seedream/v4/text-to-image"
  | "flux-pro/kontext/max/text-to-image";

export const HIGGSFIELD_IMAGE_MODELS: { value: HiggsfieldImageModel; label: string; desc: string }[] = [
  { value: "higgsfield-ai/soul/standard", label: "Soul Standard (Higgsfield)", desc: "旗舰文生图 · 高质量" },
  { value: "reve/text-to-image",          label: "Reve Text-to-Image",         desc: "通用 · 快速" },
];

export interface HiggsfieldImageOptions {
  model: HiggsfieldImageModel;
  prompt: string;
  negativePrompt?: string;
  // Soul Standard specific
  widthAndHeight?: string;   // e.g. "1024x1024"
  quality?: string;          // "720p" | "1080p"
  batchSize?: number;        // 1 | 4
  enhancePrompt?: boolean;
  seed?: number;
  // Reve / Seedream v4 / Flux Pro shared
  aspectRatio?: string;
  resolution?: string;
  // Flux Pro Kontext extra
  guidanceScale?: number;    // 1-20, default 3.5
  numImages?: number;        // 1-4
  fluxSeed?: number;
  // Shared
  referenceImageUrl?: string;
}

export interface HiggsfieldImageResult {
  url: string;
  urls?: string[]; // multiple URLs when batchSize > 1
}

async function pollHiggsfieldRequest(requestId: string): Promise<{ fileUrl: string; fileUrls?: string[] }> {
  const statusUrl = `${HIGGSFIELD_BASE}/requests/${requestId}/status`;
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(statusUrl, {
      headers: { Authorization: getAuthHeader(), Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      if (res.status === 404 || res.status === 429 || res.status >= 500) continue; // not ready or transient error
      throw new Error(`Higgsfield status check failed (${res.status})`);
    }

    const body = (await res.json()) as {
      status?: string;
      state?: string;
      output?: string | string[];
      outputs?: string[];
      file_url?: string;
      images?: Array<{ url: string }>;
      videos?: Array<{ url: string }>;
      error?: string;
      detail?: unknown;
    };

    const status = body.status ?? body.state ?? "";
    if (status === "failed" || status === "error") {
      // Surface ALL fields the server returned. Reve was reported failing
      // with only "Generation failed" — useless for diagnosis. Walking the
      // body shows whether there's a nested `detail` / `reason` / `message`
      // / `errors[]` worth promoting, and prints the raw object for the
      // server-side log to help next debug round.
      const fullBody = JSON.stringify(body).slice(0, 400);
      console.warn(`[pollHiggsfieldRequest] generation failed for request ${requestId}: ${fullBody}`);
      // Pick the most specific message we can find; many providers stuff
      // useful text in detail/message/reason rather than `error`.
      const b = body as Record<string, unknown>;
      const detail = typeof b.detail === "string" ? b.detail : undefined;
      const message = typeof b.message === "string" ? b.message : undefined;
      const reason = typeof b.reason === "string" ? b.reason : undefined;
      const errors = Array.isArray(b.errors) ? JSON.stringify(b.errors).slice(0, 200) : undefined;
      const best = body.error ?? detail ?? message ?? reason ?? errors ?? `unknown error (raw: ${fullBody})`;
      throw new Error(`[CHARGED] Higgsfield 生成失败: ${best}`);
    }

    // Completed — extract file URL(s)
    if (status === "completed" || status === "succeeded" || status === "done") {
      // Collect all output URLs (batch support)
      // New API format: images/videos array
      const allUrls: string[] = [];
      if (Array.isArray(body.images)) allUrls.push(...body.images.map((img) => img.url).filter(Boolean));
      if (Array.isArray(body.videos)) allUrls.push(...body.videos.map((v) => v.url).filter(Boolean));
      // Legacy format fallbacks
      if (body.file_url) allUrls.push(body.file_url);
      if (Array.isArray(body.outputs)) allUrls.push(...body.outputs);
      if (Array.isArray(body.output)) allUrls.push(...body.output);
      else if (typeof body.output === "string") allUrls.push(body.output);
      const unique = allUrls.filter((u, i, arr) => u && arr.indexOf(u) === i);
      if (unique.length > 0) return { fileUrl: unique[0], fileUrls: unique };
    }
  }
  throw new Error("Higgsfield generation timed out");
}

export async function generateHiggsfieldImage(
  opts: HiggsfieldImageOptions
): Promise<HiggsfieldImageResult> {
  // Higgsfield's API rejects relative URLs like `/manus-storage/{key}` with
  // 422 "Input should be a valid URL, relative URL without a base". Resolve
  // our internal proxy paths to a short-lived absolute S3 presigned URL
  // BEFORE we hand the reference off to upstream.
  const refImageAbsoluteUrl = opts.referenceImageUrl
    ? await resolveToAbsoluteUrl(opts.referenceImageUrl)
    : undefined;

  // Soul image uses a versioned endpoint path /v1/text2image/soul — different
  // convention from the slug-style flux-pro/reve/seedream endpoints.
  // (Per official higgsfield-js SDK src/v2/types.ts & README endpoint examples.)
  const endpoint =
    opts.model === "higgsfield-ai/soul/standard"
      ? `${HIGGSFIELD_BASE}/v1/text2image/soul`
      : `${HIGGSFIELD_BASE}/${opts.model}`;

  // Higgsfield runs two distinct request-body schemas on platform.higgsfield.ai:
  //
  // - v1 endpoints (path prefix `/v1/…` e.g. `/v1/text2image/soul`):
  //   POST body = `{ params: { <ALL_FIELDS_HERE incl. prompt> } }`
  //   (per official SDK src/client.ts line ~79: `requestBody = { params }`)
  //
  // - v2 endpoints (slug paths e.g. `flux-pro/kontext/max/text-to-image`):
  //   POST body = `{ <ALL_FIELDS_FLAT> }` — input fields spread at top level
  //   (per official SDK src/v2/client.ts line ~270: `requestBody = { ...input }`)
  //
  // User-reported 422 confirmed v1 schema:
  //   {"type":"missing","loc":["body","params"],"msg":"Field required"}
  //
  // Field names for each model are taken from the v1/v2 SDK type definitions:
  //   - Soul Standard:  src/v2/types.ts SoulText2ImageInput
  //   - DoP video:      src/v2/types.ts DoPImage2VideoInput
  //   - v2 models:      schema files / README examples
  const isV1Endpoint = opts.model === "higgsfield-ai/soul/standard";
  const fields: Record<string, unknown> = { prompt: opts.prompt };

  if (opts.model === "higgsfield-ai/soul/standard") {
    // Soul Standard /v1/text2image/soul — required fields per SDK type:
    //   prompt, width_and_height, quality, batch_size
    // Optional: image_reference (object), enhance_prompt, seed, style_id, ...
    //
    // CRITICAL: width_and_height is NOT free-form — server validates against
    // a 13-value enum. User-reported 422 listed the allowed set; the SDK's
    // SoulSize helper enumerates the same:
    //   2048x1152, 2048x1536, 2016x1344, 1696x960, 1632x1088,    (landscape)
    //   1152x2048, 1536x2048, 1344x2016, 960x1696, 1088x1632,   (portrait)
    //   1536x1536, 1536x1152, 1152x1536                          (square/mixed)
    // The previous default "1024x1024" was outside this set → 422.
    fields.width_and_height = opts.widthAndHeight ?? "1536x1536";  // default 1:1 1080p
    fields.quality = opts.quality ?? "1080p";  // required: '720p' | '1080p'
    fields.batch_size = opts.batchSize ?? 1;   // required: 1 | 4
    if (opts.enhancePrompt !== undefined) fields.enhance_prompt = opts.enhancePrompt;
    if (opts.seed !== undefined) fields.seed = opts.seed;
    if (refImageAbsoluteUrl) {
      // Soul image-to-image uses `image_reference` (NOT `input_images` — that
      // form is DoP-video specific). Per SoulText2ImageInput type definition.
      fields.image_reference = { type: "image_url", image_url: refImageAbsoluteUrl };
    }
  } else if (
    opts.model === "reve/text-to-image" ||
    opts.model === "bytedance/seedream/v4/text-to-image" ||
    opts.model === "flux-pro/kontext/max/text-to-image"
  ) {
    // v2 endpoints — flat schema. Verified field set from third-party
    // reference implementation (jeremieLouvaert/ComfyUI-Higgsfield-Direct
    // higgsfield_nodes.py:232):
    //   { prompt, aspect_ratio, resolution, image_url? }
    // Only these four fields are reliably accepted across reve / seedream /
    // flux-pro. The previous code sent `negative_prompt`, `input_images`,
    // `guidance_scale`, `num_images` etc. which the dynamic v2 schema
    // doesn't define — at best ignored, at worst silently fails the job
    // (Reve's "Generation failed" symptom).
    //   aspect_ratio: one of "1:1" / "2:3" / "3:2" / "3:4" / "4:3" /
    //                        "4:5" / "5:4" / "9:16" / "16:9" / "21:9"
    //   resolution:   "1K" / "2K" / "4K"
    if (opts.aspectRatio) fields.aspect_ratio = opts.aspectRatio;
    if (opts.resolution) fields.resolution = opts.resolution;
    if (refImageAbsoluteUrl) {
      // Verified: v2 image models accept ref as a plain `image_url` string
      // (not the `{type, image_url}` object form Soul uses).
      fields.image_url = refImageAbsoluteUrl;
    }
  }

  // v1 endpoints wrap the entire field set inside `{ params: ... }`.
  // v2 endpoints send fields directly at top level.
  const body: Record<string, unknown> = isV1Endpoint ? { params: fields } : fields;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Diagnostic: when the API rejects our schema (validation 400/422), log
    // the EXACT request shape we sent so the next mismatch can be fixed
    // without guessing. Logs only field NAMES at the top level + inside
    // `params`, never values (prompts can be sensitive; image URLs may carry
    // signed tokens). The upstream response body is already in the thrown
    // message and surfaces in the UI.
    if (res.status === 400 || res.status === 422) {
      const topLevelKeys = Object.keys(body).sort().join(",");
      const paramsKeys = body.params && typeof body.params === "object"
        ? Object.keys(body.params as Record<string, unknown>).sort().join(",")
        : "(no params)";
      console.warn(
        `[generateHiggsfieldImage] ${res.status} schema mismatch for model=${opts.model} endpoint=${endpoint}\n` +
        `  request body top-level keys: [${topLevelKeys}]\n` +
        `  request body.params keys:    [${paramsKeys}]`,
      );
    }
    throw new Error(`Higgsfield image submit failed (${res.status}, model=${opts.model}): ${text}`);
  }

  const data = (await res.json()) as { request_id?: string; id?: string };
  const requestId = data.request_id ?? data.id;
  if (!requestId) throw new Error("Higgsfield image: no request_id returned");

  const { fileUrl, fileUrls } = await pollHiggsfieldRequest(requestId);
  const allFileUrls = fileUrls ?? [fileUrl];

  // Re-host to Manus S3 so the URL doesn't die after Higgsfield's temp CDN
  // expires. Admin can disable via the StoragePanel persistImage toggle.
  const persistEnabled = await isImagePersistenceEnabled();
  if (!persistEnabled) {
    return { url: allFileUrls[0], urls: allFileUrls.length > 1 ? allFileUrls : undefined };
  }
  const storedUrls: string[] = [];
  for (const fUrl of allFileUrls) {
    try {
      const imgRes = await fetch(fUrl);
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const mimeType = imgRes.headers.get("content-type") ?? "image/png";
        const { url } = await storagePut(`generated/hf-${Date.now()}-${storedUrls.length}.png`, buf, mimeType);
        storedUrls.push(url);
        continue;
      }
    } catch { /* fall through */ }
    storedUrls.push(fUrl); // fallback to original URL on per-image failure
  }

  return { url: storedUrls[0], urls: storedUrls.length > 1 ? storedUrls : undefined };
}

// ── Video Generation ──────────────────────────────────────────────────────────
//
// Official platform.higgsfield.ai API exposes a SINGLE video endpoint:
//   POST /v1/image2video/dop  with body { model: "dop-preview" | "dop-turbo" | "dop-lite", ... }
//   (renamed from "dop-standard"; confirmed by 422 enum-error response)
//
// Kling / Seedance / Veo / Sora models are NOT available on the public API —
// they only exist on Higgsfield's private cloud.higgsfield.ai web backend which
// requires a Clerk JWT and is explicitly not third-party callable.
//
// Previous code mistakenly treated the model slug as a URL path and listed 5
// non-existent variants. Removed.

export type HiggsfieldDopModel = "dop-preview" | "dop-turbo" | "dop-lite";

export const HIGGSFIELD_VIDEO_MODELS: { value: string; label: string; desc: string }[] = [
  { value: "hf_dop_standard", label: "DoP Standard", desc: "高质量 · 电影级（Higgsfield 公共 API）" },
  { value: "hf_dop_turbo",    label: "DoP Turbo",    desc: "极速版（Higgsfield 公共 API）" },
  { value: "hf_dop_lite",     label: "DoP Lite",     desc: "轻量版 · 高速（Higgsfield 公共 API）" },
];

export function isHiggsfieldVideoProvider(provider: string): boolean {
  return provider.startsWith("hf_");
}

// Map internal provider key → official body.model value
// User-reported 422 confirms the real DoP model enum is { dop-preview,
// dop-turbo, dop-lite } — no "dop-standard" despite the SDK helpers.ts
// `DoPModel.STANDARD = 'dop-standard'` constant (SDK is outdated). The
// frontend provider key `hf_dop_standard` is kept stable (it's in the
// VIDEO_PROVIDERS enum / user DB rows / labels), but maps to the actual
// upstream value `dop-preview`. Effectively `hf_dop_standard` is just a
// historical alias for what Higgsfield now calls "preview".
export const HIGGSFIELD_PROVIDER_MAP: Record<string, HiggsfieldDopModel> = {
  hf_dop_standard: "dop-preview",
  hf_dop_turbo:    "dop-turbo",
  hf_dop_lite:     "dop-lite",
};

export interface SubmitHiggsfieldVideoOptions {
  provider: string; // one of the hf_* keys
  prompt: string;
  negativePrompt?: string;  // unused for DoP — kept for API compat
  referenceImageUrl?: string;
  params?: Record<string, unknown>;
}

export interface HiggsfieldVideoSubmitResult {
  externalTaskId: string;
}

export async function submitHiggsfieldVideo(
  opts: SubmitHiggsfieldVideoOptions
): Promise<HiggsfieldVideoSubmitResult> {
  const dopModel = HIGGSFIELD_PROVIDER_MAP[opts.provider];
  if (!dopModel) {
    throw new Error(
      `Higgsfield 公共 API 不支持 provider "${opts.provider}"。仅支持 hf_dop_standard / hf_dop_turbo / hf_dop_lite。`
    );
  }
  // DoP is image-to-video — reference image is REQUIRED.
  if (!opts.referenceImageUrl) {
    throw new Error("Higgsfield DoP 视频模型必须提供参考图（reference image）");
  }
  // Resolve our internal proxy path to an absolute presigned S3 URL — the
  // upstream API rejects relative paths with 422 "Input should be a valid
  // URL, relative URL without a base". User reproduced via storyboard →
  // video task hand-off where the storyboard's `imageUrl` (form
  // `/manus-storage/generated/hf-…png`) flowed directly into DoP's
  // `input_images[0].image_url`.
  const refImageAbsoluteUrl = await resolveToAbsoluteUrl(opts.referenceImageUrl);

  const endpoint = `${HIGGSFIELD_BASE}/v1/image2video/dop`;
  const p = opts.params ?? {};

  // Per official higgsfield-js v1 SDK README + src/client.ts line 79:
  //   client.generate('/v1/image2video/dop', { model, prompt, input_images, ... })
  // wraps the entire payload as `{ params: <THAT_OBJECT> }`. So all fields —
  // including model / prompt / input_images — sit inside `params`. The
  // previous "half-nested" shape (model/prompt at top level, rest inside
  // params) was silently accepted by the server but with extra fields
  // ignored, which is why DoP videos still generated but with default
  // duration/resolution/camera_motion regardless of the user's choice.
  const innerParams: Record<string, unknown> = {
    model: dopModel,
    prompt: opts.prompt,
    input_images: [{ type: "image_url", image_url: refImageAbsoluteUrl }],
    enhance_prompt: p.enhance_prompt ?? false,
  };
  // Duration: dop-turbo and dop-lite only support 4s; dop-preview supports 4 or 8s
  // (previously documented as "dop-standard" before the API rename)
  if (p.duration !== undefined) {
    const rawDur = Math.trunc(Number(p.duration));
    innerParams.duration = (dopModel === "dop-lite" || dopModel === "dop-turbo")
      ? 4
      : rawDur;
  }
  // Resolution: "480p" | "720p" | "1080p"
  if (p.resolution !== undefined) innerParams.resolution = String(p.resolution);
  // Seed (optional — omit unless a valid finite integer)
  if (p.seed !== undefined && p.seed !== null && String(p.seed) !== "") {
    const seedNum = Number(p.seed);
    if (Number.isFinite(seedNum)) innerParams.seed = Math.trunc(seedNum);
  }
  // Camera motion: build object from two flat UI params.
  // "static" means fixed camera — only send type, not speed (speed is irrelevant for static).
  if (p.camera_motion_type && String(p.camera_motion_type) !== "none") {
    const motionType = String(p.camera_motion_type);
    innerParams.camera_motion = motionType === "static"
      ? { type: motionType }
      : { type: motionType, speed: String(p.camera_motion_speed ?? "normal") };
  }

  const body: Record<string, unknown> = { params: innerParams };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 404) {
      throw new Error(`Higgsfield 视频提交失败 (404): /v1/image2video/dop 不存在。可能 API 路径已变。原始响应: ${text}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Higgsfield 鉴权失败 (${res.status}): 检查 HIGGSFIELD_API_KEY / HIGGSFIELD_API_SECRET 是否正确。响应: ${text}`);
    }
    throw new Error(`Higgsfield 视频提交失败 (${res.status}, 模型 ${dopModel}): ${text}`);
  }

  const data = (await res.json()) as { request_id?: string };
  if (!data.request_id) throw new Error("Higgsfield 视频提交：响应未返回 request_id");

  return { externalTaskId: data.request_id };
}

export interface HiggsfieldVideoStatus {
  status: "pending" | "processing" | "succeeded" | "failed";
  resultVideoUrl?: string;
  errorMessage?: string;
}

export async function checkHiggsfieldVideoStatus(
  requestId: string
): Promise<HiggsfieldVideoStatus> {
  const res = await fetch(`${HIGGSFIELD_BASE}/requests/${requestId}/status`, {
    headers: { Authorization: getAuthHeader(), Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    if (res.status === 404) return { status: "processing" };
    throw new Error(`Higgsfield status check failed (${res.status})`);
  }

  // Official V2Response shape (per higgsfield-js SDK src/v2/types.ts):
  //   { status: "queued"|"in_progress"|"completed"|"failed"|"nsfw",
  //     video?: { url: string },                  // singular object for video
  //     images?: Array<{ url: string }>,          // array for image jobs
  //     detail?: string }                         // error message on 4xx/5xx
  const body = (await res.json()) as {
    status?: "queued" | "in_progress" | "completed" | "failed" | "nsfw";
    video?: { url?: string };
    images?: Array<{ url?: string }>;
    detail?: string;
  };

  const status = body.status;

  if (status === "failed") {
    return { status: "failed", errorMessage: body.detail ?? "Higgsfield 任务失败" };
  }
  if (status === "nsfw") {
    return { status: "failed", errorMessage: "Higgsfield 内容审核拒绝（NSFW）" };
  }
  if (status === "completed") {
    const fileUrl = body.video?.url ?? body.images?.[0]?.url;
    if (fileUrl) return { status: "succeeded", resultVideoUrl: fileUrl };
    // Upstream confirms completion (credits spent) but response body lacks
    // the expected url field. Surface with [CHARGED] so the caller doesn't
    // present this as a retry-friendly failure.
    return { status: "failed", errorMessage: "[CHARGED] Higgsfield 完成但响应未含 video.url（积分已扣，请勿重试）" };
  }
  // queued / in_progress / unknown — keep polling
  return { status: "processing" };
}
