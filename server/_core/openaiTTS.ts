/**
 * OpenAI Text-to-Speech direct integration.
 *
 * Why direct (not via Forge proxy or Poyo): Forge only proxies Whisper
 * transcription (audio → text), not the reverse. Poyo platform doesn't
 * offer TTS at all (only music generation). OpenAI's /v1/audio/speech
 * is a synchronous endpoint returning raw mp3 bytes — no polling needed.
 *
 * Persistence note: unlike Poyo/Higgsfield video which return a CDN URL
 * we can optionally re-host, OpenAI TTS gives raw bytes only. There's no
 * upstream URL to fall back to, so the admin "持久化音频" toggle is
 * forced ON for this path — see check below.
 */
import { ENV } from "./env";
import { storagePut } from "../storage";
import { isAudioPersistenceEnabled } from "./storageConfig";

export type OpenAITTSModel =
  | "openai_tts_real"        // tts-1
  | "openai_tts_hd_real"     // tts-1-hd
  | "openai_gpt4o_mini_tts"; // gpt-4o-mini-tts

const MODEL_MAP: Record<OpenAITTSModel, string> = {
  openai_tts_real:        "tts-1",
  openai_tts_hd_real:     "tts-1-hd",
  openai_gpt4o_mini_tts:  "gpt-4o-mini-tts",
};

// Voices supported by tts-1 / tts-1-hd / gpt-4o-mini-tts.
// gpt-4o-mini-tts additionally supports ash / coral / sage; we accept any
// of these strings and let OpenAI reject invalid ones for that model.
export const OPENAI_TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "ash", "coral", "sage"] as const;

// Hard cap on response body bytes. OpenAI TTS normally returns ~30 KB/s of
// mp3, so even ~10 min of audio is <20 MB. 50 MB is well beyond any legit
// response and protects us from a runaway / MITM-injected body draining
// memory before we notice (no Content-Length is sent by the API).
const MAX_TTS_BYTES = 50 * 1024 * 1024;

export interface SynthesizeOpenAITTSOptions {
  model: OpenAITTSModel;
  text: string;
  voice?: string;     // default "alloy"
  speed?: number;     // 0.25 - 4.0
}

export interface SynthesizeOpenAITTSResult {
  url: string;        // /manus-storage/... (persistent)
  duration?: number;  // unknown — OpenAI doesn't return duration
}

export async function synthesizeOpenAITTS(opts: SynthesizeOpenAITTSOptions): Promise<SynthesizeOpenAITTSResult> {
  if (!ENV.openaiApiKey) {
    throw new Error("OPENAI_API_KEY 未配置 — TTS 功能需要 OpenAI API key。在 .env 中设置 OPENAI_API_KEY=sk-...");
  }
  // OpenAI TTS produces raw mp3 bytes with no upstream URL — we cannot fall
  // back to a "use the original URL" mode when persistence is off. Refuse
  // upfront rather than synthesize bytes that have nowhere to go.
  if (!(await isAudioPersistenceEnabled())) {
    throw new Error(
      "OpenAI TTS 必须开启音频持久化（管理后台 → 存储设置）。OpenAI 直接返回 mp3 字节流，无 CDN URL 可降级。"
    );
  }

  const apiModel = MODEL_MAP[opts.model];
  if (!apiModel) {
    throw new Error(`未知的 OpenAI TTS 模型: ${opts.model}`);
  }

  const body: Record<string, unknown> = {
    model: apiModel,
    input: opts.text,
    voice: opts.voice?.trim() || "alloy",
    response_format: "mp3",
  };
  if (opts.speed !== undefined && opts.speed > 0) {
    // OpenAI accepts 0.25–4.0; clamp to be safe.
    body.speed = Math.max(0.25, Math.min(4.0, opts.speed));
  }

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ENV.openaiApiKey}`,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (res.status === 401) {
      throw new Error(`OpenAI 鉴权失败 (401): 检查 OPENAI_API_KEY 是否有效。响应: ${errText.slice(0, 300)}`);
    }
    if (res.status === 404) {
      throw new Error(`OpenAI TTS 模型 "${apiModel}" 不存在或未对当前账户开放 (404)。响应: ${errText.slice(0, 300)}`);
    }
    if (res.status === 429) {
      throw new Error(`OpenAI 速率限制或配额耗尽 (429)。响应: ${errText.slice(0, 300)}`);
    }
    throw new Error(`OpenAI TTS 失败 (${res.status}, 模型 ${apiModel}): ${errText.slice(0, 500)}`);
  }

  // Stream-read with byte cap so a runaway body can't OOM the process.
  if (!res.body) {
    throw new Error("OpenAI TTS 响应无 body");
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { completed = true; break; }
      total += value.byteLength;
      if (total > MAX_TTS_BYTES) {
        throw new Error(`OpenAI TTS 响应超出 ${MAX_TTS_BYTES} 字节上限，已中止`);
      }
      chunks.push(value);
    }
  } finally {
    // Cancel on any non-completion exit (byte-cap, network error) so the
    // underlying HTTP connection is released back to the pool. Without
    // this, generic stream errors leave the socket held until GC.
    if (!completed) {
      try { await reader.cancel(); } catch { /* ignore */ }
    }
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  const buf = Buffer.concat(chunks, total);
  console.log(`[OpenAI TTS] synthesized ${buf.length} bytes (model=${apiModel}, voice=${body.voice}, text=${opts.text.length}ch)`);

  const { url } = await storagePut(
    `generated/openai-tts-${Date.now()}.mp3`,
    buf,
    "audio/mpeg",
  );
  return { url };
}
