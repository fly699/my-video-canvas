/**
 * Kie 文件流上传 —— #234 通用暂存通道的 Kie 实现（与 poyoUpload 同构）。
 * 把参考图/视频临时暂存到 Kie 文件服务换取公网 URL，供 AI 模型读取。
 *
 * 官方条款（docs/kie-api.md · File Upload API Quickstart / File Stream Upload）：
 *   - 端点：POST https://kieai.redpandaai.co/api/file-stream-upload（multipart：file / uploadPath / fileName）
 *   - 免费；文件保存 24 小时后自动删除（暂存复用缓存 TTL 必须 < 24h）；
 *   - 通用文件存储，未限定 MIME 类型；流式方式官方建议大文件走此路，保守限 100MB；
 *   - 上传接口未公布专项频率条款；账号级为「每 10 秒 20 个新生成请求」——这里按
 *     10 次/10 秒滑动窗口排队错峰（复用 poyoUpload 的纯窗口函数），宁可等不丢图。
 *   - 响应：{ success, code:200, msg, data: { fileUrl, downloadUrl, expiresAt, … } }。
 */
import { ENV } from "./env";
import { computeThrottleWaitMs } from "./poyoUpload";

const KIE_UPLOAD_BASE = "https://kieai.redpandaai.co";
const MAX_BYTES = 100 * 1024 * 1024;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 10_000;
const _stamps: number[] = [];
let _queue: Promise<void> = Promise.resolve();

async function acquireUploadSlot(): Promise<void> {
  const prev = _queue;
  let release!: () => void;
  _queue = new Promise<void>((r) => { release = r; });
  await prev;
  try {
    for (;;) {
      const wait = computeThrottleWaitMs(_stamps, Date.now(), RATE_LIMIT, RATE_WINDOW_MS);
      if (wait <= 0) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    while (_stamps.length && Date.now() - _stamps[0] >= RATE_WINDOW_MS) _stamps.shift();
    _stamps.push(Date.now());
  } finally {
    release();
  }
}

export async function uploadStreamToKie(
  data: Buffer | Uint8Array,
  fileName: string,
  contentType: string,
): Promise<string> {
  if (!ENV.kieApiKey) throw new Error("KIE_API_KEY is not configured");
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`Kie 流式上传超出 100MB 上限（当前 ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB）`);
  }

  await acquireUploadSlot();

  const form = new FormData();
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  form.append("file", new Blob([bytes], { type: contentType }), fileName);
  form.append("uploadPath", "canvas-refs");
  form.append("fileName", fileName);

  const res = await fetch(`${KIE_UPLOAD_BASE}/api/file-stream-upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ENV.kieApiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) throw new Error(`Kie 流式上传触发限流 (429)，请稍后重试。${text}`);
    throw new Error(`Kie 流式上传失败 (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { success?: boolean; code?: number; msg?: string; data?: { fileUrl?: string; downloadUrl?: string } };
  if (body.code !== undefined && body.code !== 200 && body.code !== 0) {
    throw new Error(`Kie 流式上传返回错误 (code ${body.code}): ${body.msg ?? ""}`);
  }
  const url = body.data?.fileUrl ?? body.data?.downloadUrl;
  if (!url) throw new Error("Kie 流式上传完成但响应未含 fileUrl");
  return url;
}
