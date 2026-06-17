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

/** Canonicalize the common literal IPv4 forms (dotted quad, single decimal
 *  integer, single 0x-hex integer) to a 32-bit int; null if not an IPv4 literal.
 *  Used to catch metadata-IP SSRF bypasses like `http://2852039166/`. */
function ipv4Literal(host: string): number | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const o = host.split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    return ((o[0] * 2 ** 24) + (o[1] << 16) + (o[2] << 8) + o[3]) >>> 0;
  }
  if (/^\d+$/.test(host)) { const n = Number(host); return n >= 0 && n <= 0xffffffff ? n >>> 0 : null; }
  if (/^0x[0-9a-f]+$/.test(host)) { const n = parseInt(host, 16); return Number.isFinite(n) && n >= 0 && n <= 0xffffffff ? n >>> 0 : null; }
  return null;
}

/** Narrow check for cloud instance-metadata endpoints (IMDS) — the addresses that
 *  leak instance credentials/roles. Unlike isBlockedHost this does NOT block
 *  loopback/RFC1918, so integrations that intentionally allow private/internal
 *  targets (e.g. a self-hosted ComfyUI on the LAN) can still use this to refuse
 *  ONLY the metadata service. Covers dotted/decimal/hex IPv4 forms + the GCP
 *  metadata hostname + the AWS IPv6 IMDS address. */
export function isCloudMetadataHost(rawHost: string): boolean {
  let host = rawHost.toLowerCase().trim();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) return false;
  if (host === "metadata.google.internal" || host.endsWith(".metadata.google.internal")) return true;
  if (host === "fd00:ec2::254") return true;                 // AWS IPv6 IMDS
  const ip = ipv4Literal(host);
  if (ip === 0xa9fea9fe) return true;                        // 169.254.169.254 (AWS/GCP/Azure/Oracle/OpenStack IMDS)
  if (ip === 0x646464c8) return true;                        // 100.100.100.200 (Alibaba Cloud metadata)
  return false;
}

/** True only for an https:// URL whose literal host is a public (non-internal) target. */
export function isAllowedExternalUrl(rawUrl: string): boolean {  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") return false;
    return !isBlockedHost(u.hostname);
  } catch {
    return false;
  }
}

/** Throwing guard for download points that must also allow http:// (LAN storage,
 *  self-hosted media). Uses the SAME strong host check as the proxies — covering
 *  decimal/hex integer IPv4, IPv6 ULA/link-local, IPv4-mapped, localhost,
 *  metadata — so the older per-call dotted-only regexes can't be bypassed via
 *  `http://2130706433/` etc. Call on BOTH the input URL and the post-redirect
 *  `res.url` (redirect:"follow" can land on an internal host the first check
 *  couldn't see). */
export function assertPublicUrl(rawUrl: string): void {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error(`Invalid URL: ${rawUrl}`); }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`Unsupported URL scheme: ${u.protocol}`);
  }
  if (isBlockedHost(u.hostname)) {
    throw new Error(`Access to private/local hosts is not allowed: ${u.hostname}`);
  }
}
