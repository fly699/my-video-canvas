import { TRPCError } from "@trpc/server";

// RFC 1918 + loopback + IPv6 link-local. Mirrors the regex in auditLog.ts but
// extracted here so LAN chat can refuse external IPs without depending on the
// audit log module. The "unknown" / "" / "localhost" matches keep dev bypass
// working (clientIp falls back to "unknown" when behind a proxy that hasn't
// been trusted yet).
const LAN_IP_RE = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|fc|fd|fe80:|localhost$|unknown$|^$)/i;

/** Strip the IPv4-mapped IPv6 prefix so "::ffff:192.168.1.1" reads as
 *  "192.168.1.1" — matches what `whitelist.ts` does. */
export function normalizeIp(ip: string): string {
  return (ip || "").replace(/^::ffff:/i, "");
}

export function isLanIp(ip: string): boolean {
  const n = normalizeIp(ip);
  return LAN_IP_RE.test(n);
}

export function assertLanOnly(ctx: { clientIp: string }): void {
  if (!isLanIp(ctx.clientIp)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "局域网聊天仅限内网访问" });
  }
}
