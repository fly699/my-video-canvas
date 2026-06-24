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
  // Veo 3.1 官方版：可变时长 4/6/8s + sound 控制（非官方版固定 8s）。
  poyo_veo_fast_official:    "veo3.1-fast-official",
  poyo_veo_lite_official:    "veo3.1-lite-official",
  poyo_veo_quality_official: "veo3.1-quality-official",
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
  poyo_wan27_ref:      "wan2.7-reference-to-video",
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
  // 官方版：duration 4/6/8 可变、含 sound；lite-official 无 generation_type、不支持 reference。
  "veo3.1-fast-official":    ["aspect_ratio", "resolution", "generation_type", "duration", "sound"],
  "veo3.1-lite-official":    ["aspect_ratio", "resolution", "duration", "sound"],
  "veo3.1-quality-official": ["aspect_ratio", "resolution", "generation_type", "duration", "sound"],
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
  // 参考生视频：prompt + reference_image_urls/reference_video_urls 至少一种，duration 2-10
  "wan2.7-reference-to-video": ["resolution", "duration", "seed"],
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

// Some models REQUIRE a param Poyo would otherwise 400 on ("sound is required"),
// even though the UI offers no control for it. Send a safe default when the
// caller didn't specify one. Keys here must also appear in VIDEO_PARAM_KEYS.
// Kling 2.6 / 3.0 / o3 require `sound`; default to off (no audio, no surprises).
const VIDEO_PARAM_DEFAULTS: Record<string, Record<string, unknown>> = {
  "kling-2.6": { sound: false },
  "kling-3.0/standard": { sound: false },
  "kling-3.0/pro": { sound: false },
  "kling-3.0/4K": { sound: false },
  "kling-o3/standard": { sound: false },
  "kling-o3/pro": { sound: false },
  "kling-o3/4K": { sound: false },
};

// ── Reference-image field mapping ─────────────────────────────────────────────
// SINGLE image: the historical per-model field (start_image_url / image_urls /
// reference_image_url). Kept byte-for-byte to avoid regressing working jobs.
const SINGLE_START_IMAGE_MODELS = new Set<string>([
  "kling-2.1/standard", "kling-2.1/pro", "kling-2.5-turbo-pro", "hailuo-2.3",
]);
// veo3.1-lite 是纯文生视频模型：不支持 image_urls 也不支持 generation_type
// (docs/poyo-video-api.md:70)。给它发任何参考图字段都会 400，故整条参考链路对它跳过。
const TEXT_ONLY_MODELS = new Set<string>(["veo3.1-lite"]);

// 专属「参考生视频」wire：参考图永远走 reference_image_urls（多模态参考），不当首尾帧；
// 且必须至少提供一张参考图或一个参考视频，否则 Poyo 400（docs/poyo-video-api.md:166）。
const REFERENCE_ONLY_MODELS = new Set<string>(["wan2.7-reference-to-video"]);

const SINGLE_IMAGE_URLS_MODELS = new Set<string>([
  "wan2.7-image-to-video", "wan2.2-image-to-video-fast", "wan2.6-image-to-video",
  "sora-2-official", "sora-2-pro-official",
  "veo3.1-fast", "veo3.1-quality",
  "veo3.1-fast-official", "veo3.1-lite-official", "veo3.1-quality-official",
  // Seedance-2：单张手动参考图按「首帧」走 image_urls（与 2 图的首尾帧路径一致、
  // 文档合法）。此前落到通用单数 reference_image_url —— seedance-2 没有这个字段
  // （docs/poyo-video-api.md §六：模式只有 image_urls 首尾帧 / reference_image_urls
  // 多模态参考，二者互斥），结果单图被悄悄丢弃。reference（主体）模式仍由上游
  // 的 referenceMode="reference" 分支走 reference_image_urls，不受影响。
  "seedance-2", "seedance-2-fast",
]);

function applySingleImage(input: Record<string, unknown>, model: string, url: string): void {
  if (SINGLE_START_IMAGE_MODELS.has(model)) input.start_image_url = url;
  else if (SINGLE_IMAGE_URLS_MODELS.has(model)) input.image_urls = [url];
  else input.reference_image_url = url;
}

// MULTI image: per wire-model capability (docs/poyo-video-api.md §二-七). Only
// models that genuinely accept >1 reference image appear here; anything absent
// falls back to single-image mapping on the first image (no surprise charges).
interface MultiImageSpec {
  imageUrls?: number;       // image_urls array cap (frame mode: [0]=start [1]=end …)
  startEnd?: boolean;       // start_image_url + end_image_url (2 frames)
  referenceImages?: number; // reference_image_urls cap (multi-reference mode)
  referenceVideos?: number; // reference_video_urls cap (multi-modal reference)
  referenceAudios?: number; // reference_audio_urls cap (multi-modal reference)
  veoGenType?: boolean;     // also derive generation_type (frame=2 / reference=3)
}
const MULTI_IMAGE_SPEC: Record<string, MultiImageSpec> = {
  "seedance-2":      { imageUrls: 2, referenceImages: 9, referenceVideos: 3, referenceAudios: 3 },
  "seedance-2-fast": { imageUrls: 2, referenceImages: 9, referenceVideos: 3, referenceAudios: 3 },
  "veo3.1-fast":     { imageUrls: 3, veoGenType: true },
  "veo3.1-quality":  { imageUrls: 2, veoGenType: true }, // frame only, no reference
  // 官方版：fast/quality 支持 reference(3 图)；lite-official 最多 2 图、frame only、无 reference。
  "veo3.1-fast-official":    { imageUrls: 3, veoGenType: true },
  "veo3.1-quality-official": { imageUrls: 3, veoGenType: true },
  "veo3.1-lite-official":    { imageUrls: 2 },
  "kling-2.1/pro":        { startEnd: true },
  "kling-2.5-turbo-pro":  { startEnd: true },
  "kling-3.0/standard":   { imageUrls: 2 },
  "kling-3.0/pro":        { imageUrls: 2 },
  "kling-3.0/4K":         { imageUrls: 2 },
  "kling-o3/standard": { imageUrls: 2, referenceImages: 4 },
  "kling-o3/pro":      { imageUrls: 2, referenceImages: 4 },
  "kling-o3/4K":       { imageUrls: 2, referenceImages: 4 },
  // Wan 2.7 t2v/i2v do NOT accept reference_*_urls — the multi-modal "参考生" path
  // is the SEPARATE wire model `wan2.7-reference-to-video` below.
  "wan2.7-image-to-video":      { imageUrls: 2 },
  // Wan 2.7 参考生视频：reference_image_urls(≤4) + reference_video_urls(≤3) 多模态参考，
  // 永远走 reference 模式（见 REFERENCE_ONLY_MODELS），不走首尾帧 image_urls。
  "wan2.7-reference-to-video":  { referenceImages: 4, referenceVideos: 3 },
  "wan2.2-image-to-video-fast": { imageUrls: 2 },
  "happy-horse":     { imageUrls: 1, referenceImages: 9 },
};

function applyMultiImage(input: Record<string, unknown>, model: string, urls: string[]): void {
  const spec = MULTI_IMAGE_SPEC[model];
  if (!spec) { applySingleImage(input, model, urls[0]); return; } // no multi support → first only
  if (spec.startEnd) {
    input.start_image_url = urls[0];
    if (urls[1]) input.end_image_url = urls[1];
    return;
  }
  if (spec.veoGenType) {
    const n = Math.min(urls.length, spec.imageUrls ?? 3);
    input.image_urls = urls.slice(0, n);
    // generation_type: 2 imgs = frame, 3 = reference. The params loop runs after
    // this and lets an explicit user choice override.
    if (n >= 3) input.generation_type = "reference";
    else if (n === 2) input.generation_type = "frame";
    return;
  }
  // Frame (image_urls) for counts within the frame cap; reference for more.
  if (spec.imageUrls && urls.length <= spec.imageUrls) {
    input.image_urls = urls.slice(0, spec.imageUrls);
    return;
  }
  if (spec.referenceImages) {
    input.reference_image_urls = urls.slice(0, spec.referenceImages);
    return;
  }
  if (spec.imageUrls) {
    input.image_urls = urls.slice(0, spec.imageUrls);
    return;
  }
  applySingleImage(input, model, urls[0]);
}

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
  /** Multi-reference images (首尾帧 / reference / elements). [0] mirrors
   *  referenceImageUrl. When >1, mapped per-model via MULTI_IMAGE_SPEC. */
  referenceImageUrls?: string[];
  /** Multi-modal reference videos → reference_video_urls (Seedance-2 / Wan-2.7). */
  referenceVideoUrls?: string[];
  /** Multi-modal reference audios → reference_audio_urls (Seedance-2). */
  referenceAudioUrls?: string[];
  /** "reference" forces multi-reference (subject) mode — reference images route to
   *  `reference_image_urls` instead of the首尾帧 `image_urls` path — for models that
   *  support it (MULTI_IMAGE_SPEC.referenceImages). Used when the images are character
   *  SUBJECTS (identity), not start/end frames. Falls back to the normal mapping for
   *  models without a reference mode. Omitted = legacy frame-first behavior. */
  referenceMode?: "reference" | "frame";
  params?: Record<string, unknown>;
}): Promise<SubmitPoyoVideoResult> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");

  const model = POYO_PROVIDER_MAP[opts.provider];
  if (!model) throw new Error(`Unknown poyo provider: ${opts.provider}`);

  // Coalesce the reference image source: prefer the multi-image list, fall back
  // to the legacy single field. De-dupe while preserving order.
  const rawRefs = (opts.referenceImageUrls?.length ? opts.referenceImageUrls : (opts.referenceImageUrl ? [opts.referenceImageUrl] : []))
    .map((u) => u?.trim()).filter((u): u is string => Boolean(u));
  const uniqueRefs = Array.from(new Set(rawRefs));
  // Poyo's API fetches reference images from upstream — relative paths like
  // `/manus-storage/{key}` aren't resolvable on their side, so convert each to
  // an absolute presigned S3 URL before submitting.
  const resolvedRefs = await Promise.all(uniqueRefs.map((u) => resolveToAbsoluteUrl(u)));

  // Multi-modal reference videos/audios (only forwarded for models that accept
  // them — see MULTI_IMAGE_SPEC). Resolved to absolute URLs like images.
  const cleanList = (list?: string[]) => Array.from(new Set((list ?? []).map((u) => u?.trim()).filter((u): u is string => Boolean(u))));
  const resolvedVideoRefs = await Promise.all(cleanList(opts.referenceVideoUrls).map((u) => resolveToAbsoluteUrl(u)));
  const resolvedAudioRefs = await Promise.all(cleanList(opts.referenceAudioUrls).map((u) => resolveToAbsoluteUrl(u)));

  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
  };

  const refSpec = MULTI_IMAGE_SPEC[model];
  const refVideos = (refSpec?.referenceVideos && resolvedVideoRefs.length > 0) ? resolvedVideoRefs.slice(0, refSpec.referenceVideos) : [];
  const refAudios = (refSpec?.referenceAudios && resolvedAudioRefs.length > 0) ? resolvedAudioRefs.slice(0, refSpec.referenceAudios) : [];
  // Multi-modal reference mode (reference_*_urls) is MUTUALLY EXCLUSIVE with the
  // first/last-frame image_urls path (docs/poyo-video-api.md §五/§六). When any
  // reference video/audio is present — OR the caller explicitly asked for reference
  // (subject) mode because the images are character identities, not start/end frames —
  // route the images to reference_image_urls (reference mode) instead of image_urls.
  const inReferenceMode = REFERENCE_ONLY_MODELS.has(model) || refVideos.length > 0 || refAudios.length > 0 || opts.referenceMode === "reference";
  // 专属参考生 wire：必须至少有一张参考图或一个参考视频。
  if (REFERENCE_ONLY_MODELS.has(model) && resolvedRefs.length === 0 && refVideos.length === 0) {
    throw new Error("参考生视频需要至少一张参考图或一个参考视频，请连接/上传参考素材");
  }
  // 纯文生模型(veo3.1-lite)：跳过所有参考图/视频/音频字段，否则 Poyo 400。
  if (!TEXT_ONLY_MODELS.has(model)) {
    if (inReferenceMode && refSpec?.referenceImages && resolvedRefs.length > 0) {
      input.reference_image_urls = resolvedRefs.slice(0, refSpec.referenceImages);
    } else if (resolvedRefs.length === 1) {
      applySingleImage(input, model, resolvedRefs[0]);
    } else if (resolvedRefs.length > 1) {
      applyMultiImage(input, model, resolvedRefs);
    }
    if (refVideos.length > 0) input.reference_video_urls = refVideos;
    if (refAudios.length > 0) input.reference_audio_urls = refAudios;
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
  // Fill required params the UI doesn't expose (e.g. Kling `sound`) so Poyo
  // doesn't 400 on "<key> is required". Only sets keys still missing.
  const defaults = VIDEO_PARAM_DEFAULTS[model];
  if (defaults) {
    for (const [key, value] of Object.entries(defaults)) {
      if (input[key] === undefined) input[key] = value;
    }
  }
  // Fixed-duration models (Veo 3.1) always send their canonical duration.
  if (model in FIXED_DURATION) input.duration = FIXED_DURATION[model];
  // veo3.1-quality 不支持 reference 模式(docs/poyo-video-api.md:70)——客户端已不再
  // 提供该选项，但旧节点 params 里可能残留 generation_type:"reference"，会被 Poyo 400。
  // 兜底丢弃，让上游按图数自动判定(quality 上限 2 图=frame)。
  if (model === "veo3.1-quality" && input.generation_type === "reference") delete input.generation_type;

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
