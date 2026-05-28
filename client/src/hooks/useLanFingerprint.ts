import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Strict public-IP-based grouping for LAN chat with an invite-code
 * fast path.
 *
 * Resolution order (first hit wins):
 *   0. URL `?invite=<code>` — DB-backed one-time invite. Calls
 *      lanChat.redeemInvite, atomic single-use. Caches resolved groupId
 *      in sessionStorage so a refresh doesn't re-attempt (single-use
 *      would fail on second try). source: "invite".
 *   1. URL hash `#g=<code>` (1–40 chars, alnum/._-) → "code-{code}".
 *      Reusable invite (no expiry, no usage limit).
 *   2. Browser-side public IP via api.ipify.org (IPv4-only) → backup
 *      icanhazip.com (plain text). source: "ip".
 *   3. Both fail → state: "error" — caller must NOT let the user join.
 */

export type Fingerprint =
  | { state: "loading" }
  | { state: "ready"; groupId: string; source: "hash" | "ip" | "invite" }
  | { state: "error"; message: string };

const INVITE_CACHE_KEY = "lan-chat:invite-group:v1";

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
  const redeemMu = trpc.lanChat.redeemInvite.useMutation();

  useEffect(() => {
    let cancelled = false;

    // 0. Cached invite redemption — survives refresh so the user
    //    isn't kicked out of an invite-code group after F5 (the actual
    //    redeem is single-use, so re-attempting would fail).
    if (typeof window !== "undefined") {
      try {
        const cached = window.sessionStorage.getItem(INVITE_CACHE_KEY);
        if (cached) {
          setFp({ state: "ready", groupId: cached, source: "invite" });
          return;
        }
      } catch { /* sessionStorage may be disabled */ }
    }

    // 1. ?invite= URL param — DB-backed one-time invite.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("invite");
      if (code) {
        (async () => {
          try {
            const res = await redeemMu.mutateAsync({ code });
            if (cancelled) return;
            try { window.sessionStorage.setItem(INVITE_CACHE_KEY, res.groupId); } catch { /* ignore */ }
            // Strip ?invite= from URL so refresh doesn't re-attempt.
            url.searchParams.delete("invite");
            window.history.replaceState({}, "", url.toString());
            setFp({ state: "ready", groupId: res.groupId, source: "invite" });
          } catch (err) {
            if (cancelled) return;
            setFp({
              state: "error",
              message: `邀请码失效：${err instanceof Error ? err.message : "未知错误"}`,
            });
          }
        })();
        return () => { cancelled = true; };
      }
    }

    // 2. URL hash override — synchronous, ready immediately.
    if (typeof window !== "undefined") {
      const m = HASH_RE.exec(window.location.hash);
      if (m) {
        setFp({ state: "ready", groupId: `code-${m[1]}`, source: "hash" });
        return;
      }
    }

    // 3. Async public IP fetch.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return fp;
}
