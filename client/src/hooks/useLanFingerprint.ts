import { useEffect, useState } from "react";

/**
 * Strict public-IP-based grouping for LAN chat. Same outbound NAT exit
 * IP → same chat group; different IPs → never see each other. No
 * "public" fallback — if neither the URL hash override nor the public
 * IP detection succeeds, the chat is unavailable (deliberately, to
 * prevent strangers from being pooled together against the user's
 * stated intent).
 *
 * Resolution order:
 *   1. URL hash `#g=<code>` (1–40 chars, alnum/._-) → "code-{code}".
 *      Escape hatch for cross-LAN teams (remote work) who can share
 *      a chosen group code instead of relying on IP coincidence.
 *   2. Browser-side public IP via api.ipify.org (IPv4-only endpoint,
 *      ensures everyone in the same office gets the same string even
 *      if some devices prefer IPv6 over IPv4 when both are routable).
 *      Fallback fetcher: icanhazip.com (plain text).
 *   3. Both fail → state: "error". Caller must NOT let the user join.
 */

export type Fingerprint =
  | { state: "loading" }
  | { state: "ready"; groupId: string; source: "hash" | "ip" }
  | { state: "error"; message: string };

const HASH_RE = /[#&]g=([A-Za-z0-9._-]{1,40})/;
const IPV4_RE = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/;

function isValidIpv4(s: string): boolean {
  const m = IPV4_RE.exec(s);
  if (!m) return false;
  return m.slice(1, 5).every((part) => {
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!resp.ok) return null;
    const text = (await resp.text()).trim();
    return text;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function detectPublicIpv4(): Promise<string | null> {
  // Primary: ipify IPv4-only endpoint. Returns plain text by default.
  // Trying JSON to be tolerant of either response format.
  const ipifyRaw = await fetchWithTimeout("https://api.ipify.org?format=json", 5000);
  if (ipifyRaw) {
    try {
      const j = JSON.parse(ipifyRaw) as { ip?: unknown };
      if (typeof j.ip === "string" && isValidIpv4(j.ip)) return j.ip;
    } catch {
      // Fall through — maybe text response slipped through
      if (isValidIpv4(ipifyRaw)) return ipifyRaw;
    }
  }
  // Backup: icanhazip returns the IP as plain text plus newline.
  const backup = await fetchWithTimeout("https://icanhazip.com", 5000);
  if (backup && isValidIpv4(backup)) return backup;
  return null;
}

export function useLanFingerprint(): Fingerprint {
  const [fp, setFp] = useState<Fingerprint>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;

    // 1. URL hash override — synchronous, ready immediately.
    if (typeof window !== "undefined") {
      const m = HASH_RE.exec(window.location.hash);
      if (m) {
        setFp({ state: "ready", groupId: `code-${m[1]}`, source: "hash" });
        return;
      }
    }

    // 2. Async public IP fetch.
    (async () => {
      const ip = await detectPublicIpv4();
      if (cancelled) return;
      if (ip) {
        setFp({ state: "ready", groupId: `ip-${ip}`, source: "ip" });
      } else {
        setFp({
          state: "error",
          message: "无法获取公网 IP — LAN 聊天不可用。请检查网络后刷新；或访问 /lan-chat#g=代号 用邀请链接跳过 IP 检测。",
        });
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return fp;
}
