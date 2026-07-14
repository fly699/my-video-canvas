import { ENV } from "./env";
import { storagePut, resolveToAbsoluteUrl } from "../storage";
import { isAudioPersistenceEnabled } from "./storageConfig";

const POYO_BASE = "https://api.poyo.ai";
const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 60; // 4 min max

// Statuses that mean "task is still progressing" — anything else terminal that
// isn't an explicit "finished" should surface immediately rather than wait out
// the 4-minute timeout. Without this, cancelled / expired / timeout / unknown
// statuses look identical to in-progress and hide the real failure for the
// full poll window.
// "not_started" is Poyo's initial state for a freshly-queued task (same as the
// video API) — it must be polled through, not treated as a terminal failure.
export const IN_PROGRESS_STATUSES = new Set(["not_started", "queued", "pending", "processing", "running", "submitted", "in_progress", "started"]);

// User-facing music model identifiers. Suno variants share the `generate-music`
// endpoint and differ only by an `input.mv` value (V4 / V4_5 / V4_5PLUS /
// V4_5ALL / V5 / V5_5) — Poyo's design is "endpoint + sub-params". MiniMax uses
// its own model id and the standard status endpoint (like ElevenLabs TTS).
export type PoyoMusicModel =
  | "suno-v4"
  | "suno-v4.5"
  | "suno-v4.5plus"
  | "suno-v4.5all"
  | "suno-v5"
  | "suno-v5.5"
  | "minimax-music-2.6"
  | "elevenlabs-music";

// User-facing dotted id → Poyo wire mv value (underscore format per official docs).
const SUNO_MV_MAP: Record<string, string> = {
  "suno-v4":       "V4",
  "suno-v4.5":     "V4_5",
  "suno-v4.5plus": "V4_5PLUS",
  "suno-v4.5all":  "V4_5ALL",
  "suno-v5":       "V5",
  "suno-v5.5":     "V5_5",
};

// Per-mv character limits (prompt / style / title) from the official docs.
const SUNO_LIMITS: Record<string, { prompt: number; style: number; title: number }> = {
  V4:       { prompt: 3000, style: 200,  title: 80  },
  V4_5:     { prompt: 5000, style: 1000, title: 100 },
  V4_5PLUS: { prompt: 5000, style: 1000, title: 100 },
  V4_5ALL:  { prompt: 5000, style: 1000, title: 80  },
  V5:       { prompt: 5000, style: 1000, title: 100 },
  V5_5:     { prompt: 5000, style: 1000, title: 100 },
};

export interface SubmitPoyoMusicOptions {
  model: PoyoMusicModel;
  prompt: string;
  style?: string;
  instrumental?: boolean;       // true = instrumental-only
  negativeTags?: string;        // Suno negative_tags
  vocalGender?: "m" | "f";
  styleWeight?: number;         // 0-1
  lyrics?: string;              // MiniMax only, ≤3500
}

export interface PoyoMusicResult {
  url: string;
  duration?: number;
  imageUrl?: string;            // Suno cover image (detail/music)
  // #153 音频/任务唯一标识——持久化到节点后，作为「原生续写/段落重写/分离/加人声」等
  // 依赖 audio_id 的第二批工具的入参。仅 Suno 系 generate-music / MiniMax 的 detail 返回。
  audioId?: string;
  taskId?: string;
  // ElevenLabs V3 TTS with timestamps enabled returns a second `timestamps.json`
  // file (file_type:"other"). Surfaced here so the TTS path can hand back a
  // download URL. The music path never sets this.
  timestampsUrl?: string;
}

// Re-host an upstream audio URL to own storage when persistence is enabled;
// otherwise return the upstream URL (24h TTL). Shared by both music branches.
async function persistAudioUrl(upstreamUrl: string): Promise<string> {
  if (!(await isAudioPersistenceEnabled())) return upstreamUrl;
  try {
    const audioRes = await fetch(upstreamUrl);
    if (audioRes.ok) {
      const buf = Buffer.from(await audioRes.arrayBuffer());
      const mimeType = audioRes.headers.get("content-type") ?? "audio/mpeg";
      const ext = mimeType.includes("wav") ? "wav" : "mp3";
      const { url } = await storagePut(`generated/audio-${Date.now()}.${ext}`, buf, mimeType);
      return url;
    }
  } catch { /* fall through to upstream */ }
  return upstreamUrl;
}

async function poyoSubmit(model: string, input: Record<string, unknown>): Promise<string> {
  const submitRes = await fetch(`${POYO_BASE}/api/generate/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.poyoApiKey}`,
    },
    body: JSON.stringify({ model, input }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    if (submitRes.status === 404) {
      throw new Error(`Poyo 音乐生成失败 (404): 模型 "${model}" 不存在或已下架。原始响应: ${text}`);
    }
    throw new Error(`Poyo 音乐生成失败 (${submitRes.status}, model=${model}): ${text}`);
  }
  const submitData = (await submitRes.json()) as { code?: number; message?: string; data?: { task_id?: string } };
  if (submitData.code !== undefined && submitData.code !== 0 && submitData.code !== 200) {
    throw new Error(`Poyo audio submit error (code ${submitData.code}): ${submitData.message ?? JSON.stringify(submitData)}`);
  }
  const taskId = submitData.data?.task_id;
  if (!taskId) throw new Error(`Poyo audio submit: no task_id returned. Response: ${JSON.stringify(submitData)}`);
  return taskId;
}

// Suno series: poll GET /api/generate/detail/music?task_id= → files[].audio_url
async function pollPoyoDetailMusic(taskId: string): Promise<PoyoMusicResult> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${POYO_BASE}/api/generate/detail/music?task_id=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${ENV.poyoApiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) continue;
    const body = (await res.json()) as {
      code?: number;
      data?: { status?: string; files?: Array<Record<string, unknown>>; error_message?: string };
      status?: string;
      files?: Array<Record<string, unknown>>;
      error_message?: string;
    };
    // Tolerate both wrapped ({code,data}) and flat ({status,files}) shapes.
    const d = body.data ?? body;
    if (!d?.status) continue;
    if (d.status === "finished") {
      const file = d.files?.[0];
      const upstream = file?.audio_url as string | undefined;
      if (!upstream) throw new Error("[CHARGED] Poyo 音乐生成完成但响应未含 audio_url（积分已扣，请勿重试）");
      const url = await persistAudioUrl(upstream);
      return {
        url,
        duration: typeof file?.duration === "number" ? (file.duration as number) : undefined,
        imageUrl: typeof file?.image_url === "string" ? (file.image_url as string) : undefined,
        audioId: typeof file?.audio_id === "string" ? (file.audio_id as string) : undefined,
        taskId,
      };
    }
    if (IN_PROGRESS_STATUSES.has(d.status)) continue;
    throw new Error(`Poyo music status="${d.status}": ${d.error_message ?? "no detail"}`);
  }
  throw new Error("Poyo music generation timed out");
}

// MiniMax / standard-task series: poll GET /api/generate/status/{id} → file_type:"audio"
async function pollPoyoStatusAudio(taskId: string): Promise<PoyoMusicResult> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${POYO_BASE}/api/generate/status/${taskId}`, {
      headers: { Authorization: `Bearer ${ENV.poyoApiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) continue;
    const body = (await res.json()) as {
      data?: { status: string; files?: Array<{ file_url: string; file_type: string; duration?: number; audio_id?: string }>; error_message?: string };
    };
    const d = body.data;
    if (!d) continue;
    if (d.status === "finished") {
      const file = d.files?.find((f) => f.file_type === "audio") ?? d.files?.[0];
      if (!file?.file_url) throw new Error("[CHARGED] Poyo 音乐生成完成但响应未含 audio file URL（积分已扣，请勿重试）");
      const url = await persistAudioUrl(file.file_url);
      return { url, duration: file.duration, audioId: typeof file.audio_id === "string" ? file.audio_id : undefined, taskId };
    }
    if (IN_PROGRESS_STATUSES.has(d.status)) continue;
    throw new Error(`Poyo music status="${d.status}": ${d.error_message ?? "no detail"}`);
  }
  throw new Error("Poyo music generation timed out");
}

export async function submitAndPollPoyoMusic(
  opts: SubmitPoyoMusicOptions,
): Promise<PoyoMusicResult> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");

  // ── MiniMax Music 2.6 — standard status endpoint ──
  if (opts.model === "minimax-music-2.6") {
    // docs/poyo-music-api.md：prompt 必填且 10-2000 字符。超 2000 会被上游 400，
    // 故截断到 2000（下限 10 由用户输入保证，过短时上游会提示）。
    const input: Record<string, unknown> = { prompt: opts.prompt.slice(0, 2000) };
    // Docs require at least one of lyrics / is_instrumental / lyrics_optimizer.
    if (opts.lyrics) {
      input.lyrics = opts.lyrics.slice(0, 3500);
    } else if (opts.instrumental) {
      input.is_instrumental = true;
    } else {
      input.lyrics_optimizer = true; // let the model auto-write lyrics
    }
    const taskId = await poyoSubmit("minimax-music-2.6", input);
    return pollPoyoStatusAudio(taskId);
  }

  // ── #151 ElevenLabs Music — 标准 status 端点，input.text 或 composition_plan 二选一 ──
  // （官方 api-manual/music-series/elevenlabs-music：text 描述 + 可选 duration/is_instrumental）
  if (opts.model === "elevenlabs-music") {
    const input: Record<string, unknown> = { text: opts.prompt.slice(0, 5000) };
    if (opts.instrumental) input.is_instrumental = true;
    const taskId = await poyoSubmit("elevenlabs-music", input);
    return pollPoyoStatusAudio(taskId);
  }

  // ── Suno series → generate-music + mv + custom_mode auto-switch ──
  const mv = SUNO_MV_MAP[opts.model];
  if (!mv) {
    throw new Error(
      `Poyo 模型 "${opts.model}" 暂未接入。当前可用：Suno V4 / V4.5 / V4.5PLUS / V4.5ALL / V5 / V5.5，或 MiniMax Music 2.6。`
    );
  }
  const limits = SUNO_LIMITS[mv] ?? { prompt: 5000, style: 1000, title: 100 };
  const instrumental = opts.instrumental ?? true;

  // The user's "music description" is a freeform style/vibe description (not
  // lyrics). Per the Poyo docs, custom mode requires style+title (and prompt
  // when vocals). We ALWAYS use custom mode so both the description AND the
  // instrumental flag are honored — simple mode can't express instrumental and
  // would force-drop the description on the default (instrumental) path.
  const desc = opts.prompt.trim();
  const styleTag = opts.style?.trim();
  // Combine the optional English genre tag with the freeform description; both
  // are "style"-level signals for Suno. Never emit the literal "instrumental".
  const styleField = ([styleTag, desc].filter(Boolean).join(", ")).slice(0, limits.style)
    || (instrumental ? "ambient instrumental" : "pop");
  const title = (styleTag || desc.slice(0, 40) || "Untitled").slice(0, limits.title);

  const input: Record<string, unknown> = { custom_mode: true, mv, title, instrumental, style: styleField };
  // For vocal tracks, also hand Suno the description as creative/lyric direction.
  if (!instrumental && desc) input.prompt = desc.slice(0, limits.prompt);
  if (opts.negativeTags) input.negative_tags = opts.negativeTags;
  if (opts.vocalGender) input.vocal_gender = opts.vocalGender;
  if (opts.styleWeight !== undefined) input.style_weight = opts.styleWeight;
  const taskId = await poyoSubmit("generate-music", input);
  return pollPoyoDetailMusic(taskId);
}

// ── #152 音乐工具第一批（人声分离 / 翻唱 / 续写 / 写歌词）──────────────────────
// 参数与响应形态严格按 Poyo 官方 api-manual/music-series 各页 schema（MCP 取回）。
// 提交都走 /api/generate/submit + 轮询 /api/generate/detail/music（同 Suno），
// 但 files[0] 的结果字段各不相同：cover/extend→audio_url、separate→vocal_removal(JSON)、
// lyrics→text。故此处单独走一套 detail 解析。
// extend_native（#153 第二批）：对「本站已生成」的 Suno 曲目原生续写，用 audio_id（非 upload_url）。
export type PoyoMusicTool = "sep_vocals" | "cover" | "extend" | "lyrics" | "extend_native";

// UI 工具 id → Poyo wire model（禁止改名，旧节点 payload 引用这些值）。
export const POYO_MUSIC_TOOL_WIRE: Record<PoyoMusicTool, string> = {
  sep_vocals:   "upload-and-separate-vocals",
  cover:        "upload-and-cover-audio",
  extend:       "upload-and-extend-audio",
  lyrics:       "generate-lyrics",
  extend_native: "extend-music",
};

export interface SubmitPoyoMusicToolOptions {
  tool: PoyoMusicTool;
  /** 源音频公网 URL（sep→audio_url；cover/extend→upload_url；lyrics/extend_native 不需要）。 */
  audioUrl?: string;
  /** #153 本站曲目的 audio_id（extend_native 必填；非上传，指向已生成的 Suno 曲目）。 */
  audioId?: string;
  prompt?: string;                 // cover/extend 风格描述或歌词；lyrics 主题描述
  // 人声分离
  sepModel?: "base" | "enhanced" | "instrumental";
  sepOutput?: "general" | "bass" | "drums" | "other" | "piano" | "guitar" | "vocals";
  // 翻唱 / 续写（Suno 系子参数）
  mv?: string;                     // V4 / V4_5 / V4_5ALL / V4_5PLUS / V5 / V5_5（默认 V5）
  instrumental?: boolean;
  negativeTags?: string;
  vocalGender?: "m" | "f";
  styleWeight?: number;
  // 续写
  continueAt?: number;             // 从第几秒开始续（必填 for extend）
}

export interface PoyoMusicToolResult {
  kind: "audio" | "stems" | "lyrics";
  url?: string;                    // cover / extend 产出音频（已转存）
  duration?: number;
  /** 人声分离产出的各音轨（键 = vocals/bass/drums/piano/guitar/other，已逐条转存）。 */
  stems?: Record<string, string>;
  lyrics?: string;                 // 写歌词产出文本
  title?: string;
  // #153 extend_native 产出的**新**曲目 audio_id / task_id——回写节点即可继续链式续写。
  audioId?: string;
  taskId?: string;
}

const VALID_MV = new Set(["V4", "V4_5", "V4_5ALL", "V4_5PLUS", "V5", "V5_5"]);
const clampMv = (mv?: string): string => (mv && VALID_MV.has(mv) ? mv : "V5");

// 轮询 detail/music 拿到 finished 的 files[0]（工具专用：不强求 audio_url）。
async function pollPoyoToolDetail(taskId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${POYO_BASE}/api/generate/detail/music?task_id=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${ENV.poyoApiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) continue;
    const body = (await res.json()) as { code?: number; data?: { status?: string; files?: Array<Record<string, unknown>>; error_message?: string }; status?: string; files?: Array<Record<string, unknown>>; error_message?: string };
    const d = (body.data ?? body) as { status?: string; files?: Array<Record<string, unknown>>; error_message?: string };
    if (!d?.status) continue;
    if (d.status === "finished") {
      const file = d.files?.[0];
      if (!file) throw new Error("[CHARGED] Poyo 音频工具生成完成但响应为空（积分已扣，请勿重试）");
      return file;
    }
    if (IN_PROGRESS_STATUSES.has(d.status)) continue;
    throw new Error(`Poyo 音频工具 status="${d.status}": ${d.error_message ?? "no detail"}`);
  }
  throw new Error("Poyo 音频工具生成超时");
}

export async function submitAndPollPoyoMusicTool(opts: SubmitPoyoMusicToolOptions): Promise<PoyoMusicToolResult> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");
  const wire = POYO_MUSIC_TOOL_WIRE[opts.tool];

  // ── 写歌词：仅 prompt，产出文本 ──
  if (opts.tool === "lyrics") {
    const desc = (opts.prompt ?? "").trim();
    if (!desc) throw new Error("请先填写歌词主题 / 描述");
    const taskId = await poyoSubmit(wire, { prompt: desc.slice(0, 2000) });
    const file = await pollPoyoToolDetail(taskId);
    const text = typeof file.text === "string" ? file.text : "";
    if (!text) throw new Error("[CHARGED] 写歌词完成但响应未含歌词文本（积分已扣，请勿重试）");
    return { kind: "lyrics", lyrics: text, title: typeof file.title === "string" ? file.title : undefined };
  }

  // ── #153 原生续写：对本站已生成的 Suno 曲目用 audio_id 续写（Simple 模式：仅 audio_id + mv）──
  // 文档 extend-music：Simple(`default_param_flag:false`) 仅需 audio_id + mv，自动续写。
  if (opts.tool === "extend_native") {
    const audioId = (opts.audioId ?? "").trim();
    if (!audioId) throw new Error("该音频缺少 audio_id，无法原生续写（请用「本站生成的 Suno 曲目」）");
    const input: Record<string, unknown> = { audio_id: audioId, mv: clampMv(opts.mv), default_param_flag: false };
    if ((opts.prompt ?? "").trim()) input.prompt = (opts.prompt as string).trim().slice(0, 500);
    const taskId = await poyoSubmit(POYO_MUSIC_TOOL_WIRE.extend_native, input);
    const file = await pollPoyoToolDetail(taskId);
    const upstream = file.audio_url;
    if (typeof upstream !== "string" || !upstream) throw new Error("[CHARGED] 原生续写完成但响应未含 audio_url（积分已扣，请勿重试）");
    const url = await persistAudioUrl(upstream);
    return {
      kind: "audio", url,
      duration: typeof file.duration === "number" ? file.duration : undefined,
      audioId: typeof file.audio_id === "string" ? file.audio_id : undefined,
      taskId,
    };
  }

  // 其余三个工具都需要源音频。
  const src = (opts.audioUrl ?? "").trim();
  if (!src) throw new Error("请先上传或连接一段源音频");
  const absUrl = await resolveToAbsoluteUrl(src);

  // ── 人声分离：audio_url + model_name + output_type，产出多轨 ──
  if (opts.tool === "sep_vocals") {
    const input: Record<string, unknown> = {
      audio_url: absUrl,
      model_name: opts.sepModel ?? "base",
      output_type: opts.sepOutput ?? "general",
    };
    const taskId = await poyoSubmit(wire, input);
    const file = await pollPoyoToolDetail(taskId);
    // vocal_removal 是 JSON 字符串：{vocals,bass,drums,piano,guitar,other}（视 output_type 而定）。
    let raw: Record<string, unknown> = {};
    if (typeof file.vocal_removal === "string") { try { raw = JSON.parse(file.vocal_removal); } catch { raw = {}; } }
    else if (file.vocal_removal && typeof file.vocal_removal === "object") raw = file.vocal_removal as Record<string, unknown>;
    const stems: Record<string, string> = {};
    for (const key of ["vocals", "bass", "drums", "piano", "guitar", "other"]) {
      const u = raw[key];
      if (typeof u === "string" && u) stems[key] = await persistAudioUrl(u);
    }
    if (Object.keys(stems).length === 0) throw new Error("[CHARGED] 人声分离完成但未返回任何音轨 URL（积分已扣，请勿重试）");
    return { kind: "stems", stems };
  }

  // ── 翻唱 / 续写：Suno 系，产出音频（走非自定义模式：只需 prompt）──
  const mv = clampMv(opts.mv);
  const instrumental = opts.instrumental ?? false;
  const desc = (opts.prompt ?? "").trim();
  const input: Record<string, unknown> = { upload_url: absUrl, mv, instrumental };
  if (opts.tool === "cover") {
    input.custom_mode = false;               // 非自定义：prompt = 转换目标描述（≤500）
    if (!desc) throw new Error("请描述想要的翻唱风格");
    input.prompt = desc.slice(0, 500);
  } else { // extend
    input.default_param_flag = false;        // 非自定义：仅 continue_at 必填，prompt 可选
    input.continue_at = Number.isFinite(opts.continueAt) ? Math.max(0, opts.continueAt as number) : 0;
    if (desc) input.prompt = desc.slice(0, 500);
  }
  if (opts.negativeTags) input.negative_tags = opts.negativeTags;
  if (opts.vocalGender) input.vocal_gender = opts.vocalGender;
  if (opts.styleWeight !== undefined) input.style_weight = opts.styleWeight;
  const taskId = await poyoSubmit(wire, input);
  const file = await pollPoyoToolDetail(taskId);
  const upstream = file.audio_url;
  if (typeof upstream !== "string" || !upstream) throw new Error("[CHARGED] 音频工具完成但响应未含 audio_url（积分已扣，请勿重试）");
  const url = await persistAudioUrl(upstream);
  return { kind: "audio", url, duration: typeof file.duration === "number" ? file.duration : undefined };
}

/**
 * Poyo ElevenLabs V3 TTS. The live model id is `elevenlabs-v3-tts` (this IS the
 * Poyo wire value — no internal→wire mapping needed). Spec:
 * POST /api/generate/submit with { model, input: { text, voice?, stability?,
 * timestamps?, language_code?, apply_text_normalization? } }. There is NO speed
 * parameter for this model. Results poll the standard status endpoint.
 */
export type PoyoTTSModel =
  | "elevenlabs-v3-tts"
  | "elevenlabs-tts-turbo-2-5"   // #151：与 v3 同参数族（voice/stability/timestamps/language_code/apply_text_normalization）
  | "gemini-3-1-flash-tts"       // #151：仅 text/voice（+style_instructions/temperature，UI 暂不暴露）；
                                 //       language_code 为「Chinese Mandarin (China)」式长名枚举，与 ISO 码不通，不透传
  | "xai-tts-1";                 // #151：仅 text/voice（voice 枚举 eve/ara/rex/sal/leo）；language_code 默认 auto

// #151 各 TTS 模型 input 允许键（官方 api-manual/music-series 各页 schema）。
// 严禁把 v3 的键透传给 gemini/xai——上游 schema 不同，多发键可能 400。
const POYO_TTS_INPUT_KEYS: Record<PoyoTTSModel, ReadonlySet<string>> = {
  "elevenlabs-v3-tts":        new Set(["voice", "stability", "timestamps", "language_code", "apply_text_normalization"]),
  "elevenlabs-tts-turbo-2-5": new Set(["voice", "stability", "timestamps", "language_code", "apply_text_normalization"]),
  "gemini-3-1-flash-tts":     new Set(["voice"]),
  "xai-tts-1":                new Set(["voice"]),
};

export interface SubmitPoyoTTSOptions {
  model: PoyoTTSModel;
  text: string;                                  // 1–5000 chars
  voice?: string;                                // voice name, default "Rachel"
  stability?: number;                            // 0–1
  timestamps?: boolean;                          // true → extra timestamps.json file
  languageCode?: string;                         // ISO 639-1
  applyTextNormalization?: "auto" | "on" | "off";
}

export async function submitAndPollPoyoTTS(opts: SubmitPoyoTTSOptions): Promise<PoyoMusicResult> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");

  // input has additionalProperties:false — only send keys we have values for,
  // AND only keys this model's schema accepts (#151 POYO_TTS_INPUT_KEYS).
  const allowed = POYO_TTS_INPUT_KEYS[opts.model] ?? POYO_TTS_INPUT_KEYS["elevenlabs-v3-tts"];
  const input: Record<string, unknown> = { text: opts.text };
  if (opts.voice && allowed.has("voice")) input.voice = opts.voice;
  if (opts.stability !== undefined && allowed.has("stability")) input.stability = opts.stability;
  if (opts.timestamps !== undefined && allowed.has("timestamps")) input.timestamps = opts.timestamps;
  if (opts.languageCode && allowed.has("language_code")) input.language_code = opts.languageCode;
  if (opts.applyTextNormalization && allowed.has("apply_text_normalization")) input.apply_text_normalization = opts.applyTextNormalization;

  const submitRes = await fetch(`${POYO_BASE}/api/generate/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.poyoApiKey}`,
    },
    body: JSON.stringify({ model: opts.model, input }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    if (submitRes.status === 404) {
      throw new Error(`Poyo TTS 提交失败 (404): 模型 "${opts.model}" 在 Poyo 平台不存在或已下架。原始响应: ${text}`);
    }
    throw new Error(`Poyo TTS 提交失败 (${submitRes.status}, 模型 ${opts.model}): ${text}`);
  }

  const submitData = (await submitRes.json()) as { code?: number; message?: string; data?: { task_id?: string } };
  // Poyo's success code is either 0 or 200 (HTTP-style). Anything else = error.
  if (submitData.code !== undefined && submitData.code !== 0 && submitData.code !== 200) {
    throw new Error(`Poyo TTS submit error (code ${submitData.code}): ${submitData.message ?? JSON.stringify(submitData)}`);
  }
  const taskId = submitData.data?.task_id;
  if (!taskId) throw new Error(`Poyo TTS submit: no task_id returned. Response: ${JSON.stringify(submitData)}`);

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const statusRes = await fetch(`${POYO_BASE}/api/generate/status/${taskId}`, {
      headers: { Authorization: `Bearer ${ENV.poyoApiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!statusRes.ok) continue;

    const statusData = (await statusRes.json()) as {
      code: number;
      data: {
        status: string;
        files?: Array<{ file_url: string; file_type: string; duration?: number }>;
        error_message?: string;
      };
    };
    const d = statusData.data;
    if (!d) continue;

    if (d.status === "finished") {
      // Select by file_type — with timestamps enabled the array also contains a
      // file_type:"other" (timestamps.json), so files[0] is not reliably audio.
      const audioFile = d.files?.find((f) => f.file_type === "audio") ?? d.files?.[0];
      if (!audioFile?.file_url) throw new Error("[CHARGED] Poyo TTS 生成完成但响应未含 audio file URL（积分已扣，请勿重试）");
      const tsFile = d.files?.find((f) => f.file_type === "other");

      const persist = await isAudioPersistenceEnabled();

      // Resolve the audio URL (re-host when persistence is on, else upstream).
      let audioUrl = audioFile.file_url;
      if (persist) {
        try {
          const audioRes = await fetch(audioFile.file_url);
          if (audioRes.ok) {
            const buf = Buffer.from(await audioRes.arrayBuffer());
            const mimeType = audioRes.headers.get("content-type") ?? "audio/mpeg";
            const ext = mimeType.includes("wav") ? "wav" : "mp3";
            const { url } = await storagePut(`generated/tts-${Date.now()}.${ext}`, buf, mimeType);
            audioUrl = url;
          }
        } catch { /* fall through to upstream url */ }
      }

      // Resolve the timestamps URL the same way (re-host when persistence is on).
      let timestampsUrl: string | undefined = tsFile?.file_url;
      if (persist && tsFile?.file_url) {
        try {
          const tsRes = await fetch(tsFile.file_url);
          if (tsRes.ok) {
            const buf = Buffer.from(await tsRes.arrayBuffer());
            const { url } = await storagePut(`generated/tts-${Date.now()}-timestamps.json`, buf, "application/json");
            timestampsUrl = url;
          }
        } catch { /* fall through to upstream url */ }
      }

      return { url: audioUrl, duration: audioFile.duration, timestampsUrl };
    }

    if (IN_PROGRESS_STATUSES.has(d.status)) {
      continue;
    }
    // Any other status (failed / cancelled / expired / unknown) is terminal — surface immediately
    throw new Error(`Poyo TTS status="${d.status}": ${d.error_message ?? "no detail"}`);
  }

  throw new Error("Poyo TTS generation timed out");
}
