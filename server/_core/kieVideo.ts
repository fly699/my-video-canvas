import { KIE_BASE_URL } from "./kie";

// ── kie.ai VIDEO models ───────────────────────────────────────────────────────
//
// Additive provider family that plugs into the EXISTING video_task async system
// (videoTasksRouter + videoTaskPoller) exactly like Poyo / Higgsfield — it does
// NOT touch their submit/poll code. Two upstream endpoint shapes are supported:
//
//   - "jobs": the unified jobs API (POST /api/v1/jobs/createTask, poll
//     GET /api/v1/jobs/recordInfo) — same as kie image models. Body is
//     { model, callBackUrl?, input:{ prompt, ...params, <refField> } }.
//   - "veo":  Veo 3.1's dedicated endpoint (POST /api/v1/veo/generate, poll
//     GET /api/v1/veo/record-info). Params are TOP-LEVEL, not nested in `input`,
//     and reference images use the camelCase `imageUrls` array.
//
// All wire model ids / param names / enums below are verbatim from the archived
// official docs (docs/kie-api.md); credit notes are from docs/kie-pricing.md.
// kie has no env-key poller (unlike Poyo): the resolved kie key is passed in by
// the caller — the router for the inline submit, and the poller after decrypting
// the per-task encrypted stash (params._kieKeyEnc).

type ParamType = "str" | "num" | "bool";
interface VideoParam { key: string; type: ParamType; def?: string | number | boolean }

export interface KieVideoSpec {
  /** UI provider value persisted on video_tasks rows (kie_*). */
  wire: string;
  /** Upstream endpoint family. */
  endpoint: "jobs" | "veo" | "runway";
  label: string;
  family: string;
  /** Allow-listed input params copied from the node's `params` (with defaults
   *  for upstream-required fields so we never 422 on a missing required key). */
  params: VideoParam[];
  /** Reference-image input field + arity, or null for text-only models.
   *  `top` = sits at body top-level (Veo) instead of inside `input`. */
  ref?: { key: string; array: boolean; top?: boolean; required?: boolean };
  /** Model accepts `negative_prompt` (Kling Turbo / Wan 2.5) — fed from the
   *  node's negativePrompt field (docs/kie-api.md). */
  negPrompt?: boolean;
  /** Seedance-style multimodal: besides first_frame_url, also accepts
   *  reference_image_urls / reference_video_urls / reference_audio_urls. */
  multiModal?: boolean;
  /** Source-video input field (motion-control / Wan Animate). Filled from the
   *  node's connected video upstream (referenceVideoUrls). */
  videoRef?: { key: string; array: boolean };
  /** Driving-audio input field (Kling Avatar talking-head). Filled from the
   *  node's connected audio upstream (referenceAudioUrls[0]). */
  audioRef?: { key: string };
  /** Authoritative credit note shown in the node UI (from the pricing table). */
  creditNote: string;
}

// provider (kie_*) → spec. Keys map 1:1 to wire model ids in the docs.
export const KIE_VIDEO_SPECS: Record<string, KieVideoSpec> = {
  // ── Veo 3.1 (dedicated endpoint; dual-mode t2v/i2v via optional imageUrls) ──
  kie_veo31_quality: {
    wire: "veo3", endpoint: "veo", label: "Veo 3.1 Quality", family: "Veo",
    params: [{ key: "aspectRatio", type: "str", def: "16:9" }],
    ref: { key: "imageUrls", array: true, top: true },
    creditNote: "Quality：720p 250 / 1080p 255 / 4K 380 点·条(8s)",
  },
  kie_veo31_fast: {
    wire: "veo3_fast", endpoint: "veo", label: "Veo 3.1 Fast", family: "Veo",
    params: [{ key: "aspectRatio", type: "str", def: "16:9" }],
    ref: { key: "imageUrls", array: true, top: true },
    creditNote: "Fast：720p 60 / 1080p 65 / 4K 180 点·条(8s)",
  },

  // ── Kling 2.6 ──
  kie_kling26_t2v: {
    wire: "kling-2.6/text-to-video", endpoint: "jobs", label: "Kling 2.6 文生视频", family: "Kling",
    params: [
      { key: "sound", type: "bool", def: false },
      { key: "aspect_ratio", type: "str", def: "16:9" },
      { key: "duration", type: "str", def: "5" },
    ],
    creditNote: "5s 无声55/有声110 · 10s 无声110/有声220 点",
  },
  kie_kling26_i2v: {
    wire: "kling-2.6/image-to-video", endpoint: "jobs", label: "Kling 2.6 图生视频", family: "Kling",
    params: [
      { key: "sound", type: "bool", def: false },
      { key: "duration", type: "str", def: "5" },
    ],
    ref: { key: "image_urls", array: true, required: true },
    creditNote: "5s 无声55/有声110 · 10s 无声110/有声220 点",
  },
  // ── Kling 3.0 (single model, t2v + optional frame refs) ──
  kie_kling30: {
    wire: "kling-3.0/video", endpoint: "jobs", label: "Kling 3.0", family: "Kling",
    params: [
      { key: "sound", type: "bool", def: false },
      { key: "aspect_ratio", type: "str", def: "16:9" },
      { key: "duration", type: "str", def: "5" },
      { key: "mode", type: "str", def: "std" },
    ],
    ref: { key: "image_urls", array: true },
    creditNote: "std/pro 1080p≈18-27 · 4K 67 点·秒（含/无音轨，详见价格表）",
  },
  // ── Kling V2.5 Turbo Pro ──
  kie_kling25turbo_t2v: {
    wire: "kling/v2-5-turbo-text-to-video-pro", endpoint: "jobs", label: "Kling 2.5 Turbo 文生视频", family: "Kling",
    params: [
      { key: "duration", type: "str", def: "5" },
      { key: "aspect_ratio", type: "str", def: "16:9" },
      { key: "cfg_scale", type: "num" },
    ],
    negPrompt: true,
    creditNote: "5s 42 / 10s 84 点·条",
  },
  kie_kling25turbo_i2v: {
    wire: "kling/v2-5-turbo-image-to-video-pro", endpoint: "jobs", label: "Kling 2.5 Turbo 图生视频", family: "Kling",
    params: [
      { key: "duration", type: "str", def: "5" },
      { key: "cfg_scale", type: "num" },
    ],
    ref: { key: "image_url", array: false, required: true },
    negPrompt: true,
    creditNote: "5s 42 / 10s 84 点·条",
  },

  // ── Wan 2.5 ──
  kie_wan25_t2v: {
    wire: "wan/2-5-text-to-video", endpoint: "jobs", label: "Wan 2.5 文生视频", family: "Wan",
    params: [
      { key: "duration", type: "str", def: "5" },
      { key: "aspect_ratio", type: "str", def: "16:9" },
      { key: "resolution", type: "str", def: "1080p" },
      { key: "enable_prompt_expansion", type: "bool" },
      { key: "seed", type: "num" },
    ],
    negPrompt: true,
    creditNote: "5s 720p60/1080p100 · 10s 720p120/1080p200 点",
  },
  kie_wan25_i2v: {
    wire: "wan/2-5-image-to-video", endpoint: "jobs", label: "Wan 2.5 图生视频", family: "Wan",
    params: [
      { key: "duration", type: "str", def: "5" },
      { key: "resolution", type: "str", def: "1080p" },
      { key: "enable_prompt_expansion", type: "bool" },
      { key: "seed", type: "num" },
    ],
    ref: { key: "image_url", array: false, required: true },
    negPrompt: true,
    creditNote: "5s 720p60/1080p100 · 10s 720p120/1080p200 点",
  },
  // ── Wan 2.6 ──
  kie_wan26_t2v: {
    wire: "wan/2-6-text-to-video", endpoint: "jobs", label: "Wan 2.6 文生视频", family: "Wan",
    params: [
      { key: "duration", type: "str", def: "5" },
      { key: "resolution", type: "str", def: "1080p" },
    ],
    creditNote: "5s 720p70/1080p104.5 · 10s 140/209.5 · 15s 210/315 点",
  },
  kie_wan26_i2v: {
    wire: "wan/2-6-image-to-video", endpoint: "jobs", label: "Wan 2.6 图生视频", family: "Wan",
    params: [
      { key: "duration", type: "str", def: "5" },
      { key: "resolution", type: "str", def: "1080p" },
    ],
    ref: { key: "image_urls", array: true, required: true },
    creditNote: "5s 720p70/1080p104.5 · 10s 140/209.5 · 15s 210/315 点",
  },

  // ── Hailuo 2.3 (image-to-video only) ──
  kie_hailuo23_pro: {
    wire: "hailuo/2-3-image-to-video-pro", endpoint: "jobs", label: "Hailuo 2.3 Pro 图生视频", family: "Hailuo",
    params: [
      { key: "duration", type: "str", def: "6" },
      { key: "resolution", type: "str", def: "768P" },
    ],
    ref: { key: "image_url", array: false, required: true },
    creditNote: "6s 768p45/1080p80 · 10s 768p90 点·条",
  },
  kie_hailuo23_std: {
    wire: "hailuo/2-3-image-to-video-standard", endpoint: "jobs", label: "Hailuo 2.3 标准 图生视频", family: "Hailuo",
    params: [
      { key: "duration", type: "str", def: "6" },
      { key: "resolution", type: "str", def: "768P" },
    ],
    ref: { key: "image_url", array: false, required: true },
    creditNote: "6s 768p30/1080p50 · 10s 768p50 点·条",
  },

  // ── ByteDance Seedance 2 (multimodal; t2v + first-frame / reference refs) ──
  kie_seedance2: {
    wire: "bytedance/seedance-2", endpoint: "jobs", label: "Seedance 2.0", family: "Seedance",
    params: [
      { key: "resolution", type: "str", def: "720p" },
      { key: "aspect_ratio", type: "str", def: "16:9" },
      { key: "duration", type: "num", def: 5 },
      { key: "generate_audio", type: "bool", def: true },
      { key: "seed", type: "num" },
    ],
    ref: { key: "first_frame_url", array: false },
    multiModal: true,
    creditNote: "480p 19 / 720p 41 / 1080p 102 点·秒（无视频输入）",
  },
  kie_seedance2_fast: {
    wire: "bytedance/seedance-2-fast", endpoint: "jobs", label: "Seedance 2.0 Fast", family: "Seedance",
    params: [
      { key: "resolution", type: "str", def: "720p" },
      { key: "aspect_ratio", type: "str", def: "16:9" },
      { key: "duration", type: "num", def: 5 },
      { key: "generate_audio", type: "bool", def: true },
      { key: "seed", type: "num" },
    ],
    ref: { key: "first_frame_url", array: false },
    multiModal: true,
    creditNote: "480p 15.5 / 720p 33 点·秒（无视频输入）",
  },
  // ── 第二批扩充（均走 jobs/createTask，参数对照 docs/kie-api.md）──
  kie_kling21_std: {
    wire: "kling/v2-1-standard", endpoint: "jobs", label: "Kling 2.1 标准 图生视频", family: "Kling",
    params: [{ key: "duration", type: "str", def: "5" }, { key: "cfg_scale", type: "num" }],
    ref: { key: "image_url", array: false, required: true }, negPrompt: true,
    creditNote: "5s 30 / 10s 60 点·条",
  },
  kie_kling21_pro: {
    wire: "kling/v2-1-pro", endpoint: "jobs", label: "Kling 2.1 专业 图生视频", family: "Kling",
    params: [{ key: "duration", type: "str", def: "5" }, { key: "cfg_scale", type: "num" }],
    ref: { key: "image_url", array: false, required: true }, negPrompt: true,
    creditNote: "5s 55 / 10s 110 点·条",
  },
  kie_wan22_t2v: {
    wire: "wan/2-2-a14b-text-to-video-turbo", endpoint: "jobs", label: "Wan 2.2 文生视频(快)", family: "Wan",
    params: [
      { key: "resolution", type: "str", def: "720p" },
      { key: "aspect_ratio", type: "str", def: "16:9" },
      { key: "enable_prompt_expansion", type: "bool" },
      { key: "seed", type: "num" },
    ],
    creditNote: "480p 6 / 720p 12 点·条",
  },
  kie_wan22_i2v: {
    wire: "wan/2-2-a14b-image-to-video-turbo", endpoint: "jobs", label: "Wan 2.2 图生视频(快)", family: "Wan",
    params: [
      { key: "resolution", type: "str", def: "720p" },
      { key: "enable_prompt_expansion", type: "bool" },
      { key: "seed", type: "num" },
    ],
    ref: { key: "image_url", array: false, required: true },
    creditNote: "480p 6 / 720p 12 点·条",
  },
  kie_wan27_t2v: {
    wire: "wan/2-7-text-to-video", endpoint: "jobs", label: "Wan 2.7 文生视频", family: "Wan",
    params: [
      { key: "resolution", type: "str", def: "1080p" },
      { key: "ratio", type: "str", def: "16:9" },
      { key: "duration", type: "num", def: 5 },
      { key: "prompt_extend", type: "bool", def: true },
      { key: "seed", type: "num" },
    ],
    creditNote: "720p 12 / 1080p 18 点·秒",
  },
  kie_wan27_i2v: {
    wire: "wan/2-7-image-to-video", endpoint: "jobs", label: "Wan 2.7 图生视频", family: "Wan",
    params: [
      { key: "resolution", type: "str", def: "1080p" },
      { key: "duration", type: "num", def: 5 },
      { key: "prompt_extend", type: "bool", def: true },
      { key: "seed", type: "num" },
    ],
    ref: { key: "first_frame_url", array: false, required: true },
    creditNote: "720p 12 / 1080p 18 点·秒",
  },
  kie_hailuo02_std: {
    wire: "hailuo/02-text-to-video-standard", endpoint: "jobs", label: "Hailuo 02 标准 文生视频", family: "Hailuo",
    params: [{ key: "duration", type: "str", def: "6" }, { key: "prompt_optimizer", type: "bool", def: true }],
    creditNote: "768p 7 点·秒",
  },
  kie_hailuo02_pro_t2v: {
    wire: "hailuo/02-text-to-video-pro", endpoint: "jobs", label: "Hailuo 02 专业 文生视频", family: "Hailuo",
    params: [{ key: "prompt_optimizer", type: "bool", def: true }],
    creditNote: "固定 65 点·条",
  },
  kie_hailuo02_pro_i2v: {
    wire: "hailuo/02-image-to-video-pro", endpoint: "jobs", label: "Hailuo 02 专业 图生视频", family: "Hailuo",
    params: [{ key: "prompt_optimizer", type: "bool", def: true }],
    ref: { key: "image_url", array: false, required: true },
    creditNote: "固定 65 点·条",
  },
  kie_grok_t2v: {
    wire: "grok-imagine/text-to-video", endpoint: "jobs", label: "Grok Imagine 文生视频", family: "Grok",
    params: [
      { key: "aspect_ratio", type: "str", def: "16:9" },
      { key: "mode", type: "str", def: "normal" },
      { key: "duration", type: "num", def: 6 },
      { key: "resolution", type: "str", def: "480p" },
    ],
    creditNote: "6s 30 / 10s 40 点·条",
  },
  kie_grok_i2v: {
    wire: "grok-imagine/image-to-video", endpoint: "jobs", label: "Grok Imagine 图生视频", family: "Grok",
    params: [
      { key: "mode", type: "str", def: "normal" },
      { key: "duration", type: "num", def: 6 },
      { key: "resolution", type: "str", def: "480p" },
      { key: "aspect_ratio", type: "str", def: "16:9" },
    ],
    ref: { key: "image_urls", array: true, required: true },
    creditNote: "6s 30 / 10s 40 点·条",
  },
  kie_happyhorse_t2v: {
    wire: "happyhorse/text-to-video", endpoint: "jobs", label: "HappyHorse 文生视频", family: "HappyHorse",
    params: [
      { key: "resolution", type: "str", def: "1080p" },
      { key: "aspect_ratio", type: "str", def: "16:9" },
      { key: "duration", type: "num", def: 5 },
      { key: "seed", type: "num" },
    ],
    creditNote: "720p 16 / 1080p 32 点·秒",
  },
  kie_happyhorse_i2v: {
    wire: "happyhorse/image-to-video", endpoint: "jobs", label: "HappyHorse 图生视频", family: "HappyHorse",
    params: [
      { key: "resolution", type: "str", def: "1080p" },
      { key: "aspect_ratio", type: "str", def: "16:9" },
      { key: "duration", type: "num", def: 5 },
      { key: "seed", type: "num" },
    ],
    ref: { key: "image_url", array: false, required: true },
    creditNote: "720p 16 / 1080p 32 点·秒",
  },
  // ── 第三批：特殊输入（动作控制 / 数字人 / 替身）──
  kie_kling26_motion: {
    wire: "kling-2.6/motion-control", endpoint: "jobs", label: "Kling 2.6 动作控制", family: "Kling",
    params: [
      { key: "character_orientation", type: "str", def: "video" },
      { key: "mode", type: "str", def: "720p" },
    ],
    ref: { key: "input_urls", array: true, required: true },
    videoRef: { key: "video_urls", array: true },
    creditNote: "720p 8 / 1080p 12 点·秒",
  },
  kie_kling30_motion: {
    wire: "kling-3.0/motion-control", endpoint: "jobs", label: "Kling 3.0 动作控制", family: "Kling",
    params: [
      { key: "mode", type: "str", def: "720p" },
      { key: "character_orientation", type: "str", def: "video" },
      { key: "background_source", type: "str", def: "input_video" },
    ],
    ref: { key: "input_urls", array: true, required: true },
    videoRef: { key: "video_urls", array: true },
    creditNote: "720p 9 / 1080p 15 点·秒",
  },
  kie_kling_avatar_std: {
    wire: "kling/ai-avatar-standard", endpoint: "jobs", label: "Kling 数字人 标准", family: "Kling",
    params: [],
    ref: { key: "image_url", array: false, required: true },
    audioRef: { key: "audio_url" },
    creditNote: "7 点·秒",
  },
  kie_kling_avatar_pro: {
    wire: "kling/ai-avatar-pro", endpoint: "jobs", label: "Kling 数字人 专业", family: "Kling",
    params: [],
    ref: { key: "image_url", array: false, required: true },
    audioRef: { key: "audio_url" },
    creditNote: "14 点·秒",
  },
  kie_wan_animate_move: {
    wire: "wan/2-2-animate-move", endpoint: "jobs", label: "Wan 2.2 Animate 动作迁移", family: "Wan",
    params: [{ key: "resolution", type: "str", def: "480p" }],
    ref: { key: "image_url", array: false, required: true },
    videoRef: { key: "video_url", array: false },
    creditNote: "480p 7 / 580p 12 / 720p 15 点·条",
  },
  kie_wan_animate_replace: {
    wire: "wan/2-2-animate-replace", endpoint: "jobs", label: "Wan 2.2 Animate 角色替换", family: "Wan",
    params: [{ key: "resolution", type: "str", def: "480p" }],
    ref: { key: "image_url", array: false, required: true },
    videoRef: { key: "video_url", array: false },
    creditNote: "480p 7 / 580p 12 / 720p 15 点·条",
  },
  // ── Runway（专属端点 /api/v1/runway/generate；轮询 /record-detail，响应形态不同）──
  kie_runway45: {
    wire: "runway-gen-4.5", endpoint: "runway", label: "Runway Gen 4.5", family: "Runway",
    params: [
      { key: "duration", type: "num", def: 5 },
      { key: "quality", type: "str", def: "720p" },
      { key: "aspectRatio", type: "str", def: "16:9" },
    ],
    ref: { key: "imageUrl", array: false }, // 可选：有图则图生视频
    creditNote: "5s 75 / 10s 150 点·条",
  },
};

export function isKieVideoProvider(provider: string): boolean {
  return provider in KIE_VIDEO_SPECS;
}

/** Provider values + labels for the client model picker. */
export function listKieVideoProviders(): Array<{ value: string; label: string; family: string; needsRef: boolean; creditNote: string }> {
  return Object.entries(KIE_VIDEO_SPECS).map(([value, s]) => ({
    value, label: s.label, family: s.family, needsRef: !!s.ref?.required, creditNote: s.creditNote,
  }));
}

// Coerce a UI value to the spec'd type. Strings stay strings (kling/wan duration
// is a string enum like "5"); only num/bool params are converted.
function coerce(type: ParamType, v: unknown): string | number | boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (type === "num") { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
  if (type === "bool") return typeof v === "boolean" ? v : v === "true" || v === "1";
  return String(v);
}

export interface KieVideoSubmitOptions {
  provider: string;
  prompt: string;
  apiKey: string;
  /** Coalesced reference image URLs (caller already validated + made public). */
  referenceImageUrls?: string[];
  /** Multimodal references (Seedance only). */
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  /** Negative prompt (Kling Turbo / Wan 2.5 only — ignored by other models). */
  negativePrompt?: string;
  params?: Record<string, unknown>;
  callBackUrl?: string;
}

/** Submit a kie video job. Returns the upstream taskId. Throws on any non-OK. */
export async function submitKieVideo(opts: KieVideoSubmitOptions): Promise<{ externalTaskId: string }> {
  const spec = KIE_VIDEO_SPECS[opts.provider];
  if (!spec) throw new Error(`未知 kie 视频模型：${opts.provider}`);
  const refs = (opts.referenceImageUrls ?? []).map((u) => u?.trim()).filter((u): u is string => !!u);
  if (spec.ref?.required && refs.length === 0) {
    throw new Error(`${spec.label} 需要参考图（图生视频），请连接或上传参考图`);
  }

  // Build the param bag from the allow-list (defaults fill upstream-required keys).
  const src = opts.params ?? {};
  const bag: Record<string, unknown> = {};
  for (const p of spec.params) {
    const raw = p.key in src ? src[p.key] : p.def;
    const val = coerce(p.type, raw);
    if (val !== undefined) bag[p.key] = val;
  }

  // Negative prompt only for models that document it.
  if (spec.negPrompt && opts.negativePrompt?.trim()) bag.negative_prompt = opts.negativePrompt.trim();

  // Reference image: single string vs array, top-level (Veo) vs inside input.
  const refValue = spec.ref ? (spec.ref.array ? refs : refs[0]) : undefined;
  const hasRef = spec.ref && (spec.ref.array ? refs.length > 0 : !!refs[0]);

  let url: string;
  let body: Record<string, unknown>;
  if (spec.endpoint === "runway") {
    // Runway: dedicated endpoint, flat camelCase body, NO model field.
    url = `${KIE_BASE_URL}/api/v1/runway/generate`;
    body = { prompt: opts.prompt, ...bag }; // duration / quality / aspectRatio
    if (refs[0]) body.imageUrl = refs[0]; // 有图 → 图生视频（覆盖 aspectRatio 推断）
    if (opts.callBackUrl) body.callBackUrl = opts.callBackUrl;
  } else if (spec.endpoint === "veo") {
    // Veo: flat body, params + prompt at top level.
    url = `${KIE_BASE_URL}/api/v1/veo/generate`;
    body = { model: spec.wire, prompt: opts.prompt, ...bag };
    if (hasRef && spec.ref) body[spec.ref.key] = refValue;
    if (opts.callBackUrl) body.callBackUrl = opts.callBackUrl;
  } else {
    // Unified jobs: params nested under `input`.
    const input: Record<string, unknown> = { prompt: opts.prompt, ...bag };
    if (hasRef && spec.ref) input[spec.ref.key] = refValue;
    // Seedance multimodal: first_frame_url carries refs[0] (above); also pass the
    // full reference image/video/audio lists when present (docs/kie-api.md).
    if (spec.multiModal) {
      if (refs.length > 0) input.reference_image_urls = refs;
      const vids = (opts.referenceVideoUrls ?? []).filter(Boolean);
      const auds = (opts.referenceAudioUrls ?? []).filter(Boolean);
      if (vids.length) input.reference_video_urls = vids;
      if (auds.length) input.reference_audio_urls = auds;
    }
    // Source-video input (motion-control / Wan Animate) — required.
    if (spec.videoRef) {
      const vids = (opts.referenceVideoUrls ?? []).map((u) => u?.trim()).filter((u): u is string => !!u);
      if (vids.length === 0) throw new Error(`${spec.label} 需要源视频，请连线一个视频节点（剪辑/视频/素材）`);
      input[spec.videoRef.key] = spec.videoRef.array ? vids : vids[0];
    }
    // Driving-audio input (Kling Avatar) — required.
    if (spec.audioRef) {
      const auds = (opts.referenceAudioUrls ?? []).map((u) => u?.trim()).filter((u): u is string => !!u);
      if (auds.length === 0) throw new Error(`${spec.label} 需要音频，请连线一个音频节点`);
      input[spec.audioRef.key] = auds[0];
    }
    url = `${KIE_BASE_URL}/api/v1/jobs/createTask`;
    body = { model: spec.wire, input };
    if (opts.callBackUrl) body.callBackUrl = opts.callBackUrl;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`kie 视频提交失败 (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { code?: number; msg?: string; data?: { taskId?: string } };
  if (data.code !== 200 || !data.data?.taskId) {
    throw new Error(`kie 视频提交返回错误 (code ${data.code}): ${data.msg ?? ""}`);
  }
  return { externalTaskId: data.data.taskId };
}

export interface KieVideoStatus {
  status: "processing" | "finished" | "failed";
  resultVideoUrls?: string[];
  errorMessage?: string;
}

// Pull result URLs out of the two possible shapes (array, or JSON-string).
function parseUrls(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((u): u is string => typeof u === "string" && !!u);
  if (typeof v === "string" && v) {
    try { const j = JSON.parse(v); return Array.isArray(j) ? j.filter((u): u is string => typeof u === "string") : (typeof j === "string" ? [j] : []); }
    catch { return [v]; }
  }
  return [];
}

/** Poll a kie video job. `apiKey` is required (kie has no env poller key). */
export async function checkKieVideoStatus(provider: string, externalTaskId: string, apiKey: string): Promise<KieVideoStatus> {
  const spec = KIE_VIDEO_SPECS[provider];
  if (!spec) throw new Error(`未知 kie 视频模型：${provider}`);

  // Runway has its OWN record-detail endpoint with a different response shape
  // (data.state + data.videoInfo.videoUrl, not successFlag + resultUrls).
  if (spec.endpoint === "runway") {
    const r = await fetch(`${KIE_BASE_URL}/api/v1/runway/record-detail?taskId=${encodeURIComponent(externalTaskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`kie 视频状态查询失败 (${r.status})`);
    const b = (await r.json()) as { code?: number; data?: { state?: string; failMsg?: string; videoInfo?: { videoUrl?: string } } };
    const st = b.data?.state;
    if (st === "success") {
      const u = b.data?.videoInfo?.videoUrl;
      return u ? { status: "finished", resultVideoUrls: [u] }
        : { status: "failed", errorMessage: "[CHARGED] Runway 已生成但未返回 URL（积分已扣，请勿重试）" };
    }
    if (st === "fail" || st === "failed") return { status: "failed", errorMessage: b.data?.failMsg ?? "生成失败" };
    return { status: "processing" }; // wait / queueing / generating
  }

  const base = spec.endpoint === "veo"
    ? `${KIE_BASE_URL}/api/v1/veo/record-info?taskId=`
    : `${KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId=`;
  const res = await fetch(`${base}${encodeURIComponent(externalTaskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Transient upstream hiccups bubble up as a throw → the poller's retry
    // counter handles them (same contract as the Poyo status check).
    throw new Error(`kie 视频状态查询失败 (${res.status})`);
  }
  const body = (await res.json()) as {
    code?: number;
    data?: { successFlag?: number; errorMessage?: string; resultUrls?: unknown; response?: { result_urls?: unknown; resultUrls?: unknown } };
  };
  const d = body.data;
  if (!d) return { status: "processing" };
  // successFlag: 0 generating, 1 success, 2/3 failed (both endpoint families).
  if (d.successFlag === 1) {
    const urls = parseUrls(d.response?.result_urls ?? d.response?.resultUrls ?? d.resultUrls);
    if (!urls.length) return { status: "failed", errorMessage: "[CHARGED] kie 视频已生成完成但未返回 URL（积分已扣，请勿重试）" };
    return { status: "finished", resultVideoUrls: urls };
  }
  if (d.successFlag === 2 || d.successFlag === 3) {
    return { status: "failed", errorMessage: d.errorMessage ?? "生成失败" };
  }
  return { status: "processing" };
}
