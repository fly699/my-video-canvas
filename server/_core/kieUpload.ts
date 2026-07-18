/**
 * Kie 文件流上传 —— #234 通用暂存通道的 Kie 实现（与 poyoUpload 同构）。
 * 把参考图/视频临时暂存到 Kie 文件服务换取公网 URL，供 AI 模型读取。
 *
 * 官方条款（docs/kie-api.md · File Upload API Quickstart / File Stream Upload）：
 *   - 端点：POST https://kieai.redpandaai.co/api/file-stream-upload（multipart：file / uploadPath / fileName）
 *   - 免费；文件保存 24 小时后自动删除（暂存复用缓存 TTL 必须 < 24h）；
 *   - 通用文件存储，未限定 MIME 类型；流式方式官方建议大文件走此路，保守限 100MB；
 *   - 上传接口官方未公布频率/并发条款（账号级「每 10 秒 20 个新生成请求」只针对生成
 *     请求）——故不做预防性节流，全并发直发，仅对真实 429 自适应退避重试（见下）。
 *   - 响应：{ success, code:200, msg, data: { fileUrl, downloadUrl, expiresAt, … } }。
 */
import { ENV } from "./env";

const KIE_UPLOAD_BASE = "https://kieai.redpandaai.co";
const MAX_BYTES = 100 * 1024 * 1024;

// 与 poyoUpload 的区别（有意为之）：Poyo 官方明文 5 次/分/Key，所以那边做预防性滑动
// 窗口排队；Kie 上传接口【官方未公布任何频率/并发条款】——不做预防性节流（那会把
// 批量提交白白串行化拖慢），全并发直发，仅在真的收到 429 时按 Retry-After / 指数退避
// 自适应重试（最多 3 次），重试仍失败才抛错回落 presign。
const MAX_429_RETRIES = 3;

function retryAfterMs(res: Response, attempt: number): number {
  const h = Number(res.headers.get("retry-after"));
  if (Number.isFinite(h) && h > 0) return Math.min(h * 1000, 30_000);
  return 2000 * attempt; // 2s / 4s / 6s
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

  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);

  let res: Response | null = null;
  for (let attempt = 1; ; attempt++) {
    // FormData/Blob 每次重试重建（body 流被消费后不可复用）。
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), fileName);
    form.append("uploadPath", "canvas-refs");
    form.append("fileName", fileName);
    const resp = await fetch(`${KIE_UPLOAD_BASE}/api/file-stream-upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ENV.kieApiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    res = resp;
    if (resp.status === 429 && attempt <= MAX_429_RETRIES) {
      await new Promise((r) => setTimeout(r, retryAfterMs(resp, attempt)));
      continue;
    }
    break;
  }
  if (!res || !res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) throw new Error(`Kie 流式上传触发限流 (429，已自动重试 ${MAX_429_RETRIES} 次仍失败)，请稍后重试。${text}`);
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
