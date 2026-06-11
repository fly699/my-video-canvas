import { storagePut } from "../storage";
import { isAudioPersistenceEnabled } from "./storageConfig";
import { KIE_BASE_URL } from "./kie";
import { parseKieJobStatus } from "./kieVideo";

// ── kie.ai ElevenLabs Sound Effects ──────────────────────────────────────────
//
// 文本→音效走统一 jobs API（POST /api/v1/jobs/createTask，轮询
// GET /api/v1/jobs/recordInfo?taskId=），与 kieTTS.ts 同形。
// input schema 按用户提供的官方文档（operationId: elevenlabs-sound-effect-v2）逐字对齐：
//   text(必填, ≤5000 字符) / duration_seconds(0.5–22 秒, 步进 0.1, 缺省=按描述自动) /
//   loop(默认 false, 无缝循环) / prompt_influence(0–1, 默认 0.3, 步进 0.01) /
//   output_format(默认 mp3_44100_128) / callBackUrl(可选, 本集成用轮询不用回调)。

export const KIE_SFX_MODEL = "elevenlabs/sound-effect-v2";

export interface KieSFXOptions {
  apiKey: string;
  /** 音效文本描述（input.text，≤5000 字符）。 */
  text: string;
  /** 0.5–22 秒（步进 0.1）；缺省=模型按描述自动决定。 */
  durationSeconds?: number;
  /** 生成可无缝循环的音效（氛围声）。 */
  loop?: boolean;
  /** 0–1：越高越严格按描述生成（上游默认 0.3）。 */
  promptInfluence?: number;
}
export interface KieSFXResult { url: string; duration?: number }

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 60; // ~2.5 min

async function persistAudioUrl(upstreamUrl: string): Promise<string> {
  if (!(await isAudioPersistenceEnabled())) return upstreamUrl;
  try {
    const r = await fetch(upstreamUrl);
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get("content-type") ?? "audio/mpeg";
      const ext = mime.includes("wav") ? "wav" : "mp3";
      const { url } = await storagePut(`generated/sfx-${Date.now()}.${ext}`, buf, mime);
      return url;
    }
  } catch { /* fall through to the kie URL (14-day TTL) */ }
  return upstreamUrl;
}

/** Submit an ElevenLabs sound-effect job and poll until the audio is ready. */
export async function submitAndPollKieSFX(opts: KieSFXOptions): Promise<KieSFXResult> {
  const input: Record<string, unknown> = { text: opts.text };
  // 0.5–22 夹取并对齐 0.1 步进
  if (opts.durationSeconds != null) input.duration_seconds = Math.round(Math.min(22, Math.max(0.5, opts.durationSeconds)) * 10) / 10;
  if (opts.loop != null) input.loop = opts.loop;
  if (opts.promptInfluence != null) input.prompt_influence = Math.min(1, Math.max(0, opts.promptInfluence));
  const submitRes = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({ model: KIE_SFX_MODEL, input }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    throw new Error(`kie 音效提交失败 (${submitRes.status}): ${text.slice(0, 300)}`);
  }
  const submit = (await submitRes.json()) as { code?: number; msg?: string; data?: { taskId?: string } };
  if (submit.code !== 200 || !submit.data?.taskId) {
    throw new Error(`kie 音效提交返回错误 (code ${submit.code}): ${submit.msg ?? ""}`);
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
      throw new Error(`kie 音效状态查询失败 (${res.status})`);
    }
    const body = (await res.json()) as { code?: number; data?: Record<string, unknown> };
    const d = body.data;
    if (!d) continue;
    // 多形态解析（与图像/视频/TTS 共用）：见 parseKieJobStatus 注释。
    const st = parseKieJobStatus(d, "kie_sfx", taskId);
    if (st.status === "finished") {
      const urls = st.resultVideoUrls ?? [];
      if (!urls.length) throw new Error("[CHARGED] kie 音效已生成但未返回 URL（积分可能已扣，请勿重试）");
      return { url: await persistAudioUrl(urls[0]), duration: input.duration_seconds as number | undefined };
    }
    if (st.status === "failed") {
      throw new Error(`kie 音效生成失败：${st.errorMessage ?? "未知错误"}`);
    }
  }
  throw new Error("kie 音效生成超时");
}
