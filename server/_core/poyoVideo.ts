import { ENV } from "./env";
import { resolveToAbsoluteUrl } from "../storage";

const POYO_BASE = "https://api.poyo.ai";

// UI provider value → Poyo wire model name (docs/poyo-video-api.md).
// Only-add: never drop a key here, old video_tasks rows reference these.
export const POYO_PROVIDER_MAP: Record<string, string> = {
  // existing
  poyo_seedance:     "seedance-2",
  poyo_veo:          "veo3.1-fast",
  poyo_kling26:      "kling-2.6",
  poyo_kling_o3_std: "kling-o3/standard",
  poyo_kling_o3_pro: "kling-o3/pro",
  poyo_kling_o3_4k:  "kling-o3/4K",
  poyo_wan25_t2v:    "wan2.6-text-to-video",
  poyo_wan25_i2v:    "wan2.6-image-to-video",
  poyo_runway45:     "runway-gen-4.5",
  // Sora
  poyo_sora2:              "sora-2",
  poyo_sora2_pro:          "sora-2-pro",
  poyo_sora2_official:     "sora-2-official",
  poyo_sora2_pro_official: "sora-2-pro-official",
  // Veo 3.1 tiers
  poyo_veo_fast:    "veo3.1-fast",
  poyo_veo_lite:    "veo3.1-lite",
  poyo_veo_quality: "veo3.1-quality",
  // Kling
  poyo_kling21_std:   "kling-2.1/standard",
  poyo_kling21_pro:   "kling-2.1/pro",
  poyo_kling25_turbo: "kling-2.5-turbo-pro",
  poyo_kling30_std:   "kling-3.0/standard",
  poyo_kling30_pro:   "kling-3.0/pro",
  poyo_kling30_4k:    "kling-3.0/4K",
  // Wan
  poyo_wan27_t2v:      "wan2.7-text-to-video",
  poyo_wan27_i2v:      "wan2.7-image-to-video",
  poyo_wan22_t2v_fast: "wan2.2-text-to-video-fast",
  poyo_wan22_i2v_fast: "wan2.2-image-to-video-fast",
  // Seedance
  poyo_seedance1_pro:  "seedance-1.0-pro",
  poyo_seedance15_pro: "seedance-1.5-pro",
  poyo_seedance2_fast: "seedance-2-fast",
  // Hailuo
  poyo_hailuo02:     "hailuo-02",
  poyo_hailuo02_pro: "hailuo-02-pro",
  poyo_hailuo23:     "hailuo-2.3",
  // others
  poyo_happy_horse: "happy-horse",
  poyo_grok_video:  "grok-imagine",
};

// Allowed input keys per wire model. The builder copies only these from
// `params` (plus prompt/refs), so the UI can send a superset without poisoning
// any model's payload. `duration`/`seed` are numbers; the rest pass through.
// Keys map 1:1 to the Poyo API field names in docs/poyo-video-api.md.
const VIDEO_PARAM_KEYS: Record<string, string[]> = {
  "seedance-2":      ["resolution", "aspect_ratio", "duration", "camera_fixed", "generate_audio", "seed"],
  "seedance-2-fast": ["resolution", "aspect_ratio", "duration", "camera_fixed", "generate_audio", "seed"],
  "seedance-1.0-pro": ["resolution", "duration", "seed"],
  "seedance-1.5-pro": ["resolution", "duration", "camera_fixed", "generate_audio", "seed"],
  "veo3.1-fast":    ["aspect_ratio", "resolution", "generation_type", "duration"],
  "veo3.1-lite":    ["aspect_ratio", "resolution", "duration"],
  "veo3.1-quality": ["aspect_ratio", "resolution", "generation_type", "duration"],
  "kling-2.6":          ["aspect_ratio", "duration", "sound"],
  "kling-2.1/standard": ["duration"],
  "kling-2.1/pro":      ["duration"],
  "kling-2.5-turbo-pro": ["aspect_ratio", "duration"],
  "kling-3.0/standard": ["aspect_ratio", "duration", "sound", "seed"],
  "kling-3.0/pro":      ["aspect_ratio", "duration", "sound", "seed"],
  "kling-3.0/4K":       ["aspect_ratio", "duration", "sound", "seed"],
  "kling-o3/standard":  ["aspect_ratio", "duration", "sound", "seed"],
  "kling-o3/pro":       ["aspect_ratio", "duration", "sound", "seed"],
  "kling-o3/4K":        ["aspect_ratio", "duration", "sound", "seed"],
  "wan2.6-text-to-video":  ["resolution", "duration", "multi_shots"],
  "wan2.6-image-to-video": ["resolution", "duration", "multi_shots"],
  "wan2.7-text-to-video":  ["resolution", "aspect_ratio", "duration", "seed"],
  "wan2.7-image-to-video": ["resolution", "duration", "multi_shots", "seed"],
  "wan2.2-text-to-video-fast": ["aspect_ratio", "resolution", "seed"],
  "wan2.2-image-to-video-fast": ["resolution", "seed"],
  "hailuo-02":     ["resolution", "duration"],
  "hailuo-02-pro": ["resolution", "duration"],
  "hailuo-2.3":    ["resolution", "duration", "prompt_optimizer"],
  "happy-horse":   ["resolution", "aspect_ratio", "duration", "seed"],
  "grok-imagine":  ["aspect_ratio", "duration", "style"],
  "sora-2":              ["duration", "style", "storyboard"],
  "sora-2-pro":          ["duration", "style", "storyboard"],
  "sora-2-official":     ["duration", "aspect_ratio"],
  "sora-2-pro-official": ["duration", "aspect_ratio", "resolution"],
  "runway-gen-4.5":  ["aspect_ratio", "duration", "seed"],
};

// Models whose duration is fixed regardless of UI selection.
const FIXED_DURATION: Record<string, number> = {
  "veo3.1-fast": 8, "veo3.1-lite": 8, "veo3.1-quality": 8,
};

const NUMERIC_KEYS = new Set(["duration", "seed"]);
const BOOLEAN_KEYS = new Set(["camera_fixed", "generate_audio", "sound", "multi_shots", "storyboard", "prompt_optimizer"]);

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

  // Poyo's API fetches the reference image from upstream — relative paths
  // like `/manus-storage/{key}` aren't resolvable on their side, so convert
  // to an absolute presigned S3 URL before submitting.
  const refImageAbsoluteUrl = opts.referenceImageUrl
    ? await resolveToAbsoluteUrl(opts.referenceImageUrl)
    : undefined;

  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
  };

  // The reference image goes into different fields depending on the model
  // (docs/poyo-video-api.md): Kling 2.1 + Hailuo 2.3 use `start_image_url`;
  // Wan i2v / Sora official / Veo use `image_urls` (array, first = start frame);
  // everything else keeps the historical `reference_image_url`.
  if (refImageAbsoluteUrl) {
    const startImageModels = new Set<string>([
      "kling-2.1/standard", "kling-2.1/pro", "kling-2.5-turbo-pro", "hailuo-2.3",
    ]);
    const imageUrlsModels = new Set<string>([
      "wan2.7-image-to-video", "wan2.2-image-to-video-fast", "wan2.6-image-to-video",
      "sora-2-official", "sora-2-pro-official",
      "veo3.1-fast", "veo3.1-quality", "veo3.1-lite",
    ]);
    if (startImageModels.has(model)) input.start_image_url = refImageAbsoluteUrl;
    else if (imageUrlsModels.has(model)) input.image_urls = [refImageAbsoluteUrl];
    else input.reference_image_url = refImageAbsoluteUrl;
  }

  // Spec-driven: copy only the keys this model accepts (docs/poyo-video-api.md),
  // coercing numeric/boolean fields. Models not in the table send just prompt +
  // refs. This replaces the per-model if-chain so adding a model = one map entry.
  const allowed = VIDEO_PARAM_KEYS[model] ?? [];
  const p = opts.params ?? {};
  for (const key of allowed) {
    const raw = p[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (NUMERIC_KEYS.has(key)) {
      const num = Number(raw);
      if (Number.isFinite(num)) input[key] = Math.trunc(num);
    } else if (BOOLEAN_KEYS.has(key)) {
      input[key] = Boolean(raw);
    } else {
      input[key] = String(raw);
    }
  }
  // Fixed-duration models (Veo 3.1) always send their canonical duration.
  if (model in FIXED_DURATION) input.duration = FIXED_DURATION[model];

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
