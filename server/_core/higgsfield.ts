import { ENV } from "./env";
import { storagePut } from "../storage";

const HIGGSFIELD_BASE = "https://platform.higgsfield.ai";
const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 60; // 4 min max

// ── Auth helper ───────────────────────────────────────────────────────────────

function getAuthHeader(): string {
  if (!ENV.higgsfieldApiKey) throw new Error("HIGGSFIELD_API_KEY is not configured");
  // If both access key and secret are stored separately, combine them for the API call.
  // Set HIGGSFIELD_API_KEY = your access key and HIGGSFIELD_API_SECRET = your secret key.
  const token = ENV.higgsfieldApiSecret
    ? `${ENV.higgsfieldApiKey}:${ENV.higgsfieldApiSecret}`
    : ENV.higgsfieldApiKey;
  return `Key ${token}`;
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
  const endpoint = `${HIGGSFIELD_BASE}/${opts.model}`;

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

export type HiggsfieldVideoModel =
  | "higgsfield-ai/dop/standard"
  | "higgsfield-ai/dop/preview"
  | "higgsfield-ai/dop/lite"
  | "higgsfield-ai/dop/turbo"
  | "kling-video/v2.1/pro/image-to-video"
  | "bytedance/seedance/v1/pro/image-to-video"
  | "bytedance/seedance/v2/pro/image-to-video"
  | "kling-video/v3.0/pro/image-to-video";

export const HIGGSFIELD_VIDEO_MODELS: { value: HiggsfieldVideoModel; label: string; desc: string }[] = [
  { value: "higgsfield-ai/dop/standard",               label: "DoP Standard",       desc: "高质量 · 电影级" },
  { value: "higgsfield-ai/dop/preview",                label: "DoP Preview",        desc: "预览版 · 快速" },
  { value: "higgsfield-ai/dop/lite",                   label: "DoP Lite",           desc: "轻量版 · 高速" },
  { value: "higgsfield-ai/dop/turbo",                  label: "DoP Turbo",          desc: "极速版" },
  { value: "kling-video/v2.1/pro/image-to-video",      label: "Kling 2.1 Pro",      desc: "高级动态动画" },
  { value: "bytedance/seedance/v1/pro/image-to-video", label: "Seedance 1.0 Pro",   desc: "专业级视频生成" },
  { value: "bytedance/seedance/v2/pro/image-to-video", label: "Seedance 2.0 Pro",   desc: "Seedance 最新版" },
  { value: "kling-video/v3.0/pro/image-to-video",      label: "Kling 3.0 Pro",      desc: "Kling 最新旗舰" },
];

export function isHiggsfieldVideoProvider(provider: string): boolean {
  return provider.startsWith("hf_");
}

// Map internal provider key → Higgsfield model path
export const HIGGSFIELD_PROVIDER_MAP: Record<string, HiggsfieldVideoModel> = {
  hf_dop_standard:  "higgsfield-ai/dop/standard",
  hf_dop_preview:   "higgsfield-ai/dop/preview",
  hf_dop_lite:      "higgsfield-ai/dop/lite",
  hf_dop_turbo:     "higgsfield-ai/dop/turbo",
  hf_kling_21_pro:  "kling-video/v2.1/pro/image-to-video",
  hf_seedance_pro:  "bytedance/seedance/v1/pro/image-to-video",
  hf_seedance_20:   "bytedance/seedance/v2/pro/image-to-video",
  hf_kling_30:      "kling-video/v3.0/pro/image-to-video",
};

export interface SubmitHiggsfieldVideoOptions {
  provider: string; // one of the hf_* keys
  prompt: string;
  negativePrompt?: string;
  referenceImageUrl?: string;
  params?: Record<string, unknown>;
}

export interface HiggsfieldVideoSubmitResult {
  externalTaskId: string;
}

export async function submitHiggsfieldVideo(
  opts: SubmitHiggsfieldVideoOptions
): Promise<HiggsfieldVideoSubmitResult> {
  const modelPath = HIGGSFIELD_PROVIDER_MAP[opts.provider];
  if (!modelPath) throw new Error(`Unknown Higgsfield provider: ${opts.provider}`);

  const endpoint = `${HIGGSFIELD_BASE}/${modelPath}`;
  const p = opts.params ?? {};

  const body: Record<string, unknown> = {
    prompt: opts.prompt,
  };

  if (opts.referenceImageUrl) body.image_url = opts.referenceImageUrl;

  // ── DoP models: seed, enhance_prompt ──────────────────────────────────────
  if (
    opts.provider === "hf_dop_standard" ||
    opts.provider === "hf_dop_preview" ||
    opts.provider === "hf_dop_lite" ||
    opts.provider === "hf_dop_turbo"
  ) {
    if (p.seed !== undefined) body.seed = p.seed;
    if (p.enhance_prompt !== undefined) body.enhance_prompt = p.enhance_prompt;
  }

  if (opts.provider === "hf_kling_21_pro") {
    body.duration = p.duration ?? 5;
    body.aspect_ratio = p.aspect_ratio ?? "16:9";
    if (p.cfg_scale !== undefined) body.cfg_scale = p.cfg_scale;
    if (opts.negativePrompt) body.negative_prompt = opts.negativePrompt;
  }

  if (opts.provider === "hf_seedance_pro" || opts.provider === "hf_seedance_20") {
    body.aspect_ratio = p.aspect_ratio ?? "16:9";
    body.resolution = p.resolution ?? "720p";
    body.duration = p.duration ?? 5;
    if (p.camera_fixed !== undefined) body.camera_fixed = p.camera_fixed;
  }

  if (opts.provider === "hf_kling_30") {
    body.duration = p.duration ?? 5;
    body.aspect_ratio = p.aspect_ratio ?? "16:9";
    if (p.cfg_scale !== undefined) body.cfg_scale = p.cfg_scale;
    if (opts.negativePrompt) body.negative_prompt = opts.negativePrompt;
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
    // 404 通常意味着 Higgsfield 平台已下架或重命名了该模型
    if (res.status === 404) {
      throw new Error(`Higgsfield 视频提交失败 (404): 模型 "${modelPath}" 在 Higgsfield 平台不存在或已下架。请换一个模型再试。原始响应: ${text}`);
    }
    throw new Error(`Higgsfield 视频提交失败 (${res.status}, 模型 ${modelPath}): ${text}`);
  }

  const data = (await res.json()) as { request_id?: string; id?: string };
  const requestId = data.request_id ?? data.id;
  if (!requestId) throw new Error("Higgsfield video: no request_id returned");

  return { externalTaskId: requestId };
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

  const body = (await res.json()) as {
    status?: string;
    state?: string;
    output?: string | string[];
    outputs?: string[];
    file_url?: string;
    images?: Array<{ url: string }>;
    videos?: Array<{ url: string }>;
    error?: string;
  };

  const rawStatus = body.status ?? body.state ?? "processing";

  if (rawStatus === "failed" || rawStatus === "error") {
    return { status: "failed", errorMessage: body.error ?? "生成失败" };
  }

  if (rawStatus === "completed" || rawStatus === "succeeded" || rawStatus === "done") {
    // New API format: videos/images array
    const fileUrl =
      (Array.isArray(body.videos) && body.videos[0]?.url ? body.videos[0].url : undefined) ??
      (Array.isArray(body.images) && body.images[0]?.url ? body.images[0].url : undefined) ??
      body.file_url ??
      (Array.isArray(body.outputs) ? body.outputs[0] : undefined) ??
      (Array.isArray(body.output) ? body.output[0] : typeof body.output === "string" ? body.output : undefined);
    if (fileUrl) return { status: "succeeded", resultVideoUrl: fileUrl };
    return { status: "failed", errorMessage: "生成完成但无视频 URL" };
  }

  return { status: "processing" };
}
