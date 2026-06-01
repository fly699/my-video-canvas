import { ENV } from "./env";
import { storagePut } from "../storage";
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
  | "minimax-music-2.6";

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
      data?: { status: string; files?: Array<{ file_url: string; file_type: string; duration?: number }>; error_message?: string };
    };
    const d = body.data;
    if (!d) continue;
    if (d.status === "finished") {
      const file = d.files?.find((f) => f.file_type === "audio") ?? d.files?.[0];
      if (!file?.file_url) throw new Error("[CHARGED] Poyo 音乐生成完成但响应未含 audio file URL（积分已扣，请勿重试）");
      const url = await persistAudioUrl(file.file_url);
      return { url, duration: file.duration };
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
    const input: Record<string, unknown> = { prompt: opts.prompt };
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

/**
 * Poyo ElevenLabs V3 TTS. The live model id is `elevenlabs-v3-tts` (this IS the
 * Poyo wire value — no internal→wire mapping needed). Spec:
 * POST /api/generate/submit with { model, input: { text, voice?, stability?,
 * timestamps?, language_code?, apply_text_normalization? } }. There is NO speed
 * parameter for this model. Results poll the standard status endpoint.
 */
export type PoyoTTSModel = "elevenlabs-v3-tts";

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

  // input has additionalProperties:false — only send keys we have values for.
  const input: Record<string, unknown> = { text: opts.text };
  if (opts.voice) input.voice = opts.voice;
  if (opts.stability !== undefined) input.stability = opts.stability;
  if (opts.timestamps !== undefined) input.timestamps = opts.timestamps;
  if (opts.languageCode) input.language_code = opts.languageCode;
  if (opts.applyTextNormalization) input.apply_text_normalization = opts.applyTextNormalization;

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
