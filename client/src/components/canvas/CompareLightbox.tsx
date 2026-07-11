import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Columns2, Play, Pause, Volume2, VolumeX } from "lucide-react";
import { MediaImage } from "./MediaImage";
import { mediaFetchUrl } from "@/lib/download";

/**
 * 就地对比查看器（全屏 portal）：不建对比节点，直接在节点预览语境里全屏打开
 * A/B 滑块对比——图/视频均可，双视频同步播放（A 主时钟，B 偏差 >0.3s 校正）。
 * 任何地方调 openNodeCompare(a, b) 即可打开；Esc / × / 点背景关闭。
 * 用法与 NodeImageLightbox 同款：Canvas 挂一个 <CompareLightbox/>。
 */
export function openNodeCompare(aUrl: string, bUrl: string) {
  window.dispatchEvent(new CustomEvent("canvas:compare-lightbox", { detail: { aUrl, bUrl } }));
}

const isVideoUrl = (u?: string) => !!u && /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u);
const tag: React.CSSProperties = { fontSize: 12, fontWeight: 700, padding: "2px 9px", borderRadius: 7, background: "rgba(0,0,0,0.65)", color: "#fff", pointerEvents: "none" };

export function CompareLightbox() {
  const [pair, setPair] = useState<{ aUrl: string; bUrl: string } | null>(null);
  const [pos, setPosState] = useState(0.5);
  const [playing, setPlaying] = useState(false);
  // 声道：两路同播只出一路声避免混叠——默认 A 路，可切 B / 静音。
  const [audio, setAudio] = useState<"a" | "b" | "off">("a");
  const openRef = useRef(false);
  openRef.current = pair !== null;
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const open = (e: Event) => { setPair((e as CustomEvent<{ aUrl: string; bUrl: string }>).detail); setPosState(0.5); setPlaying(false); };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !openRef.current) return;
      e.stopImmediatePropagation();
      setPair(null);
    };
    window.addEventListener("canvas:compare-lightbox", open);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("canvas:compare-lightbox", open); window.removeEventListener("keydown", esc, true); };
  }, []);

  const setPos = useCallback((clientX: number) => {
    const el = boxRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPosState(Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width))));
  }, []);

  if (!pair) return null;
  const { aUrl, bUrl } = pair;
  const anyVideo = isVideoUrl(aUrl) || isVideoUrl(bUrl);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const va = aRef.current, vb = bRef.current;
    if (!va && !vb) return;
    if (playing) { va?.pause(); vb?.pause(); setPlaying(false); }
    else { void va?.play(); void vb?.play(); setPlaying(true); }
  };
  const onATime = () => {
    const va = aRef.current, vb = bRef.current;
    if (va && vb && Math.abs(va.currentTime - vb.currentTime) > 0.3) vb.currentTime = va.currentTime;
  };
  const renderMedia = (url: string, label: "A" | "B", ref: React.RefObject<HTMLVideoElement | null>, overlay?: boolean) => {
    const common: React.CSSProperties = overlay
      ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }
      : { display: "block", maxWidth: "88vw", maxHeight: "84vh", width: "auto", height: "auto", pointerEvents: "none" };
    if (isVideoUrl(url)) {
      const muted = label === "A" ? audio !== "a" : audio !== "b";
      return <video ref={ref} src={mediaFetchUrl(url)} muted={muted} loop playsInline preload="metadata" onTimeUpdate={label === "A" ? onATime : undefined} onEnded={() => setPlaying(false)} style={common} />;
    }
    return <MediaImage src={url} alt={label} draggable={false} style={common} />;
  };
  const cycleAudio = (e: React.MouseEvent) => {
    e.stopPropagation();
    setAudio((v) => (v === "a" ? "b" : v === "b" ? "off" : "a"));
  };

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) setPair(null); }}
      style={{ position: "fixed", inset: 0, zIndex: 10000, background: "oklch(0 0 0 / 0.86)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        ref={boxRef}
        className="nodrag"
        style={{ position: "relative", borderRadius: 12, overflow: "hidden", cursor: "ew-resize", userSelect: "none", touchAction: "none", boxShadow: "0 24px 80px oklch(0 0 0 / 0.6)" }}
        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); dragRef.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setPos(e.clientX); }}
        onPointerMove={(e) => { if (dragRef.current) setPos(e.clientX); }}
        onPointerUp={(e) => { dragRef.current = false; (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); }}
      >
        {renderMedia(aUrl, "A", aRef)}
        <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 0 ${pos * 100}%)`, background: "#000" }}>
          {renderMedia(bUrl, "B", bRef, true)}
        </div>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos * 100}%`, width: 2, background: "#fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.45)", transform: "translateX(-1px)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "50%", left: `${pos * 100}%`, transform: "translate(-50%,-50%)", width: 34, height: 34, borderRadius: 99, background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <Columns2 size={16} color="#333" />
        </div>
        <span style={{ position: "absolute", left: 10, top: 10, ...tag }}>A · 当前</span>
        <span style={{ position: "absolute", right: 10, top: 10, ...tag }}>B</span>
        {anyVideo && (
          <div style={{ position: "absolute", left: 12, bottom: 12, display: "flex", gap: 8 }}>
            <button onClick={togglePlay} onPointerDown={(e) => e.stopPropagation()} title={playing ? "暂停（两路同步）" : "同步播放两路视频"}
              style={{ width: 38, height: 38, borderRadius: 99, background: "rgba(0,0,0,0.62)", border: "1px solid rgba(255,255,255,0.28)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)" }}>
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            {/* 声道切换：A声 → B声 → 静音（两路同播只出一路声，避免混叠） */}
            <button onClick={cycleAudio} onPointerDown={(e) => e.stopPropagation()}
              title={audio === "a" ? "当前：A 路声音（点击切 B 路）" : audio === "b" ? "当前：B 路声音（点击静音）" : "当前：静音（点击切 A 路）"}
              style={{ height: 38, padding: "0 12px", borderRadius: 99, background: "rgba(0,0,0,0.62)", border: "1px solid rgba(255,255,255,0.28)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, backdropFilter: "blur(6px)", fontSize: 12, fontWeight: 700 }}>
              {audio === "off" ? <VolumeX size={14} /> : <Volume2 size={14} />}
              {audio === "a" ? "A" : audio === "b" ? "B" : "静音"}
            </button>
          </div>
        )}
      </div>
      <button
        onClick={() => setPair(null)}
        title="关闭（Esc）"
        style={{ position: "fixed", top: 18, right: 18, width: 38, height: 38, borderRadius: 10, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)" }}
      >
        <X size={17} />
      </button>
    </div>,
    document.body,
  );
}
