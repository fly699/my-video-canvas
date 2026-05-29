import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Resolution order for *default* groupId recommendation:
 *   0. Cached one-time invite (sessionStorage)      → source: "invite"
 *   1. ?invite= URL param (DB-backed, single-use)   → source: "invite"
 *   2. URL hash #g=<code>                           → source: "hash", shown first
 *   3. Server-observed client IP (most reliable)    → source: "ip-server"
 *   4. Browser-side ipify.org / icanhazip.com       → source: "ip-browser"
 *
 * Steps 2–4 now run concurrently so ALL detected options are surfaced in
 * `groups` for the user to pick from. The hash group (if present) is
 * pre-selected; otherwise the server-IP group is pre-selected.
 */

export type DetectedGroup = {
  groupId: string;
  source: "hash" | "ip-server" | "ip-browser" | "invite";
  label: string;
};

export type Fingerprint =
  | { state: "loading" }
  | { state: "ready"; groupId: string; source: "hash" | "ip" | "invite"; groups: DetectedGroup[] }
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
    return (await resp.text()).trim();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function detectPublicIpv4(): Promise<string | null> {
  const ipifyRaw = await fetchWithTimeout("https://api.ipify.org?format=json", 5000);
  if (ipifyRaw) {
    try {
      const j = JSON.parse(ipifyRaw) as { ip?: unknown };
      if (typeof j.ip === "string" && isValidIpv4(j.ip)) return j.ip;
    } catch {
      if (isValidIpv4(ipifyRaw)) return ipifyRaw;
    }
  }
  const backup = await fetchWithTimeout("https://icanhazip.com", 5000);
  if (backup && isValidIpv4(backup)) return backup;
  return null;
}

function ipToGroupId(ip: string): string {
  return `ip-${ip.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

function buildFingerprint(
  hashCode: string | null,
  serverIp: string | null,
  browserIp: string | null,
): Fingerprint | null {
  const groups: DetectedGroup[] = [];

  if (hashCode) {
    groups.push({
      groupId: `code-${hashCode}`,
      source: "hash",
      label: hashCode,
    });
  }

  if (serverIp) {
    const confirmed = browserIp && browserIp === serverIp;
    groups.push({
      groupId: ipToGroupId(serverIp),
      source: "ip-server",
      label: confirmed ? `${serverIp}（双重确认）` : serverIp,
    });
  }

  if (browserIp && browserIp !== serverIp) {
    groups.push({
      groupId: ipToGroupId(browserIp),
      source: "ip-browser",
      label: browserIp,
    });
  }

  if (groups.length === 0) return null;

  const first = groups[0];
  const source: "hash" | "ip" | "invite" =
    first.source === "hash" ? "hash" : "ip";

  return { state: "ready", groupId: first.groupId, source, groups };
}

export function useLanFingerprint(): Fingerprint {
  const [fp, setFp] = useState<Fingerprint>({ state: "loading" });
  const redeemMu = trpc.lanChat.redeemInvite.useMutation();
  const utils = trpc.useUtils();

  // Cache last detected IPs so the hashchange handler can rebuild groups
  // without re-fetching.
  const detectedRef = useRef<{ server: string | null; browser: string | null }>({
    server: null,
    browser: null,
  });

  useEffect(() => {
    let cancelled = false;

    // 0. Cached invite redemption — survives refresh so the user
    //    isn't kicked out after F5 (the actual redeem is single-use).
    if (typeof window !== "undefined") {
      try {
        const cached = window.sessionStorage.getItem(INVITE_CACHE_KEY);
        if (cached) {
          setFp({
            state: "ready",
            groupId: cached,
            source: "invite",
            groups: [{ groupId: cached, source: "invite", label: "一次性邀请" }],
          });
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
            url.searchParams.delete("invite");
            window.history.replaceState({}, "", url.toString());
            setFp({
              state: "ready",
              groupId: res.groupId,
              source: "invite",
              groups: [{ groupId: res.groupId, source: "invite", label: "一次性邀请" }],
            });
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

    // 2 + 3. Hash override + server/browser IP detection run concurrently.
    // Hash is synchronous so we can pre-populate groups immediately, giving
    // the user a ready state while IPs are still loading.
    const hashCode = typeof window !== "undefined"
      ? (HASH_RE.exec(window.location.hash)?.[1] ?? null)
      : null;

    if (hashCode) {
      // Unlock the form immediately with the hash group; IPs will be appended.
      setFp(buildFingerprint(hashCode, null, null) ?? { state: "loading" });
    }

    (async () => {
      const [serverResult, browserResult] = await Promise.allSettled([
        utils.lanChat.clientInfo.fetch().then((info) => info?.ip ?? null).catch(() => null),
        detectPublicIpv4(),
      ]);

      if (cancelled) return;

      const serverIp = serverResult.status === "fulfilled" ? serverResult.value : null;
      const browserIp = browserResult.status === "fulfilled" ? browserResult.value : null;
      detectedRef.current = { server: serverIp, browser: browserIp };

      const result = buildFingerprint(hashCode, serverIp, browserIp);
      if (result) {
        setFp(result);
      } else if (!hashCode) {
        setFp({
          state: "error",
          message:
            "无法确定网络分组 — LAN 聊天不可用。请检查网络后刷新；或访问 /lan-chat#g=代号 用邀请链接跳过检测。",
        });
      }
      // If hash was present but IPs failed, the hash-only ready state set above
      // remains valid — don't overwrite with an error.
    })();

    const onHashChange = () => {
      const newHashCode = HASH_RE.exec(window.location.hash)?.[1] ?? null;
      const result = buildFingerprint(
        newHashCode,
        detectedRef.current.server,
        detectedRef.current.browser,
      );
      if (result) setFp(result);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return fp;
}
