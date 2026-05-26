import { ENV } from "./env";

const POYO_BASE = "https://api.poyo.ai";

export type PoyoVideoModel = "seedance-2" | "veo-3.1" | "kling-2.6" | "kling-o3-standard" | "kling-o3-pro" | "kling-o3-4k" | "wan2.6-text-to-video" | "wan2.6-image-to-video" | "runway-gen-4.5";

export const POYO_PROVIDER_MAP: Record<string, PoyoVideoModel> = {
  poyo_seedance:     "seedance-2",
  poyo_veo:          "veo-3.1",
  poyo_kling26:      "kling-2.6",
  poyo_kling_o3_std: "kling-o3-standard",
  poyo_kling_o3_pro: "kling-o3-pro",
  poyo_kling_o3_4k:  "kling-o3-4k",
  poyo_wan25_t2v:    "wan2.6-text-to-video",
  poyo_wan25_i2v:    "wan2.6-image-to-video",
  poyo_runway45:     "runway-gen-4.5",
};

export function isPoyoVideoProvider(provider: string): boolean {
  return provider in POYO_PROVIDER_MAP;
}

export interface SubmitPoyoVideoResult {
  externalTaskId: string;
}

export async function submitPoyoVideo(opts: {
  provider: string;
  prompt: string;
  negativePrompt?: string;
  referenceImageUrl?: string;
  params?: Record<string, unknown>;
}): Promise<SubmitPoyoVideoResult> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");

  const model = POYO_PROVIDER_MAP[opts.provider];
  if (!model) throw new Error(`Unknown poyo provider: ${opts.provider}`);

  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
    ...(opts.referenceImageUrl ? { reference_image_url: opts.referenceImageUrl } : {}),
  };

  if (model === "seedance-2") {
    // resolution and aspect_ratio are both required by the Seedance 2 API
    input.resolution = (opts.params?.resolution as string) ?? "720p";
    input.aspect_ratio = (opts.params?.aspect_ratio as string) ?? "16:9";
    input.duration = (opts.params?.duration as number) ?? 5;
    if (opts.params?.camera_fixed !== undefined) {
      input.camera_fixed = Boolean(opts.params.camera_fixed);
    }
    if (opts.params?.generate_audio !== undefined) {
      input.generate_audio = Boolean(opts.params.generate_audio);
    }
  } else if (model === "kling-2.6") {
    input.aspect_ratio = (opts.params?.aspect_ratio as string) ?? "16:9";
    input.duration = (opts.params?.duration as number) ?? 5;
    // sound is required per Kling 2.6 API docs; always send it
    input.sound = Boolean(opts.params?.sound ?? false);
  } else if (model === "kling-o3-standard" || model === "kling-o3-pro" || model === "kling-o3-4k") {
    input.aspect_ratio = (opts.params?.aspect_ratio as string) ?? "16:9";
    input.duration = (opts.params?.duration as number) ?? 5;
  } else if (model === "veo-3.1") {
    // Only 16:9 and 9:16 are valid; duration is always 8 seconds
    input.aspect_ratio = (opts.params?.aspect_ratio as string) ?? "16:9";
    input.duration = 8;
    if (opts.params?.resolution) input.resolution = String(opts.params.resolution);
    if (opts.params?.generation_type) input.generation_type = String(opts.params.generation_type);
  } else if (model === "wan2.6-text-to-video" || model === "wan2.6-image-to-video") {
    // aspect_ratio is not documented in Wan 2.6 API; omit to avoid unexpected errors
    input.duration = (opts.params?.duration as number) ?? 5;
    if (opts.params?.resolution) input.resolution = String(opts.params.resolution);
    if (opts.params?.multi_shots !== undefined) input.multi_shots = Boolean(opts.params.multi_shots);
  } else if (model === "runway-gen-4.5") {
    input.aspect_ratio = (opts.params?.aspect_ratio as string) ?? "16:9";
    input.duration = (opts.params?.duration as number) ?? 5;
  }

  // Seed — optional for most Poyo video models; omit rather than send null/undefined
  if (opts.params?.seed !== undefined && opts.params.seed !== null && String(opts.params.seed) !== "") {
    input.seed = Number(opts.params.seed);
  }

  const res = await fetch(`${POYO_BASE}/api/generate/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.poyoApiKey}`,
    },
    body: JSON.stringify({ model, input }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Poyo video submit failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { code: number; message?: string; data: { task_id: string } };
  if (data.code !== undefined && data.code !== 0) {
    throw new Error(`Poyo video submit error (code ${data.code}): ${data.message ?? JSON.stringify(data)}`);
  }
  const externalTaskId = data.data?.task_id;
  if (!externalTaskId) throw new Error("Poyo video submit: no task_id returned");

  return { externalTaskId };
}

export interface PoyoTaskStatus {
  status: "not_started" | "running" | "finished" | "failed";
  progress?: number;
  resultVideoUrl?: string;
  errorMessage?: string;
}

export async function checkPoyoVideoStatus(externalTaskId: string): Promise<PoyoTaskStatus> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");

  const res = await fetch(`${POYO_BASE}/api/generate/status/${externalTaskId}`, {
    headers: { Authorization: `Bearer ${ENV.poyoApiKey}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Poyo status check failed (${res.status})`);
  }

  const body = (await res.json()) as {
    code: number;
    message?: string;
    data: {
      status: string;
      progress?: number;
      files?: Array<{ file_url: string; file_type: string }>;
      error_message?: string;
    };
  };

  if (body.code !== undefined && body.code !== 0) {
    throw new Error(`Poyo status check error (code ${body.code}): ${body.message ?? JSON.stringify(body)}`);
  }

  const d = body.data;
  const status = d.status as PoyoTaskStatus["status"];
  const resultVideoUrl = d.files?.find((f) => f.file_type === "video")?.file_url
    ?? d.files?.[0]?.file_url;

  return {
    status,
    progress: d.progress,
    resultVideoUrl,
    errorMessage: d.error_message,
  };
}
