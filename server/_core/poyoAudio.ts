import { ENV } from "./env";
import { storagePut } from "../storage";

const POYO_BASE = "https://api.poyo.ai";
const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 60; // 4 min max

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
  if (opts.durationSeconds) input.duration_seconds = opts.durationSeconds;
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

  const submitData = (await submitRes.json()) as { code: number; data: { task_id: string } };
  const taskId = submitData.data?.task_id;
  if (!taskId) throw new Error("Poyo audio submit: no task_id returned");

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

    if (d.status === "finished") {
      const file = d.files?.[0];
      if (!file?.file_url) throw new Error("Poyo audio: finished but no file URL");

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

    if (d.status === "failed") {
      throw new Error(`Poyo audio generation failed: ${d.error_message ?? "unknown error"}`);
    }
  }

  throw new Error("Poyo audio generation timed out");
}

export type PoyoTTSModel = "openai_tts_hd" | "openai_tts" | "elevenlabs_v3" | "cosyvoice_2";

export interface SubmitPoyoTTSOptions {
  model: PoyoTTSModel;
  text: string;
  voice?: string;
  speed?: number;
}

export async function submitAndPollPoyoTTS(opts: SubmitPoyoTTSOptions): Promise<PoyoMusicResult> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");

  const input: Record<string, unknown> = { text: opts.text };
  if (opts.voice) input.voice = opts.voice;
  if (opts.speed !== undefined) input.speed = opts.speed;

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
    throw new Error(`Poyo TTS submit failed (${submitRes.status}): ${text}`);
  }

  const submitData = (await submitRes.json()) as { code: number; data: { task_id: string } };
  const taskId = submitData.data?.task_id;
  if (!taskId) throw new Error("Poyo TTS submit: no task_id returned");

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

    if (d.status === "failed") {
      throw new Error(`Poyo TTS generation failed: ${d.error_message ?? "unknown error"}`);
    }
  }

  throw new Error("Poyo TTS generation timed out");
}
