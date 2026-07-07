import { useEffect, useState, type VideoHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Repeat, X } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

/**
 * Drop-in `<video>` with two always-available conveniences overlaid on the player:
 *  • a 循环播放 (loop) toggle, just after the native play control, and
 *  • a watermark-safe 全屏 (放大预览) button when the identity watermark is enabled.
 *
 * Native `<video>`-element fullscreen renders no DOM children, so a DOM watermark
 * can never overlay it. When the watermark is on we hide the native fullscreen
 * button and instead open an **in-app enlarged preview** (a fixed overlay that fills
 * the viewport but stays inside the page — NOT the browser Fullscreen API). The
 * global WatermarkOverlay's page-level layer (position:fixed, z-index 2147483600)
 * sits ABOVE this overlay, so the identity watermark is painted over the enlarged
 * video automatically — no OS/browser fullscreen (「网页全屏」) needed.
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
  const [loop, setLoop] = useState(false);
  const [big, setBig] = useState(false);

  // 关闭放大预览：Esc。
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBig(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [big]);

  // 水印开启时禁用原生 <video> 全屏（原生全屏不渲染 DOM 子节点，水印盖不上）——统一走应用内放大预览。
  const controlsList = wm ? [props.controlsList, "nofullscreen"].filter(Boolean).join(" ") : props.controlsList;

  return (
    <div
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
        <button type="button" onClick={() => setBig(true)} title="放大预览（含水印）" aria-label="放大预览" className="wm-fs-btn nodrag">
          <Maximize2 style={{ width: 16, height: 16 }} />
        </button>
      )}
      {big && createPortal(
        <div
          onClick={() => setBig(false)}
          style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <video
            src={props.src}
            poster={props.poster}
            controls
            autoPlay
            loop={loop}
            controlsList={controlsList}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "96vw", maxHeight: "92vh", background: "#000", borderRadius: 8 }}
          />
          <button
            type="button"
            onClick={() => setBig(false)}
            aria-label="关闭"
            style={{ position: "fixed", top: 16, right: 16, width: 40, height: 40, borderRadius: 999, background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <X style={{ width: 20, height: 20 }} />
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
