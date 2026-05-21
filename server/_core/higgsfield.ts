import { ENV } from "./env";

const HIGGSFIELD_BASE = "https://platform.higgsfield.ai";
const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 60; // 4 min max

// ── Auth helper ───────────────────────────────────────────────────────────────

function getAuthHeader(): string {
  if (!ENV.higgsfieldApiKey) throw new Error("HIGGSFIELD_API_KEY is not configured");
  return `Key ${ENV.higgsfieldApiKey}`;
}

// ── Image Generation ──────────────────────────────────────────────────────────

export type HiggsfieldImageModel =
  | "higgsfield-ai/soul/standard"
  | "reve/text-to-image";

export const HIGGSFIELD_IMAGE_MODELS: { value: HiggsfieldImageModel; label: string; desc: string }[] = [
  { value: "higgsfield-ai/soul/standard", label: "Soul Standard (Higgsfield)", desc: "旗舰文生图 · 高质量" },
  { value: "reve/text-to-image",          label: "Reve Text-to-Image",         desc: "通用 · 快速" },
];

export interface HiggsfieldImageOptions {
  model: HiggsfieldImageModel;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  referenceImageUrl?: string;
}

export interface HiggsfieldImageResult {
  url: string;
}

async function pollHiggsfieldRequest(requestId: string): Promise<{ fileUrl: string }> {
  const statusUrl = `${HIGGSFIELD_BASE}/request/${requestId}`;
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(statusUrl, {
      headers: { Authorization: getAuthHeader(), Accept: "application/json" },
    });

    if (!res.ok) {
      if (res.status === 404) continue; // not ready yet
      throw new Error(`Higgsfield status check failed (${res.status})`);
    }

    const body = (await res.json()) as {
      status?: string;
      state?: string;
      output?: string | string[];
      outputs?: string[];
      file_url?: string;
      error?: string;
    };

    const status = body.status ?? body.state ?? "";
    if (status === "failed" || status === "error") {
      throw new Error(`Higgsfield generation failed: ${body.error ?? "unknown error"}`);
    }

    // Completed — extract file URL
    if (status === "completed" || status === "succeeded" || status === "done") {
      const fileUrl =
        body.file_url ??
        (Array.isArray(body.outputs) ? body.outputs[0] : undefined) ??
        (Array.isArray(body.output) ? body.output[0] : typeof body.output === "string" ? body.output : undefined);
      if (fileUrl) return { fileUrl };
    }
  }
  throw new Error("Higgsfield generation timed out");
}

export async function generateHiggsfieldImage(
  opts: HiggsfieldImageOptions
): Promise<HiggsfieldImageResult> {
  // Map model path to endpoint
  const endpoint = `${HIGGSFIELD_BASE}/${opts.model}`;

  const body: Record<string, unknown> = {
    prompt: opts.prompt,
    aspect_ratio: opts.aspectRatio ?? "16:9",
    resolution: opts.resolution ?? "720p",
  };
  if (opts.negativePrompt) body.negative_prompt = opts.negativePrompt;
  if (opts.referenceImageUrl) body.image_url = opts.referenceImageUrl;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Higgsfield image submit failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { request_id?: string; id?: string };
  const requestId = data.request_id ?? data.id;
  if (!requestId) throw new Error("Higgsfield image: no request_id returned");

  const { fileUrl } = await pollHiggsfieldRequest(requestId);
  return { url: fileUrl };
}

// ── Video Generation ──────────────────────────────────────────────────────────

export type HiggsfieldVideoModel =
  | "higgsfield-ai/dop/standard"
  | "higgsfield-ai/dop/preview"
  | "kling-video/v2.1/pro/image-to-video"
  | "bytedance/seedance/v1/pro/image-to-video";

export const HIGGSFIELD_VIDEO_MODELS: { value: HiggsfieldVideoModel; label: string; desc: string }[] = [
  { value: "higgsfield-ai/dop/standard",              label: "DoP Standard (Higgsfield)",  desc: "高质量 · 电影级" },
  { value: "higgsfield-ai/dop/preview",               label: "DoP Preview (Higgsfield)",   desc: "预览版 · 快速" },
  { value: "kling-video/v2.1/pro/image-to-video",     label: "Kling 2.1 Pro",              desc: "高级动态动画" },
  { value: "bytedance/seedance/v1/pro/image-to-video", label: "Seedance 1.0 Pro",           desc: "专业级视频生成" },
];

export function isHiggsfieldVideoProvider(provider: string): boolean {
  return provider.startsWith("hf_");
}

// Map internal provider key → Higgsfield model path
export const HIGGSFIELD_PROVIDER_MAP: Record<string, HiggsfieldVideoModel> = {
  hf_dop_standard:  "higgsfield-ai/dop/standard",
  hf_dop_preview:   "higgsfield-ai/dop/preview",
  hf_kling_21_pro:  "kling-video/v2.1/pro/image-to-video",
  hf_seedance_pro:  "bytedance/seedance/v1/pro/image-to-video",
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

  const body: Record<string, unknown> = {
    prompt: opts.prompt,
    duration: (opts.params?.duration as number) ?? 5,
  };
  if (opts.negativePrompt) body.negative_prompt = opts.negativePrompt;
  if (opts.referenceImageUrl) body.image_url = opts.referenceImageUrl;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Higgsfield video submit failed (${res.status}): ${text}`);
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
  const res = await fetch(`${HIGGSFIELD_BASE}/request/${requestId}`, {
    headers: { Authorization: getAuthHeader(), Accept: "application/json" },
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
    error?: string;
  };

  const rawStatus = body.status ?? body.state ?? "processing";

  if (rawStatus === "failed" || rawStatus === "error") {
    return { status: "failed", errorMessage: body.error ?? "生成失败" };
  }

  if (rawStatus === "completed" || rawStatus === "succeeded" || rawStatus === "done") {
    const fileUrl =
      body.file_url ??
      (Array.isArray(body.outputs) ? body.outputs[0] : undefined) ??
      (Array.isArray(body.output) ? body.output[0] : typeof body.output === "string" ? body.output : undefined);
    if (fileUrl) return { status: "succeeded", resultVideoUrl: fileUrl };
    return { status: "failed", errorMessage: "生成完成但无视频 URL" };
  }

  return { status: "processing" };
}
