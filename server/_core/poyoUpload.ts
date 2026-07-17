/**
 * Poyo stream-upload — temporarily stages a file on Poyo storage and returns a
 * PUBLIC URL. Used to hand reference images/videos to AI models when our own
 * MinIO/S3 isn't publicly reachable (S3_PUBLIC_ENDPOINT unset). Files are kept
 * ~72h (images) / 24h (videos) by Poyo — long enough for a generation request.
 *
 * Endpoint: POST https://api.poyo.ai/api/common/upload/stream (multipart/form-data)
 *   field `file` (binary) + optional `file_name`. Returns data.file_url.
 * Rate limit: 5 req/min per key. Image: JPEG/PNG/GIF/WebP. Video: MP4/WebM/MOV/AVI/MKV ≤100MB.
 */
import { ENV } from "./env";

const POYO_BASE = "https://api.poyo.ai";
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

// ── #232 官方限流自适应节流（5 次/分/Key）────────────────────────────────────
// 此前不做任何节流：批量运行（多镜头 × 多参考图）1 分钟内轻松超过 5 次 → 429 →
// 直接放弃回落 presign；而启用本 fallback 的部署恰恰是「本地存储不对公网开放」，
// presign 上游拉不到 → 参考图静默丢失。这里用滑动窗口把突发请求排队错峰：窗口满
// 时等到最早一次滚出 60s 再发，宁可慢几十秒也不丢参考图。
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const _stamps: number[] = [];
let _queue: Promise<void> = Promise.resolve();

/** 纯函数：给定已发时间戳窗口与当前时刻，算还需等待的毫秒数（0=可立即发）。单测用。 */
export function computeThrottleWaitMs(stamps: number[], now: number, limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS): number {
  const live = stamps.filter((t) => now - t < windowMs);
  if (live.length < limit) return 0;
  return windowMs - (now - live[live.length - limit]) + 250; // +250ms 余量防边界
}

async function acquireUploadSlot(): Promise<void> {
  // 串行化排队（并发调用按先来后到依次占坑），避免多个并发同时判定「有空位」齐发。
  const prev = _queue;
  let release!: () => void;
  _queue = new Promise<void>((r) => { release = r; });
  await prev;
  try {
    for (;;) {
      const wait = computeThrottleWaitMs(_stamps, Date.now());
      if (wait <= 0) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    while (_stamps.length && Date.now() - _stamps[0] >= RATE_WINDOW_MS) _stamps.shift();
    _stamps.push(Date.now());
  } finally {
    release();
  }
}

const ALLOWED_IMAGE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const ALLOWED_VIDEO = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/x-matroska"]);

export async function uploadStreamToPoyo(
  data: Buffer | Uint8Array,
  fileName: string,
  contentType: string,
): Promise<string> {
  if (!ENV.poyoApiKey) throw new Error("POYO_API_KEY is not configured");

  const ct = contentType.toLowerCase();
  const isImage = ALLOWED_IMAGE.has(ct);
  const isVideo = ALLOWED_VIDEO.has(ct);
  if (!isImage && !isVideo) {
    throw new Error(`Poyo 流式上传不支持的类型: ${contentType}（仅 JPEG/PNG/GIF/WebP 图片或 MP4/WebM/MOV/AVI/MKV 视频）`);
  }
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (isVideo && buf.byteLength > MAX_VIDEO_BYTES) {
    throw new Error(`Poyo 流式上传视频超出 100MB 上限（当前 ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB）`);
  }

  await acquireUploadSlot(); // 官方 5 次/分限流：排队错峰而非撞 429 丢参考图

  const form = new FormData();
  // Copy into a standalone Uint8Array so the Blob part is a plain ArrayBuffer view.
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  form.append("file", new Blob([bytes], { type: contentType }), fileName);
  form.append("file_name", fileName);

  const res = await fetch(`${POYO_BASE}/api/common/upload/stream`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ENV.poyoApiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) throw new Error(`Poyo 流式上传触发限流 (429，5次/分)，请稍后重试。${text}`);
    throw new Error(`Poyo 流式上传失败 (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { code?: number; message?: string; data?: { file_url?: string; download_url?: string } };
  if (body.code !== undefined && body.code !== 0 && body.code !== 200) {
    throw new Error(`Poyo 流式上传返回错误 (code ${body.code}): ${body.message ?? ""}`);
  }
  const url = body.data?.file_url ?? body.data?.download_url;
  if (!url) throw new Error("Poyo 流式上传完成但响应未含 file_url");
  return url;
}
