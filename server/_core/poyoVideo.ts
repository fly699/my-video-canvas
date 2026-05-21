import { ENV } from "./env";

const POYO_BASE = "https://api.poyo.ai";

export type PoyoVideoModel = "seedance-2" | "veo-3.1" | "kling-2.6" | "kling-o3-standard" | "kling-o3-pro" | "kling-o3-4k";

export const POYO_PROVIDER_MAP: Record<string, PoyoVideoModel> = {
  poyo_seedance: "seedance-2",
  poyo_veo: "veo-3.1",
  poyo_kling26: "kling-2.6",
  poyo_kling_o3_std: "kling-o3-standard",
  poyo_kling_o3_pro: "kling-o3-pro",
  poyo_kling_o3_4k: "kling-o3-4k",
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
    aspect_ratio: (opts.params?.aspect_ratio as string) ?? "16:9",
    ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
    ...(opts.referenceImageUrl ? { reference_image_url: opts.referenceImageUrl } : {}),
  };

  if (model === "kling-2.6") {
    input.duration = (opts.params?.duration as number) ?? 5;
    if (opts.params?.sound !== undefined) input.sound = Boolean(opts.params.sound);
  } else if (model === "kling-o3-standard" || model === "kling-o3-pro" || model === "kling-o3-4k") {
    input.duration = (opts.params?.duration as number) ?? 5;
  } else {
    // Seedance and Veo
    input.resolution = (opts.params?.resolution as string) ?? "720p";
    input.duration = (opts.params?.duration as number) ?? 5;
    if (opts.params?.camera_fixed !== undefined && (model === "seedance-2")) {
      input.camera_fixed = Boolean(opts.params.camera_fixed);
    }
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

  const data = (await res.json()) as { code: number; data: { task_id: string } };
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
    data: {
      status: string;
      progress?: number;
      files?: Array<{ file_url: string; file_type: string }>;
      error_message?: string;
    };
  };

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
