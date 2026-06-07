import { useRef, useState, type VideoHTMLAttributes } from "react";
import { Maximize2, Repeat } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

/**
 * Drop-in `<video>` with two always-available conveniences overlaid on the player:
 *  • a 循环播放 (loop) toggle, just after the native play control, and
 *  • a watermark-safe 全屏 button when the identity watermark is enabled.
 *
 * Native `<video>`-element fullscreen renders no DOM children, so a DOM watermark
 * can never overlay it. When the watermark is on we hide the native fullscreen
 * button and fullscreen the WRAPPER container instead; the global WatermarkOverlay
 * then portals the watermark into that container so it shows over fullscreen video.
 *
 * The video keeps its incoming className/style unchanged — the wrapper is the same
 * relatively-positioned container already used by the (shipped) watermark path, so
 * layout is preserved.
 */
export function WatermarkedVideo({ block, ...props }: VideoHTMLAttributes<HTMLVideoElement> & { block?: boolean }) {
  const { user } = useAuth();
  const { data } = trpc.system.mediaProtection.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const wm = !!user && !!data?.watermarkEnabled;
  const containerRef = useRef<HTMLDivElement>(null);
  const [loop, setLoop] = useState(false);

  // Hide the native fullscreen button (watermark path only) so users go through our
  // container fullscreen — the only way a DOM watermark can sit over fullscreen video.
  const controlsList = wm ? [props.controlsList, "nofullscreen"].filter(Boolean).join(" ") : props.controlsList;
  const toggleFs = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) { void document.exitFullscreen?.(); return; }
    try { void el.requestFullscreen?.(); } catch { /* ignore */ }
  };

  return (
    <div
      ref={containerRef}
      className="wm-video-wrap"
      style={{ position: "relative", display: block ? "block" : "inline-block", width: block ? "100%" : undefined, lineHeight: 0 }}
    >
      <video {...props} loop={loop} controlsList={controlsList} />
      <button
        type="button"
        onClick={() => setLoop((v) => !v)}
        title={loop ? "循环播放：开（点击关闭）" : "循环播放：关（点击开启）"}
        aria-label="循环播放"
        className="wm-loop-btn nodrag"
        data-on={loop ? "true" : "false"}
      >
        <Repeat style={{ width: 14, height: 14 }} />
      </button>
      {wm && (
        <button type="button" onClick={toggleFs} title="全屏（含水印）" aria-label="全屏" className="wm-fs-btn">
          <Maximize2 style={{ width: 16, height: 16 }} />
        </button>
      )}
    </div>
  );
}
