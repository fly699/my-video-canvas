import { storagePut } from "../storage";
import { isAudioPersistenceEnabled } from "./storageConfig";
import { KIE_BASE_URL } from "./kie";

// ── kie.ai ElevenLabs TTS ─────────────────────────────────────────────────────
//
// ElevenLabs 文本转语音走统一 jobs API（POST /api/v1/jobs/createTask，轮询
// GET /api/v1/jobs/recordInfo?taskId=），与 kie 图像/视频同形：成功时
// data.successFlag===1，音频 URL 在 data.response.result_urls[0]。同步 submit-and-poll
// （audioGen 路由阻塞至完成，音频无后台 poller），镜像 kieMusic.ts。字段名/model 串
// 逐字对照 docs/kie-api.md，价格见 docs/kie-pricing.md。
//
// 仅收录文本→语音：Turbo 2.5 / Multilingual v2（input.text+voice）、V3 对话
// （input.dialogue:[{text,voice}]，单说话人构造单元素）。Audio Isolation(音频→音频)
// 与 Sound Effect(文档未给 model 串) 暂不收录。

type KieTTSKind = "tts" | "dialogue";
export interface KieTTSSpec { model: string; label: string; kind: KieTTSKind }
// UI value (kie_elevenlabs_*) → kie `model` 串。
export const KIE_TTS_MODELS: Record<string, KieTTSSpec> = {
  kie_elevenlabs_tts:    { model: "elevenlabs/text-to-speech-turbo-2-5", label: "ElevenLabs TTS Turbo（kie）", kind: "tts" },
  kie_elevenlabs_tts_ml: { model: "elevenlabs/text-to-speech-multilingual-v2", label: "ElevenLabs 多语 v2（kie）", kind: "tts" },
  kie_elevenlabs_v3:     { model: "elevenlabs/text-to-dialogue-v3", label: "ElevenLabs V3 对话（kie）", kind: "dialogue" },
};

export function isKieTTS(model?: string): boolean {
  return !!model && model in KIE_TTS_MODELS;
}

// 文档示例默认音色（James）。voice 字段接受「预设名 或 voice id」——前端传 ElevenLabs
// 预设名（Rachel/Aria…）即可，留空时回退此默认 id。
const DEFAULT_VOICE = "EkK5I93UQWFDigLMpZcX";

export interface KieTTSOptions {
  model: string; apiKey: string;
  text: string; voice?: string;
  stability?: number; similarityBoost?: number; style?: number; speed?: number;
  languageCode?: string;
}
export interface KieTTSResult { url: string; duration?: number }

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 60; // ~2.5 min — TTS 通常很快

async function persistAudioUrl(upstreamUrl: string): Promise<string> {
  if (!(await isAudioPersistenceEnabled())) return upstreamUrl;
  try {
    const r = await fetch(upstreamUrl);
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get("content-type") ?? "audio/mpeg";
      const ext = mime.includes("wav") ? "wav" : "mp3";
      const { url } = await storagePut(`generated/audio-${Date.now()}.${ext}`, buf, mime);
      return url;
    }
  } catch { /* fall through to the kie URL (14-day TTL) */ }
  return upstreamUrl;
}

/** Submit an ElevenLabs TTS job and poll until the audio is ready. */
export async function submitAndPollKieTTS(opts: KieTTSOptions): Promise<KieTTSResult> {
  const spec = KIE_TTS_MODELS[opts.model];
  if (!spec) throw new Error(`未知 kie TTS 模型：${opts.model}`);
  const voice = opts.voice?.trim() || DEFAULT_VOICE;

  const input: Record<string, unknown> = spec.kind === "dialogue"
    ? { dialogue: [{ text: opts.text, voice }] }
    : {
        text: opts.text, voice,
        stability: opts.stability ?? 0.5,
        similarity_boost: opts.similarityBoost ?? 0.75,
        style: opts.style ?? 0,
        speed: opts.speed ?? 1,
        ...(opts.languageCode?.trim() ? { language_code: opts.languageCode.trim() } : {}),
      };

  const submitRes = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({ model: spec.model, input }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    throw new Error(`kie 配音提交失败 (${submitRes.status}): ${text.slice(0, 300)}`);
  }
  const submit = (await submitRes.json()) as { code?: number; msg?: string; data?: { taskId?: string } };
  if (submit.code !== 200 || !submit.data?.taskId) {
    throw new Error(`kie 配音提交返回错误 (code ${submit.code}): ${submit.msg ?? ""}`);
  }
  const taskId = submit.data.taskId;

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) continue; // transient
      throw new Error(`kie 配音状态查询失败 (${res.status})`);
    }
    const body = (await res.json()) as {
      code?: number;
      data?: { successFlag?: number; errorMessage?: string; response?: { result_urls?: string[]; resultUrls?: string[] | string } };
    };
    const d = body.data;
    if (!d) continue;
    if (d.successFlag === 1) {
      let urls = d.response?.result_urls ?? [];
      if (!urls.length && d.response?.resultUrls) {
        const ru = d.response.resultUrls;
        urls = Array.isArray(ru) ? ru : (() => { try { return JSON.parse(ru) as string[]; } catch { return []; } })();
      }
      if (!urls.length) throw new Error("[CHARGED] kie 配音已生成但未返回 URL（积分可能已扣，请勿重试）");
      return { url: await persistAudioUrl(urls[0]) };
    }
    if (d.successFlag === 2 || d.successFlag === 3) {
      throw new Error(`kie 配音生成失败：${d.errorMessage ?? "未知错误"}`);
    }
  }
  throw new Error("kie 配音生成超时");
}
