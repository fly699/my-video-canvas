import { storagePut } from "../storage";
import { isAudioPersistenceEnabled } from "./storageConfig";
import { KIE_BASE_URL } from "./kie";

// ── kie.ai Suno music ─────────────────────────────────────────────────────────
//
// Suno has its OWN endpoints (NOT the unified jobs API): create at
// POST /api/v1/generate, poll GET /api/v1/generate/record-info?taskId=.
// Synchronous submit-and-poll within the request, mirroring submitAndPollPoyoMusic
// (the audioGen.generateMusic router blocks until done — there is no async poller
// for audio). The resolved kie key is passed in by the router (resolveKieKey);
// this module never touches the whitelist or env.
//
// All field names / model enums are verbatim from docs/kie-api.md (Suno Quickstart
// + Generate Music); credit ≈ 12 点/次 (docs/kie-pricing.md, "Suno").

export interface KieMusicSpec { model: string; label: string }
// UI value (kie_suno_*) → kie `model` enum.
export const KIE_MUSIC_MODELS: Record<string, KieMusicSpec> = {
  kie_suno_v5_5:     { model: "V5_5", label: "Suno v5.5（kie）" },
  kie_suno_v5:       { model: "V5", label: "Suno v5（kie）" },
  kie_suno_v4_5plus: { model: "V4_5PLUS", label: "Suno v4.5 PLUS（kie）" },
  kie_suno_v4_5:     { model: "V4_5", label: "Suno v4.5（kie）" },
  kie_suno_v4:       { model: "V4", label: "Suno v4（kie）" },
  kie_suno_v3_5:     { model: "V3_5", label: "Suno v3.5（kie）" },
};

export function isKieMusicModel(model?: string): boolean {
  return !!model && model in KIE_MUSIC_MODELS;
}

export interface KieMusicResult { url: string; duration?: number; imageUrl?: string }

export interface KieMusicOptions {
  model: string;        // UI value (kie_suno_*)
  apiKey: string;
  prompt: string;
  style?: string;
  title?: string;
  instrumental?: boolean;
  negativeTags?: string;
}

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 70; // ~3.5 min — Suno is typically <2 min

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

interface SunoTrack { audioUrl?: string; streamAudioUrl?: string; duration?: number; imageUrl?: string }

/** Submit a Suno job and poll until a track is ready. Returns the first track. */
export async function submitAndPollKieMusic(opts: KieMusicOptions): Promise<KieMusicResult> {
  const spec = KIE_MUSIC_MODELS[opts.model];
  if (!spec) throw new Error(`未知 kie 音乐模型：${opts.model}`);

  // customMode=true unlocks style/title/negativeTags; otherwise it's a plain
  // description-driven generation (prompt only). Switch into custom mode only when
  // the user supplied a style, supplying a title (Suno requires one in custom mode).
  const customMode = !!opts.style?.trim();
  const body: Record<string, unknown> = {
    model: spec.model,
    customMode,
    instrumental: !!opts.instrumental,
    prompt: opts.prompt,
  };
  if (customMode) {
    body.style = opts.style;
    body.title = (opts.title?.trim() || opts.prompt.trim().slice(0, 40) || "Untitled");
    if (opts.negativeTags?.trim()) body.negativeTags = opts.negativeTags;
  }

  const submitRes = await fetch(`${KIE_BASE_URL}/api/v1/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    throw new Error(`kie 音乐提交失败 (${submitRes.status}): ${text.slice(0, 300)}`);
  }
  const submit = (await submitRes.json()) as { code?: number; msg?: string; data?: { taskId?: string } };
  if (submit.code !== 200 || !submit.data?.taskId) {
    throw new Error(`kie 音乐提交返回错误 (code ${submit.code}): ${submit.msg ?? ""}`);
  }
  const taskId = submit.data.taskId;

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${KIE_BASE_URL}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) continue; // transient
      throw new Error(`kie 音乐状态查询失败 (${res.status})`);
    }
    const body2 = (await res.json()) as {
      code?: number;
      data?: { status?: string; errorMessage?: string; response?: { sunoData?: SunoTrack[] } };
    };
    const d = body2.data;
    if (!d) continue;
    const status = d.status ?? "";
    if (/FAIL|ERROR|EXCEPTION/i.test(status)) {
      throw new Error(`kie 音乐生成失败：${d.errorMessage || status}`);
    }
    // FIRST_SUCCESS = one track ready; SUCCESS = all ready. Take the first track
    // that actually has an audioUrl.
    const track = (d.response?.sunoData ?? []).find((t) => t.audioUrl);
    if (track?.audioUrl && (status === "SUCCESS" || status === "FIRST_SUCCESS")) {
      const url = await persistAudioUrl(track.audioUrl);
      return { url, duration: track.duration, imageUrl: track.imageUrl };
    }
  }
  throw new Error("kie 音乐生成超时");
}
