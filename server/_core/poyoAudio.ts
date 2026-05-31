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
const IN_PROGRESS_STATUSES = new Set(["queued", "pending", "processing", "running", "submitted", "in_progress", "started"]);

// User-facing music model identifiers. Internally all Suno variants share the
// `generate-music` endpoint and differ only by an `input.mv` value (V3.5 / V4 /
// V4.5 / V4.5PLUS / V5) — Poyo's API design is "endpoint + sub-params", not
// "one model id per version". Mureka / MiniMax / ElevenLabs endpoints are not
// yet confirmed in public docs; router rejects them until verified.
export type PoyoMusicModel =
  | "suno-v3.5"
  | "suno-v4"
  | "suno-v4.5"
  | "suno-v4.5plus"
  | "suno-v5"
  // Below: legacy ids kept for backward compat with saved nodes; router will
  // reject with clear migration message until proper Poyo endpoint names are
  // confirmed (see openaiTTS commit for the same pattern).
  | "mureka"
  | "minimax-music-02";

const SUNO_MV_MAP: Record<string, string> = {
  "suno-v3.5":     "V3.5",
  "suno-v4":       "V4",
  "suno-v4.5":     "V4.5",
  "suno-v4.5plus": "V4.5PLUS",
  "suno-v5":       "V5",
};

export interface SubmitPoyoMusicOptions {
  model: PoyoMusicModel;
  prompt: string;
  style?: string;
  durationSeconds?: number;
  instrumental?: boolean;
  negativePrompt?: string;
}

export interface PoyoMusicResult {
  url: string;
  duration?: number;
  // ElevenLabs V3 TTS with timestamps enabled returns a second `timestamps.json`
  // file (file_type:"other"). Surfaced here so the TTS path can hand back a
  // download URL. The music path never sets this.
  timestampsUrl?: string;
}

export async function submitAndPollPoyoMusic(
  opts: SubmitPoyoMusicOptions,
): Promise<PoyoMusicResult> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");

  // Suno models → generate-music endpoint + mv parameter
  const mv = SUNO_MV_MAP[opts.model];
  if (!mv) {
    // Mureka / MiniMax / ElevenLabs — Poyo endpoint names not yet confirmed in docs
    throw new Error(
      `Poyo 模型 "${opts.model}" 暂未接入（端点名待 Poyo 官方文档确认）。当前可用：Suno V3.5 / V4 / V4.5 / V4.5PLUS / V5。`
    );
  }

  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    mv,
    custom_mode: false,
  };
  if (opts.style) input.style = opts.style;
  if (opts.durationSeconds !== undefined) input.duration_seconds = opts.durationSeconds;
  if (opts.instrumental !== undefined) input.instrumental = opts.instrumental;
  if (opts.negativePrompt) input.negative_tags = opts.negativePrompt;

  const submitRes = await fetch(`${POYO_BASE}/api/generate/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.poyoApiKey}`,
    },
    body: JSON.stringify({ model: "generate-music", input }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    if (submitRes.status === 404) {
      throw new Error(`Poyo 音乐生成失败 (404): generate-music 端点不存在或已下架，请联系 Poyo 客服。原始响应: ${text}`);
    }
    throw new Error(`Poyo 音乐生成失败 (${submitRes.status}, mv=${mv}): ${text}`);
  }

  const submitData = (await submitRes.json()) as { code?: number; message?: string; data?: { task_id?: string } };
  // Poyo's success code is either 0 or 200 (HTTP-style). Anything else = error.
  if (submitData.code !== undefined && submitData.code !== 0 && submitData.code !== 200) {
    throw new Error(`Poyo audio submit error (code ${submitData.code}): ${submitData.message ?? JSON.stringify(submitData)}`);
  }
  const taskId = submitData.data?.task_id;
  if (!taskId) throw new Error(`Poyo audio submit: no task_id returned. Response: ${JSON.stringify(submitData)}`);

  // Poll until finished
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
      const file = d.files?.[0];
      if (!file?.file_url) throw new Error("[CHARGED] Poyo 音频生成完成但响应未含 file URL（积分已扣，请勿重试）");

      // Admin-controlled toggle: when audio persistence is disabled,
      // skip the storagePut step and return the upstream URL (24h TTL).
      if (!(await isAudioPersistenceEnabled())) {
        return { url: file.file_url, duration: file.duration };
      }
      // Download and re-upload to own storage for persistence
      try {
        const audioRes = await fetch(file.file_url);
        if (audioRes.ok) {
          const buf = Buffer.from(await audioRes.arrayBuffer());
          const mimeType = audioRes.headers.get("content-type") ?? "audio/mpeg";
          const ext = mimeType.includes("wav") ? "wav" : "mp3";
          const { url } = await storagePut(`generated/audio-${Date.now()}.${ext}`, buf, mimeType);
          return { url, duration: file.duration };
        }
      } catch { /* fall through */ }
      return { url: file.file_url, duration: file.duration };
    }

    if (IN_PROGRESS_STATUSES.has(d.status)) {
      continue;
    }
    // Any other status (failed / cancelled / expired / unknown) is terminal — surface immediately
    throw new Error(`Poyo audio status="${d.status}": ${d.error_message ?? "no detail"}`);
  }

  throw new Error("Poyo audio generation timed out");
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
