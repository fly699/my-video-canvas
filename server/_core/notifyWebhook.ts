import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { getUserWebhook, type RecordedAssetInfo } from "../db";
import { resolveToAbsoluteUrl } from "../storage";

/**
 * 用户个人产物推送 webhook：产物生成完成时按用户配置向外部服务 POST（Bark / Server酱 /
 * Telegram / Slack / Discord / 通用 JSON）。url 由用户提供，故服务端发起请求前必须过 SSRF
 * 守卫——解析目标域名的所有 IP，任一落在私网/环回/链路本地/云元数据段即拒绝，杜绝拿本服务
 * 当跳板去打内网/169.254.169.254。请求禁重定向、限时、限响应体。
 */

export type WebhookKind = "generic" | "bark" | "serverchan" | "telegram" | "slack" | "discord";
export const WEBHOOK_KINDS: WebhookKind[] = ["generic", "bark", "serverchan", "telegram", "slack", "discord"];

/** 判断一个已解析的 IP 是否属于禁止段（私网/环回/链路本地/CGNAT/元数据/保留）。 */
export function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;              // 本网/私网/环回
    if (a === 169 && b === 254) return true;                         // 链路本地 + 云元数据 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;                // 私网
    if (a === 192 && b === 168) return true;                         // 私网
    if (a === 100 && b >= 64 && b <= 127) return true;               // CGNAT 100.64/10
    if (a === 192 && b === 0 && p[2] === 0) return true;             // 192.0.0.0/24
    if (a === 198 && (b === 18 || b === 19)) return true;            // 基准测试 198.18/15
    if (a >= 224) return true;                                       // 组播/保留 224+
    return false;
  }
  if (v === 6) {
    const lc = ip.toLowerCase();
    if (lc === "::1" || lc === "::") return true;                    // 环回/未指定
    // IPv4 映射（::ffff:a.b.c.d）→ 按内嵌 v4 判定
    const m = lc.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isBlockedIp(m[1]);
    if (lc.startsWith("fe8") || lc.startsWith("fe9") || lc.startsWith("fea") || lc.startsWith("feb")) return true; // fe80::/10 链路本地
    if (lc.startsWith("fc") || lc.startsWith("fd")) return true;     // fc00::/7 唯一本地
    return false;
  }
  return true; // 非法 IP 视为拒绝
}

/** 校验 webhook 目标为公网可达的 http(s) URL，否则抛错。DNS 解析全部地址逐一校验。 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("webhook URL 非法"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("webhook 仅支持 http(s)");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const lowerHost = host.toLowerCase();
  if (lowerHost === "localhost" || lowerHost.endsWith(".localhost") || lowerHost.endsWith(".local") || lowerHost.endsWith(".internal")) {
    throw new Error("webhook 不允许指向本机/内网主机名");
  }
  // 若本身就是 IP 字面量，直接判；否则解析所有 A/AAAA 记录逐一判。
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error("webhook 不允许指向私网/环回/元数据地址");
    return u;
  }
  let addrs: { address: string }[];
  try { addrs = await dns.lookup(host, { all: true }); } catch { throw new Error("webhook 域名解析失败"); }
  if (!addrs.length) throw new Error("webhook 域名无解析结果");
  for (const a of addrs) if (isBlockedIp(a.address)) throw new Error("webhook 域名解析到了私网/环回/元数据地址");
  return u;
}

/** 解析目标域名并返回**全部通过 SSRF 校验**的 IP（IP 字面量则直接校验后返回自身）。
 *  任一地址落在禁段、或无解析结果即抛错。返回的 IP 供 securePost 固定连接目标，杜绝
 *  「校验用一次解析、fetch 再解析一次」之间被短 TTL 域名切到内网/元数据 IP 的 DNS 重绑定。 */
export async function resolveValidatedIps(u: URL): Promise<string[]> {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error("webhook 不允许指向私网/环回/元数据地址");
    return [host];
  }
  let addrs: { address: string }[];
  try { addrs = await dns.lookup(host, { all: true }); } catch { throw new Error("webhook 域名解析失败"); }
  if (!addrs.length) throw new Error("webhook 域名无解析结果");
  for (const a of addrs) if (isBlockedIp(a.address)) throw new Error("webhook 域名解析到了私网/环回/元数据地址");
  return addrs.map((a) => a.address);
}

/** 向已校验的 webhook 目标发 POST：把 socket 连接**固定**到预先校验过的 IP（自定义 lookup，
 *  不再二次解析主机名），同时保留主机名作 TLS SNI / cert 校验；连接期再判一次禁段做纵深防御。
 *  不自动跟随重定向（原生 http.request 默认不跟随，等价于旧 redirect:"error"）。 */
function securePost(u: URL, ips: string[], init: RequestInit, timeoutMs = 8000): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const host = u.hostname.replace(/^\[|\]$/g, "");
    const pinnedIp = ips[0];
    if (!pinnedIp || isBlockedIp(pinnedIp)) { reject(new Error("webhook 目标无合法出网 IP")); return; }
    const mod = u.protocol === "https:" ? https : http;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers as Record<string, string>) ?? {})) headers[k] = v;
    const body = typeof init.body === "string" ? init.body : undefined;
    if (body != null) headers["content-length"] = String(Buffer.byteLength(body));
    // 自定义 lookup：只返回预先校验过的 IP，连接期再判一次禁段（防被绕过）。
    const lookup = (_hostname: string, _opts: unknown, cb: (err: Error | null, address: string, family: number) => void): void => {
      if (isBlockedIp(pinnedIp)) { cb(new Error("webhook 目标解析到私网/环回/元数据地址"), "", 0); return; }
      cb(null, pinnedIp, (net.isIP(pinnedIp) || 4));
    };
    const req = mod.request({
      protocol: u.protocol,
      hostname: host,
      port: u.port ? Number(u.port) : (u.protocol === "https:" ? 443 : 80),
      path: (u.pathname || "/") + (u.search || ""),
      method: "POST",
      headers,
      servername: u.protocol === "https:" ? host : undefined, // TLS SNI = 主机名，证书按主机名校验
      lookup: lookup as unknown as net.LookupFunction,
      timeout: timeoutMs,
    }, (res) => {
      const status = res.statusCode ?? 0;
      res.on("data", () => { /* drain，释放连接 */ });
      res.on("end", () => resolve({ ok: status >= 200 && status < 300, status }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("webhook 请求超时")));
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

/** 把产物信息渲染成 title/body（body 含可点击的产物绝对链接）。 */
function renderMessage(a: RecordedAssetInfo, absUrl: string): { title: string; body: string } {
  const emoji = a.type === "image" ? "🖼️" : a.type === "video" ? "🎬" : a.type === "audio" ? "🎵" : "📦";
  const label = a.type === "image" ? "图像" : a.type === "video" ? "视频" : a.type === "audio" ? "音频" : "产物";
  const title = `${emoji} 新${label}已生成`;
  const body = `${a.name}${a.model ? `（${a.model}）` : ""}\n${absUrl}`;
  return { title, body };
}

/** 按 kind 构造实际请求。返回 { target, init }。 */
function buildRequest(kind: string, cfgUrl: string, a: RecordedAssetInfo, absUrl: string): { target: string; init: RequestInit } {
  const { title, body } = renderMessage(a, absUrl);
  const json = (obj: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(obj) });
  const form = (params: Record<string, string>): RequestInit => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
  switch (kind) {
    case "bark":       return { target: cfgUrl, init: json({ title, body, url: absUrl }) };
    case "serverchan": return { target: cfgUrl, init: form({ title, desp: `${body}` }) };
    case "slack":      return { target: cfgUrl, init: json({ text: `*${title}*\n${body}` }) };
    case "discord":    return { target: cfgUrl, init: json({ content: `**${title}**\n${body}` }) };
    case "telegram":   return { target: cfgUrl, init: form({ text: `${title}\n${body}` }) }; // cfgUrl 含 bot token 与 chat_id
    case "generic":
    default:           return { target: cfgUrl, init: json({ title, body, url: absUrl, type: a.type, name: a.name, model: a.model ?? null }) };
  }
}

/** 主入口：读取用户 webhook 配置，通过 SSRF 守卫后向外部推送。best-effort。 */
export async function dispatchAssetWebhook(a: RecordedAssetInfo): Promise<void> {
  const cfg = await getUserWebhook(a.userId);
  if (!cfg || !cfg.enabled || !cfg.url) return;
  const target = await assertPublicHttpUrl(cfg.url); // URL/DNS 级校验，抛错即拒发
  const ips = await resolveValidatedIps(target);     // 取已校验 IP，下面固定连接到它（防重绑定）
  // 产物绝对链接（相对 /manus-storage 需解析成外部可访问的绝对 URL）
  let absUrl = a.url;
  try { if (!/^https?:\/\//i.test(a.url) && !a.url.startsWith("data:")) absUrl = await resolveToAbsoluteUrl(a.url); } catch { /* 用原值 */ }
  const { init } = buildRequest(cfg.kind, target.toString(), a, absUrl);
  const resp = await securePost(target, ips, init, 8000);
  if (!resp.ok) console.warn(`[notifyWebhook] ${cfg.kind} 返回 ${resp.status}`);
}

/** 发送一条「配置测试」推送，验证 webhook 是否可用（与 SMTP/存储测试对齐）。失败即抛错。 */
export async function sendTestWebhook(userId: number): Promise<void> {
  const cfg = await getUserWebhook(userId);
  if (!cfg || !cfg.enabled) throw new Error("外部推送未启用");
  if (!cfg.url) throw new Error("未填写 Webhook URL");
  const target = await assertPublicHttpUrl(cfg.url); // SSRF 守卫，抛错即拒发
  const ips = await resolveValidatedIps(target);     // 固定连接到已校验 IP（防重绑定）
  const testAsset: RecordedAssetInfo = { userId, type: "image", name: "配置测试推送（收到即表示 Webhook 可用）", url: "https://ai-video-canvas.example/webhook-check", model: null };
  const { init } = buildRequest(cfg.kind, target.toString(), testAsset, testAsset.url);
  const resp = await securePost(target, ips, init, 8000);
  if (!resp.ok) throw new Error(`目标返回 HTTP ${resp.status}`);
}
