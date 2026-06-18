// Pure helpers for the public-tunnel access gate. Kept side-effect-free so the
// security-critical logic is unit-tested independently of cloudflared / Express.

export interface TunnelWhitelist { users: number[]; ips: string[] }

/** Host (lowercased, no port) of a public tunnel URL, or "" if unparseable. */
export function tunnelHostFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.hostname.toLowerCase();
  } catch { return ""; }
}

/** True when this request arrived through OUR public tunnel — identified precisely by
 *  the Host header matching the tunnel's public hostname (not just "behind Cloudflare",
 *  so a deployment already fronted by CF for OTHER hostnames isn't falsely gated). */
export function isTunnelRequest(reqHost: string | undefined, tunnelHost: string): boolean {
  if (!tunnelHost) return false;
  const h = (reqHost ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  return h !== "" && h === tunnelHost;
}

/** Paths that must stay reachable over the tunnel even for non-whitelisted visitors,
 *  so a whitelisted USER can still load the page and log in. Everything else (all app
 *  functionality) is blocked until the requester proves they're tunnel-whitelisted. */
export function isTunnelExemptPath(path: string): boolean {
  // Auth is always exempt (whitelisted users must be able to sign in).
  if (path.startsWith("/api/auth/")) return true;            // login / oauth / register / providers
  if (/^\/api\/trpc\/auth\./.test(path)) return true;        // tRPC auth.* (login/me)
  // Gated app resources — blocked for non-whitelisted tunnel visitors:
  if (path.startsWith("/api/trpc/")) return false;           // all other tRPC (canvas/comfyui/…)
  if (path.startsWith("/manus-storage")) return false;       // media storage + upload proxy
  if (path.startsWith("/relay")) return false;               // LAN file relay
  if (path.startsWith("/api/video-proxy") || path.startsWith("/api/image-proxy")) return false;
  if (path.startsWith("/api/socket")) return false;          // realtime collaboration
  // Everything else = static SPA shell / assets / client routes → exempt so the page loads.
  return true;
}

/** Whether a tunnel request is allowed: client IP in the tunnel IP whitelist, OR the
 *  authenticated user id in the tunnel user whitelist. Empty whitelist → nobody passes
 *  (complete block) — admins add themselves before relying on the tunnel. */
export function isTunnelAllowed(clientIp: string | undefined, userId: number | undefined, wl: TunnelWhitelist): boolean {
  if (userId != null && wl.users.includes(userId)) return true;
  if (clientIp && clientIp !== "unknown") {
    const ip = clientIp.replace(/^::ffff:/i, "");
    if (wl.ips.includes(ip) || wl.ips.includes(clientIp)) return true;
  }
  return false;
}

/** Extract a Cloudflare quick-tunnel URL (https://*.trycloudflare.com) from cloudflared
 *  log output. Named tunnels don't print a URL (the hostname is set in the dashboard),
 *  so the admin supplies publicUrl for those. */
export function parseQuickTunnelUrl(log: string): string | null {
  const m = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return m ? m[0] : null;
}
