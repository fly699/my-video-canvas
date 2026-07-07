import dns from "node:dns/promises";
import net from "node:net";
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
  const target = await assertPublicHttpUrl(cfg.url); // 抛错即拒发
  // 产物绝对链接（相对 /manus-storage 需解析成外部可访问的绝对 URL）
  let absUrl = a.url;
  try { if (!/^https?:\/\//i.test(a.url) && !a.url.startsWith("data:")) absUrl = await resolveToAbsoluteUrl(a.url); } catch { /* 用原值 */ }
  const { init } = buildRequest(cfg.kind, target.toString(), a, absUrl);
  const resp = await fetch(target.toString(), {
    ...init,
    redirect: "error",                          // 禁跟随重定向（防绕过 SSRF 守卫跳内网）
    signal: AbortSignal.timeout(8000),
  });
  // 读掉少量响应以释放连接；不关心内容。
  if (resp.body) { try { await resp.text(); } catch { /* ignore */ } }
  if (!resp.ok) console.warn(`[notifyWebhook] ${cfg.kind} 返回 ${resp.status}`);
}
