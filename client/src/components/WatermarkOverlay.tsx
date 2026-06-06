import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

/**
 * Anti-leech traceability watermark. When the admin enables it, a very faint,
 * tiled overlay of the current viewer's identity (email / id) is painted across
 * the whole viewport — so any screenshot, screen recording or re-shared frame
 * carries who leaked it.
 *
 * Deliberately minimal and SAFE: a single fixed, `pointer-events: none` layer
 * driven only by an SVG data-URL background. It touches no media pipeline and
 * never intercepts input, so it cannot break existing behavior. Renders nothing
 * when the feature is off or the user isn't logged in (default → no overlay).
 *
 * NOTE: this protects against screenshot/recording leaks, not raw-file download
 * (an overlay can't be baked into the stored file without re-encoding).
 */
function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;");
}

export function WatermarkOverlay() {
  const { user } = useAuth();
  const { data } = trpc.system.mediaProtection.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!user || !data?.watermarkEnabled) return null;

  const u = user as { email?: string | null; id?: number | string };
  const label = (u.email || (u.id != null ? `用户#${u.id}` : "")).toString().slice(0, 64);
  if (!label) return null;

  const tileW = 340, tileH = 200;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${tileW}' height='${tileH}'>` +
    `<text x='50%' y='50%' transform='rotate(-28 ${tileW / 2} ${tileH / 2})' ` +
    `fill='rgba(150,150,150,0.16)' font-family='sans-serif' font-size='15' ` +
    `text-anchor='middle' dominant-baseline='middle'>${escapeXml(label)}</text></svg>`;
  const bg = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483600,
        pointerEvents: "none",
        backgroundImage: bg,
        backgroundRepeat: "repeat",
        userSelect: "none",
      }}
    />
  );
}
