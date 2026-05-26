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

  // Seed — optional; omit unless a valid finite integer (Number("") is 0, not NaN,
  // but non-numeric strings like "abc" produce NaN which serializes to null in JSON)
  if (opts.params?.seed !== undefined && opts.params.seed !== null && String(opts.params.seed) !== "") {
    const seedNum = Number(opts.params.seed);
    if (Number.isFinite(seedNum)) input.seed = Math.trunc(seedNum);
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
  // Poyo's success code is 200 (HTTP-style), NOT 0 — production bug:
  // submitting wan2.6-text-to-video returned `{"code":200,"data":{...,"task_id":"Y64Qi6YN…","status":"not_started"}}`,
  // we treated code!=0 as error, threw "[CHARGED?] 提交失败", but Poyo
  // had ACCEPTED the job (visible as "Processing" with 360 credits charged
  // in the upstream dashboard). Result: user saw a misleading failure
  // banner and could not pull the video.
  //
  // Defensive: accept (0, 200, undefined) as success, and additionally
  // fall through to task_id presence — if Poyo returns a real task_id we
  // got accepted no matter what `code` value they use.
  const externalTaskId = data.data?.task_id;
  if (externalTaskId) return { externalTaskId };
  const isErrorCode = data.code !== undefined && data.code !== 0 && data.code !== 200;
  if (isErrorCode) {
    throw new Error(`Poyo video submit error (code ${data.code}): ${data.message ?? JSON.stringify(data)}`);
  }
  throw new Error("Poyo video submit: no task_id returned");
}

export interface PoyoTaskStatus {
  status: "not_started" | "running" | "finished" | "failed";
  progress?: number;
  /** Primary (first) video URL — kept for backward compatibility */
  resultVideoUrl?: string;
  /** All video URLs returned by the API. For single-shot generations this is
   * a one-element array; for `multi_shots: true` Wan 2.6 jobs the API returns
   * one URL per shot (3 by default). Always populated when `resultVideoUrl`
   * is, so callers can iterate without nullish-checking both. */
  resultVideoUrls?: string[];
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
      // Wan 2.6 multi_shots mode and some newer providers nest results under
      // `shots`, `videos`, or `outputs` instead of `files`. Accept any of them.
      shots?: Array<{ file_url?: string; url?: string }>;
      videos?: Array<{ file_url?: string; url?: string }>;
      outputs?: Array<{ file_url?: string; url?: string }>;
    };
  };

  // Poyo's success code is either 0 or 200 (HTTP-style). Treat anything else
  // as error — see submit() above for the production bug this prevents.
  if (body.code !== undefined && body.code !== 0 && body.code !== 200) {
    throw new Error(`Poyo status check error (code ${body.code}): ${body.message ?? JSON.stringify(body)}`);
  }

  const d = body.data;
  const KNOWN_STATUSES = new Set(["not_started", "running", "finished", "failed"]);
  const rawStatus = d.status;
  if (!KNOWN_STATUSES.has(rawStatus)) {
    // Unknown intermediate status from upstream — treat as still running so the
    // poller keeps checking rather than silently looping or crashing
    console.warn(`[checkPoyoVideoStatus] Unknown status "${rawStatus}" for task ${externalTaskId}; treating as running`);
  }
  const status = (KNOWN_STATUSES.has(rawStatus) ? rawStatus : "running") as PoyoTaskStatus["status"];

  // Collect every video-ish URL we can find. Some providers/modes return:
  //   - `files: [{file_type: "video", file_url: ...}]`              (standard)
  //   - `files: [{file_type: "video_shot_1", ...}, ...]`            (per-shot file types)
  //   - `shots: [{file_url: ...}]` / `videos: [...]` / `outputs:`   (multi-shot variants)
  // Matching by both "video" prefix in file_type and `.mp4/.webm/.mov` URL
  // suffix avoids missing results when the field shape differs from the docs.
  const urls: string[] = [];
  const pushIf = (u: string | undefined) => {
    if (typeof u !== "string" || !u) return;
    if (urls.includes(u)) return;
    urls.push(u);
  };
  if (Array.isArray(d.files)) {
    for (const f of d.files) {
      const ft = typeof f.file_type === "string" ? f.file_type.toLowerCase() : "";
      const url = f.file_url;
      const looksLikeVideo = ft.includes("video") || /\.(mp4|webm|mov|m4v)(?:$|\?)/i.test(url ?? "");
      if (looksLikeVideo) pushIf(url);
    }
    // If nothing matched but files exist, fall through to first item as a
    // best-effort — matches the original behavior for unknown formats.
    if (urls.length === 0 && d.files.length > 0) pushIf(d.files[0]?.file_url);
  }
  if (Array.isArray(d.shots)) for (const s of d.shots) pushIf(s.file_url ?? s.url);
  if (Array.isArray(d.videos)) for (const v of d.videos) pushIf(v.file_url ?? v.url);
  if (Array.isArray(d.outputs)) for (const o of d.outputs) pushIf(o.file_url ?? o.url);

  // Diagnostic log when the task is reported finished but we found no URL.
  // The raw payload helps identify yet-unknown field names without leaking
  // the URL itself (which may contain signed query tokens).
  if (status === "finished" && urls.length === 0) {
    const fieldKeys = Object.keys(d).sort().join(",");
    const fileTypes = Array.isArray(d.files) ? d.files.map((f) => f.file_type).join("|") : "(no-files)";
    console.warn(
      `[checkPoyoVideoStatus] finished but no video URL for task ${externalTaskId}. ` +
      `data keys=[${fieldKeys}], file_types=[${fileTypes}], files.length=${d.files?.length ?? 0}`,
    );
  }

  return {
    status,
    progress: d.progress,
    resultVideoUrl: urls[0],
    resultVideoUrls: urls.length > 0 ? urls : undefined,
    errorMessage: d.error_message,
  };
}
