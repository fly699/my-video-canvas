// SSRF guard for the image/video proxies: only allow https:// to a public host,
// blocking loopback / private / link-local / cloud-metadata targets across the
// many literal forms (dotted IPv4, decimal/hex integer IPv4, IPv6 ULA/link-local,
// IPv4-mapped IPv6, localhost). NOTE: this validates the URL's LITERAL host only —
// it does not resolve DNS, so a domain that resolves to an internal IP (DNS
// rebinding) is a residual risk; callers also re-validate the post-redirect URL.

function isBlockedIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return true; // short/odd forms (e.g. "127.1") → block to be safe
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = nums;
  if (a === 0 || a === 127 || a === 10) return true;                 // this-net, loopback/8, private/8
  if (a === 169 && b === 254) return true;                           // link-local / cloud metadata
  if (a === 192 && b === 168) return true;                           // private
  if (a === 172 && b >= 16 && b <= 31) return true;                  // private
  if (a === 100 && b >= 64 && b <= 127) return true;                 // CGNAT
  return false;
}

function isBlockedHost(rawHost: string): boolean {
  let host = rawHost.toLowerCase().trim();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "metadata.google.internal" || host.endsWith(".metadata.google.internal")) return true;
  // IPv6
  if (host.includes(":")) {
    if (host === "::1" || host === "::") return true;
    if (host.startsWith("::ffff:")) return isBlockedIPv4(host.slice("::ffff:".length)); // mapped IPv4
    if (/^f[cd]/.test(host)) return true; // fc00::/7 unique-local
    if (/^fe[89ab]/.test(host)) return true; // fe80::/10 link-local
    return false; // other global IPv6
  }
  // Integer / hex IPv4 forms (e.g. 2130706433, 0x7f000001) — not a real hostname.
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/.test(host)) return true;
  // Dotted IPv4.
  if (/^[\d.]+$/.test(host)) return isBlockedIPv4(host);
  return false; // ordinary domain name
}

/** True only for an https:// URL whose literal host is a public (non-internal) target. */
export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") return false;
    return !isBlockedHost(u.hostname);
  } catch {
    return false;
  }
}
