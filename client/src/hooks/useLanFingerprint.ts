import { useEffect, useState } from "react";

/**
 * Best-effort detection of the user's local LAN subnet via WebRTC ICE
 * gathering. The browser leaks host candidates with the device's LAN IP
 * (e.g. 192.168.0.42). Strip the last octet → /24 subnet → use as group id.
 *
 * Same office WiFi → same subnet → same chat group automatically.
 * Different LAN → different subnet → independent chats.
 *
 * Fallbacks (in priority order):
 *   1. URL hash `#g=<code>` — manual override / shareable invite link
 *      Lets two users on different LANs intentionally co-locate.
 *   2. WebRTC RFC1918 host candidate → "lan-{subnet}"
 *   3. WebRTC mDNS-obfuscated (*.local) → can't determine LAN; fall through
 *   4. Detection failed / browser blocks ICE → "public" (global chat).
 *
 * The subnet detection is best-effort: modern browsers apply mDNS
 * obfuscation by default. When that happens we can't reliably group by
 * LAN — users land in the global "public" pool. The shareable hash
 * override exists exactly for that case.
 */
export function useLanFingerprint(): { groupId: string; loading: boolean; source: "hash" | "lan" | "public" | null } {
  const [groupId, setGroupId] = useState<string>("public");
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"hash" | "lan" | "public" | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 1. URL hash override — `#g=team123`
    const hashMatch = /[#&]g=([A-Za-z0-9._-]{1,40})/.exec(window.location.hash);
    if (hashMatch) {
      setGroupId(`code-${hashMatch[1]}`);
      setSource("hash");
      setLoading(false);
      return;
    }

    // 2. WebRTC ICE gathering for LAN subnet
    detectLanSubnet().then((subnet) => {
      if (cancelled) return;
      if (subnet) {
        setGroupId(`lan-${subnet}`);
        setSource("lan");
      } else {
        setGroupId("public");
        setSource("public");
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  return { groupId, loading, source };
}

/** Run WebRTC ICE gathering, return the /24 subnet of the first RFC1918
 *  host candidate seen, or null if mDNS obfuscation hides everything. */
async function detectLanSubnet(): Promise<string | null> {
  // Guard against SSR + browsers without RTCPeerConnection.
  if (typeof window === "undefined" || typeof RTCPeerConnection === "undefined") return null;

  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel("");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    return await new Promise<string | null>((resolve) => {
      let done = false;
      const finish = (subnet: string | null) => {
        if (done) return;
        done = true;
        try { pc.close(); } catch { /* ignore */ }
        resolve(subnet);
      };

      pc.onicecandidate = (e) => {
        if (done) return;
        if (!e.candidate) {
          // ICE gathering complete with no useful candidate.
          finish(null);
          return;
        }
        const c = e.candidate.candidate;
        // mDNS-obfuscated candidates contain `.local` instead of an IP.
        // Skip them — we can't determine LAN from a per-device UUID.
        if (/\.local\b/i.test(c)) return;
        // Match the IP in the candidate string. RFC1918 private IPv4
        // ranges: 10.0.0.0/8, 172.16-31, 192.168.0.0/16.
        const ipMatch = /(\d+\.\d+\.\d+)\.\d+/.exec(c);
        if (!ipMatch) return;
        const ip = ipMatch[1];
        if (
          /^10\./.test(ip) ||
          /^192\.168\./.test(ip) ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
        ) {
          finish(ip); // /24 subnet, e.g. "192.168.0"
        }
      };

      // Safety: bail if gathering takes too long (some networks are slow).
      window.setTimeout(() => finish(null), 2500);
    });
  } catch {
    return null;
  }
}
