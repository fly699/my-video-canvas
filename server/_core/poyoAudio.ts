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

export type PoyoMusicModel =
  | "suno-v4.5"
  | "suno-v5"
  | "mureka"
  | "minimax-music-02";

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
}

export async function submitAndPollPoyoMusic(
  opts: SubmitPoyoMusicOptions,
): Promise<PoyoMusicResult> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");

  const input: Record<string, unknown> = {
    prompt: opts.prompt,
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
    body: JSON.stringify({ model: opts.model, input }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    throw new Error(`Poyo audio submit failed (${submitRes.status}): ${text}`);
  }

  const submitData = (await submitRes.json()) as { code?: number; message?: string; data?: { task_id?: string } };
  if (submitData.code !== undefined && submitData.code !== 0) {
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
      if (!file?.file_url) throw new Error("Poyo audio: finished but no file URL");

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

export type PoyoTTSModel = "openai_tts_hd" | "openai_tts" | "elevenlabs_v3" | "cosyvoice_2";

// Map internal model IDs to Poyo API model names
const TTS_MODEL_MAP: Record<PoyoTTSModel, string> = {
  openai_tts_hd: "tts-1-hd",
  openai_tts:    "tts-1",
  elevenlabs_v3: "elevenlabs-v3",
  cosyvoice_2:   "cosyvoice-2",
};

export interface SubmitPoyoTTSOptions {
  model: PoyoTTSModel;
  text: string;
  voice?: string;
  speed?: number;
}

export async function submitAndPollPoyoTTS(opts: SubmitPoyoTTSOptions): Promise<PoyoMusicResult> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");

  const poyoModel = TTS_MODEL_MAP[opts.model] ?? opts.model;
  const input: Record<string, unknown> = { text: opts.text };
  if (opts.voice) input.voice = opts.voice;
  if (opts.speed !== undefined) input.speed = opts.speed;

  const submitRes = await fetch(`${POYO_BASE}/api/generate/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.poyoApiKey}`,
    },
    body: JSON.stringify({ model: poyoModel, input }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    throw new Error(`Poyo TTS submit failed (${submitRes.status}): ${text}`);
  }

  const submitData = (await submitRes.json()) as { code?: number; message?: string; data?: { task_id?: string } };
  if (submitData.code !== undefined && submitData.code !== 0) {
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
      const file = d.files?.[0];
      if (!file?.file_url) throw new Error("Poyo TTS: finished but no file URL");
      try {
        const audioRes = await fetch(file.file_url);
        if (audioRes.ok) {
          const buf = Buffer.from(await audioRes.arrayBuffer());
          const mimeType = audioRes.headers.get("content-type") ?? "audio/mpeg";
          const ext = mimeType.includes("wav") ? "wav" : "mp3";
          const { url } = await storagePut(`generated/tts-${Date.now()}.${ext}`, buf, mimeType);
          return { url, duration: file.duration };
        }
      } catch { /* fall through */ }
      return { url: file.file_url, duration: file.duration };
    }

    if (IN_PROGRESS_STATUSES.has(d.status)) {
      continue;
    }
    // Any other status (failed / cancelled / expired / unknown) is terminal — surface immediately
    throw new Error(`Poyo TTS status="${d.status}": ${d.error_message ?? "no detail"}`);
  }

  throw new Error("Poyo TTS generation timed out");
}
