import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

/**
 * Anti-leech traceability watermark. When the admin enables it, a very faint,
 * tiled overlay of the current viewer's identity (email / id) is painted across
 * the whole viewport — so any screenshot, screen recording or re-shared frame
 * carries who leaked it.
 *
 * Deliberately minimal and SAFE: `pointer-events: none` layers driven only by an
 * SVG data-URL background. Touches no media pipeline and never intercepts input,
 * so it cannot break existing behavior. Renders nothing when the feature is off
 * or the user isn't logged in.
 *
 * Fullscreen: the browser renders ONLY the fullscreen element's subtree on top,
 * so a plain fixed overlay vanishes in fullscreen. We therefore ALSO portal a
 * copy of the watermark INTO `document.fullscreenElement` whenever one exists
 * (works for any container-based fullscreen — e.g. our WatermarkedVideo wrapper).
 * Native `<video>`-element fullscreen renders no DOM children at all, so video
 * players must fullscreen a container, not the bare <video>, for this to show.
 *
 * NOTE: an overlay protects against screenshot/recording leaks, not raw-file
 * download (that's the separate burned-in download watermark).
 */
function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;");
}

function watermarkBackground(label: string): string {
  const tileW = 340, tileH = 200;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${tileW}' height='${tileH}'>` +
    `<text x='50%' y='50%' transform='rotate(-28 ${tileW / 2} ${tileH / 2})' ` +
    `fill='rgba(150,150,150,0.16)' font-family='sans-serif' font-size='15' ` +
    `text-anchor='middle' dominant-baseline='middle'>${escapeXml(label)}</text></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
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

  // Track the element currently in native fullscreen so we can paint into it.
  const [fsEl, setFsEl] = useState<Element | null>(null);
  useEffect(() => {
    const onChange = () => setFsEl(document.fullscreenElement ?? null);
    document.addEventListener("fullscreenchange", onChange);
    // Safari
    document.addEventListener("webkitfullscreenchange", onChange as EventListener);
    onChange();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange as EventListener);
    };
  }, []);

  if (!user || !data?.watermarkEnabled) return null;

  const u = user as { email?: string | null; id?: number | string };
  const label = (u.email || (u.id != null ? `用户#${u.id}` : "")).toString().slice(0, 64);
  if (!label) return null;

  const bg = watermarkBackground(label);
  const layer = (absolute: boolean) => (
    <div
      aria-hidden
      style={{
        position: absolute ? "absolute" : "fixed",
        inset: 0,
        zIndex: 2147483600,
        pointerEvents: "none",
        backgroundImage: bg,
        backgroundRepeat: "repeat",
        userSelect: "none",
      }}
    />
  );

  return (
    <>
      {layer(false)}
      {/* When something is fullscreen via the Fullscreen API on a container, paint
          inside it too (the page-level layer is hidden behind the fullscreen subtree). */}
      {fsEl ? createPortal(layer(true), fsEl) : null}
    </>
  );
}
