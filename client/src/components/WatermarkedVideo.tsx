import { useRef, type VideoHTMLAttributes } from "react";
import { Maximize2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

/**
 * Drop-in `<video>` that keeps the page-level identity watermark visible in
 * fullscreen. Native `<video>`-element fullscreen renders no DOM children, so a
 * DOM watermark can never overlay it. Instead, when the watermark is enabled we
 * hide the native fullscreen button and fullscreen the WRAPPER container — the
 * global WatermarkOverlay then portals the watermark into that container, so it
 * shows over the playing video in fullscreen.
 *
 * When the watermark feature is OFF (default), this renders a plain `<video>`
 * with identical props — zero behavior/layout change.
 */
export function WatermarkedVideo(props: VideoHTMLAttributes<HTMLVideoElement>) {
  const { user } = useAuth();
  const { data } = trpc.system.mediaProtection.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const on = !!user && !!data?.watermarkEnabled;
  const containerRef = useRef<HTMLDivElement>(null);

  if (!on) return <video {...props} />;

  // Hide the native fullscreen button so users go through our container fullscreen
  // (the only way a DOM watermark can sit over fullscreen video).
  const controlsList = [props.controlsList, "nofullscreen"].filter(Boolean).join(" ");
  const toggleFs = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) { void document.exitFullscreen?.(); return; }
    try { void el.requestFullscreen?.(); } catch { /* ignore */ }
  };

  return (
    <div ref={containerRef} className="wm-video-wrap" style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
      <video {...props} controlsList={controlsList} />
      <button type="button" onClick={toggleFs} title="全屏（含水印）" aria-label="全屏" className="wm-fs-btn">
        <Maximize2 style={{ width: 16, height: 16 }} />
      </button>
    </div>
  );
}
