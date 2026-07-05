// 本机订阅桥接的「附件」支持：把 OpenAI 消息里的图片（image_url）与文档（file_url）取出来，
// 转成 Claude / codex CLI 各自能吃的形态。
//   - 图片：Claude 走 `--input-format stream-json` 内联 base64 图片块（真机实测可用，无需给工具、
//     不落磁盘）；codex 走 `codex exec -i <文件>`（把图片落成临时文件传进去，用完删）。
//   - 文档：上游（chat/canvas 路由）通常已把 PDF/txt 解析成文本内联，这里再做一层兜底——凡以
//     file_url 直达的文档，解码/抓取后用 parseDocumentToText 转文本，追加进提示词。两家通用。
// 只在检测到附件时才走加料路径，纯文本问答完全不受影响。
import { parseDocumentToText, isParsableDocument } from "./documentParse";

// OpenAI 分段 content 的各种块（宽松匹配，未知字段忽略）。
type Part =
  | string
  | { type?: string; text?: string; image_url?: { url?: string }; file_url?: { url?: string; mime_type?: string } };
export interface BridgeMessage { role?: string; content?: string | Part[] }

/** Claude 视觉块支持的 media_type；其它一律按 png 兜底（仍可能被模型拒，但不至于崩）。 */
const CLAUDE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const EXT_BY_TYPE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export interface ResolvedImage { mediaType: string; base64: string }

/** 收集所有消息里的图片 url（image_url 块）。纯函数。 */
export function collectImageUrls(messages: BridgeMessage[]): string[] {
  const urls: string[] = [];
  for (const m of messages ?? []) {
    if (!Array.isArray(m?.content)) continue;
    for (const p of m.content) {
      if (p && typeof p === "object" && p.type === "image_url" && p.image_url?.url) urls.push(p.image_url.url);
    }
  }
  return urls;
}

/** 收集所有消息里的文档块（file_url）。纯函数。 */
export function collectFileUrls(messages: BridgeMessage[]): Array<{ url: string; mimeType?: string }> {
  const out: Array<{ url: string; mimeType?: string }> = [];
  for (const m of messages ?? []) {
    if (!Array.isArray(m?.content)) continue;
    for (const p of m.content) {
      if (p && typeof p === "object" && p.type === "file_url" && p.file_url?.url) out.push({ url: p.file_url.url, mimeType: p.file_url.mime_type });
    }
  }
  return out;
}

/** 解析 data: URL → { mediaType, bytes }。非 data: 或格式非法返回 null。纯函数。 */
export function parseDataUrl(url: string): { mediaType: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(url ?? "");
  if (!m) return null;
  const mediaType = (m[1] || "application/octet-stream").trim();
  const isB64 = !!m[2];
  try {
    const bytes = isB64 ? new Uint8Array(Buffer.from(m[3], "base64")) : new Uint8Array(Buffer.from(decodeURIComponent(m[3]), "utf8"));
    return { mediaType, bytes };
  } catch { return null; }
}

/** data: 的 mediaType，或按扩展名/内容类型归一到 Claude 支持的图片类型。纯函数。 */
export function normalizeImageMediaType(raw: string | undefined, url: string): string {
  const t = (raw || "").toLowerCase().split(";")[0].trim();
  if (CLAUDE_IMAGE_TYPES.has(t)) return t;
  const ext = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(url)?.[1]?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

export const imageExt = (mediaType: string): string => EXT_BY_TYPE[mediaType] ?? "png";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 单图上限，防把巨图塞进 CLI

/** 抓取 http(s) 资源为字节（带超时/大小上限）。失败返回 null。 */
async function fetchBytes(url: string, timeoutMs = 15_000): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    clearTimeout(t);
    if (!resp.ok) return null;
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;
    return { bytes: buf, contentType: resp.headers.get("content-type") || undefined };
  } catch { return null; }
}

/** 把一个图片 url（data: 或 http(s)）解析成 { mediaType, base64 }。无法解析/超限返回 null。 */
export async function resolveImage(url: string): Promise<ResolvedImage | null> {
  if (!url) return null;
  const data = parseDataUrl(url);
  if (data) {
    if (data.bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return { mediaType: normalizeImageMediaType(data.mediaType, url), base64: Buffer.from(data.bytes).toString("base64") };
  }
  if (/^https?:\/\//i.test(url)) {
    const got = await fetchBytes(url);
    if (!got) return null;
    return { mediaType: normalizeImageMediaType(got.contentType, url), base64: Buffer.from(got.bytes).toString("base64") };
  }
  return null; // blob: 等不可用
}

/** 解析所有图片 url（并发，保序，丢掉解析失败的）。 */
export async function resolveImages(urls: string[]): Promise<ResolvedImage[]> {
  const settled = await Promise.all(urls.map((u) => resolveImage(u)));
  return settled.filter((x): x is ResolvedImage => !!x);
}

/** 兜底把 file_url 文档解析成可内联的文本（上游通常已内联，这里覆盖直达 API 的场景）。 */
export async function docTextFromFileUrls(files: Array<{ url: string; mimeType?: string }>): Promise<string> {
  const parts: string[] = [];
  for (const f of files) {
    if (!isParsableDocument(undefined, f.mimeType)) {
      // 没有 mimeType 时也尝试按 data: 头判定
      const dt = parseDataUrl(f.url)?.mediaType;
      if (!dt || !isParsableDocument(undefined, dt)) continue;
    }
    let bytes: Uint8Array | null = null;
    let mimeType = f.mimeType;
    const data = parseDataUrl(f.url);
    if (data) { bytes = data.bytes; mimeType = mimeType || data.mediaType; }
    else if (/^https?:\/\//i.test(f.url)) { const got = await fetchBytes(f.url); if (got) { bytes = got.bytes; mimeType = mimeType || got.contentType; } }
    if (!bytes || bytes.byteLength === 0) continue;
    try {
      const text = (await parseDocumentToText(bytes, { mimeType })).trim();
      if (text) parts.push(`【文档内容】\n${text.slice(0, 50_000)}`);
    } catch { /* 单个文档解析失败不影响其余 */ }
  }
  return parts.join("\n\n");
}

/** 构造 Claude `--input-format stream-json` 的单行用户消息 JSON（文本 + 内联 base64 图片块）。纯函数。 */
export function buildClaudeStreamJsonInput(prompt: string, images: ResolvedImage[]): string {
  const content: unknown[] = [{ type: "text", text: prompt || "请分析附带的图片。" }];
  for (const img of images) content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
  return JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
}

/** 解析 Claude stream-json 输出：取最后一条 `type:"result"` 行的 result 文本与错误标志。纯函数。 */
export function parseClaudeStreamJsonResult(stdout: string): { text: string; isError: boolean } {
  const lines = (stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let result: { text: string; isError: boolean } | null = null;
  let lastText = "";
  for (const line of lines) {
    let obj: Record<string, unknown> | null = null;
    try { obj = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (obj.type === "result") {
      const text = typeof obj.result === "string" ? obj.result : "";
      const isError = obj.is_error === true || obj.subtype === "error";
      result = { text, isError };
    } else if (obj.type === "assistant" && obj.message && typeof obj.message === "object") {
      // 兜底：万一没有 result 行，用最后一条 assistant 文本
      const msg = obj.message as { content?: Array<{ type?: string; text?: string }> };
      const t = (msg.content ?? []).filter((c) => c?.type === "text").map((c) => c.text ?? "").join("");
      if (t) lastText = t;
    }
  }
  if (result) return result.text ? result : { text: result.text || lastText, isError: result.isError };
  if (lastText) return { text: lastText, isError: false };
  return { text: "", isError: true };
}
