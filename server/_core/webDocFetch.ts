/**
 * #224 批2 联网提炼：抓取管理员指定的【官方文档页】正文，供 LLM 提炼模型技法草稿。
 *
 * 设计取舍：不依赖 LLM 网关的 web search 能力（该能力未经真实网关验证，不靠猜）——
 * 「联网」由服务端自己 fetch 指定 URL 完成，LLM 只做纯文本提炼（与批1 同款、已验证的
 * 调用形态）。入口为 L3+ 管理员专用，但仍做 SSRF 防护（教训沉淀自 rehostMcpAsset 评审）。
 */

const MAX_BYTES = 1_500_000;      // 抓取体积上限 ~1.5MB（文档页足够，防拖库/大文件）
const MAX_TEXT_CHARS = 28_000;    // 喂给 LLM 的正文字符上限（约一篇长文档页）
const MAX_REDIRECTS = 3;

/** 私网/回环/链路本地/元数据等禁止目标（SSRF 防护）。导出供单测。 */
export function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // 去 IPv6 方括号
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv6 回环/链路本地/ULA
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  // IPv4 字面量：仅放行公网段
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // 链路本地/云元数据 169.254.169.254
    if (a >= 224) return true;               // 组播/保留
  }
  return false;
}

/** 校验为可抓取的公网 http(s) 文档 URL；不合法抛错（含中文原因）。 */
export function assertPublicDocUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("URL 格式不合法"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("仅支持 http/https 链接");
  if (u.username || u.password) throw new Error("URL 不得携带用户名/密码");
  if (u.port && !["80", "443", ""].includes(u.port)) throw new Error("仅允许 80/443 标准端口");
  if (isForbiddenHost(u.hostname)) throw new Error("禁止访问内网/回环/保留地址");
  return u;
}

/** HTML → 纯文本（去 script/style/标签、实体反转、压缩空白）。导出供单测。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>(?=.)/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 抓取文档页正文（手动跟随重定向，每跳重新过 SSRF 校验；HTML 转纯文本，纯文本原样）。 */
export async function fetchDocText(rawUrl: string): Promise<{ text: string; finalUrl: string }> {
  let url = assertPublicDocUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (compatible; avc-skill-bot/1.0)", accept: "text/html,text/plain,text/markdown,*/*;q=0.5" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc || hop >= MAX_REDIRECTS) throw new Error(`重定向过多或缺少 Location（${res.status}）`);
      url = assertPublicDocUrl(new URL(loc, url).toString()); // 每跳重新校验，防重定向绕过
      continue;
    }
    if (!res.ok) throw new Error(`抓取失败（HTTP ${res.status}）`);
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!/text\/|json|xml|markdown/.test(ct)) throw new Error(`不支持的内容类型：${ct || "未知"}（仅文本/HTML 文档页）`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new Error("文档页超过 1.5MB 体积上限");
    const rawText = buf.toString("utf8");
    const text = (ct.includes("html") ? htmlToText(rawText) : rawText.trim()).slice(0, MAX_TEXT_CHARS);
    if (!text) throw new Error("页面无可提取的文本内容");
    return { text, finalUrl: url.toString() };
  }
}
