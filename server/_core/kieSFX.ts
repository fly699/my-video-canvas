import { storagePut } from "../storage";
import { isAudioPersistenceEnabled } from "./storageConfig";
import { KIE_BASE_URL } from "./kie";

// ── kie.ai ElevenLabs Sound Effects ──────────────────────────────────────────
//
// 文本→音效走统一 jobs API（POST /api/v1/jobs/createTask，轮询
// GET /api/v1/jobs/recordInfo?taskId=），与 kieTTS.ts 同形。model 串来自
// docs/kie-api.md 的市场目录条目 `market/elevenlabs/sound-effect-v2`。
//
// 严格按文档口径：该模型的详情页在 docs/kie-api.md 中抓取失败（NotFound），
// 未给出 input schema——因此请求体只发文档对全部 elevenlabs 市场模型一致记载的
// `input.text`，不携带任何文档未载明的参数（时长等由上游按描述自动决定）。
// 若后续文档补全该页 schema，再按文档逐字添加参数。

export const KIE_SFX_MODEL = "elevenlabs/sound-effect-v2";

export interface KieSFXOptions {
  apiKey: string;
  /** 音效文本描述（送 input.text）。 */
  text: string;
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
  const submitRes = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({ model: KIE_SFX_MODEL, input: { text: opts.text } }),
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
    const body = (await res.json()) as {
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
      if (!urls.length) throw new Error("[CHARGED] kie 音效已生成但未返回 URL（积分可能已扣，请勿重试）");
      return { url: await persistAudioUrl(urls[0]) };
    }
    if (d.successFlag === 2 || d.successFlag === 3) {
      throw new Error(`kie 音效生成失败：${d.errorMessage ?? "未知错误"}`);
    }
  }
  throw new Error("kie 音效生成超时");
}
