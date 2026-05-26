import { ENV } from "./env";
import { storagePut } from "../storage";

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
      throw new Error(`Higgsfield generation failed: ${body.error ?? "unknown error"}`);
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
  // Soul image uses a versioned endpoint path /v1/text2image/soul — different
  // convention from the slug-style flux-pro/reve/seedream endpoints.
  // (Per official higgsfield-js SDK src/v2/types.ts & README endpoint examples.)
  const endpoint =
    opts.model === "higgsfield-ai/soul/standard"
      ? `${HIGGSFIELD_BASE}/v1/text2image/soul`
      : `${HIGGSFIELD_BASE}/${opts.model}`;

  const body: Record<string, unknown> = {
    prompt: opts.prompt,
  };

  if (opts.model === "higgsfield-ai/soul/standard") {
    // Soul Standard specific params (from official SDK types.d.ts)
    if (opts.widthAndHeight) body.width_and_height = opts.widthAndHeight;
    else body.width_and_height = "1024x1024"; // default
    if (opts.quality) body.quality = opts.quality;
    if (opts.batchSize !== undefined) body.batch_size = opts.batchSize;
    if (opts.enhancePrompt !== undefined) body.enhance_prompt = opts.enhancePrompt;
    if (opts.seed !== undefined) body.seed = opts.seed;
    if (opts.negativePrompt) body.negative_prompt = opts.negativePrompt;
    if (opts.referenceImageUrl) body.image_url = opts.referenceImageUrl;
  } else if (opts.model === "reve/text-to-image") {
    // Reve specific params
    if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
    if (opts.resolution) body.resolution = opts.resolution;
    if (opts.negativePrompt) body.negative_prompt = opts.negativePrompt;
    if (opts.referenceImageUrl) body.image_url = opts.referenceImageUrl;
  } else if (opts.model === "bytedance/seedream/v4/text-to-image") {
    if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
    if (opts.negativePrompt) body.negative_prompt = opts.negativePrompt;
    if (opts.referenceImageUrl) body.image_url = opts.referenceImageUrl;
  } else if (opts.model === "flux-pro/kontext/max/text-to-image") {
    if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
    if (opts.negativePrompt) body.negative_prompt = opts.negativePrompt;
    if (opts.referenceImageUrl) body.image_url = opts.referenceImageUrl;
    if (opts.guidanceScale !== undefined) body.guidance_scale = opts.guidanceScale;
    if (opts.numImages !== undefined) body.num_images = opts.numImages;
    if (opts.fluxSeed !== undefined) body.seed = opts.fluxSeed;
  }

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
    throw new Error(`Higgsfield image submit failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { request_id?: string; id?: string };
  const requestId = data.request_id ?? data.id;
  if (!requestId) throw new Error("Higgsfield image: no request_id returned");

  const { fileUrl, fileUrls } = await pollHiggsfieldRequest(requestId);
  const allFileUrls = fileUrls ?? [fileUrl];

  // Download and re-upload all images to own storage for persistence
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
    storedUrls.push(fUrl); // fallback to original URL
  }

  return { url: storedUrls[0], urls: storedUrls.length > 1 ? storedUrls : undefined };
}

// ── Video Generation ──────────────────────────────────────────────────────────
//
// Official platform.higgsfield.ai API exposes a SINGLE video endpoint:
//   POST /v1/image2video/dop  with body { model: "dop-standard" | "dop-turbo" | "dop-lite", ... }
//
// Kling / Seedance / Veo / Sora models are NOT available on the public API —
// they only exist on Higgsfield's private cloud.higgsfield.ai web backend which
// requires a Clerk JWT and is explicitly not third-party callable.
//
// Previous code mistakenly treated the model slug as a URL path and listed 5
// non-existent variants. Removed.

export type HiggsfieldDopModel = "dop-standard" | "dop-turbo" | "dop-lite";

export const HIGGSFIELD_VIDEO_MODELS: { value: string; label: string; desc: string }[] = [
  { value: "hf_dop_standard", label: "DoP Standard", desc: "高质量 · 电影级（Higgsfield 公共 API）" },
  { value: "hf_dop_turbo",    label: "DoP Turbo",    desc: "极速版（Higgsfield 公共 API）" },
  { value: "hf_dop_lite",     label: "DoP Lite",     desc: "轻量版 · 高速（Higgsfield 公共 API）" },
];

export function isHiggsfieldVideoProvider(provider: string): boolean {
  return provider.startsWith("hf_");
}

// Map internal provider key → official body.model value
export const HIGGSFIELD_PROVIDER_MAP: Record<string, HiggsfieldDopModel> = {
  hf_dop_standard: "dop-standard",
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

  const endpoint = `${HIGGSFIELD_BASE}/v1/image2video/dop`;
  const p = opts.params ?? {};

  // Build nested `params` object (required by Higgsfield DoP API — Pydantic enforces its presence)
  const innerParams: Record<string, unknown> = {
    enhance_prompt: p.enhance_prompt ?? false,
  };
  // Duration: dop-turbo and dop-lite only support 4s; dop-standard supports 4 or 8s
  if (p.duration !== undefined) {
    const rawDur = Number(p.duration);
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

  const body: Record<string, unknown> = {
    model: dopModel,
    prompt: opts.prompt,
    input_images: [{ type: "image_url", image_url: opts.referenceImageUrl }],
    params: innerParams,
  };

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
    return { status: "failed", errorMessage: "Higgsfield 完成但响应未含 video.url" };
  }
  // queued / in_progress / unknown — keep polling
  return { status: "processing" };
}
