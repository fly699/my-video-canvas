import { useEffect } from "react";
import { create } from "zustand";
import { X, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { downloadMedia } from "../../../lib/download";

// Global, studio-only fullscreen media viewer. A node's hero opens it with its result
// media (one or many); the viewer is rendered once at the canvas root. Presentation
// only — it reads URLs already in the node payload, never mutates state.
interface LightboxState {
  urls: string[];
  index: number;
  type: "image" | "video";
  title: string;
  open: (urls: string[], index: number, type: "image" | "video", title?: string) => void;
  close: () => void;
  step: (delta: number) => void;
}

export const useLightbox = create<LightboxState>((set) => ({
  urls: [],
  index: 0,
  type: "image",
  title: "",
  open: (urls, index, type, title = "") => set({ urls, index: Math.max(0, Math.min(index, urls.length - 1)), type, title }),
  close: () => set({ urls: [] }),
  step: (delta) => set((s) => {
    if (s.urls.length < 2) return s;
    const n = (s.index + delta + s.urls.length) % s.urls.length;
    return { index: n };
  }),
}));

const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u);

export function Lightbox() {
  const { urls, index, type, title, close, step } = useLightbox();
  const openLb = urls.length > 0;

  useEffect(() => {
    if (!openLb) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openLb, close, step]);

  if (!openLb) return null;
  const url = urls[index];
  // Trust the explicit type, but fall back to the URL extension (mixed lists are rare).
  const asVideo = type === "video" || isVideoUrl(url);
  const multi = urls.length > 1;

  return (
    <div
      onClick={close}
      style={{ position: "fixed", inset: 0, zIndex: 100060, background: "oklch(0 0 0 / 0.86)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}
    >
      {/* top-right actions */}
      <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: 16, right: 16, display: "flex", gap: 8, cursor: "default" }}>
        <button onClick={() => void downloadMedia(url, `${title || (asVideo ? "video" : "image")}.${asVideo ? "mp4" : "png"}`, asVideo ? "video" : "image")}
          title="下载" style={btn}><Download size={17} /></button>
        <button onClick={close} title="关闭 (Esc)" style={btn}><X size={17} /></button>
      </div>

      {/* prev / next */}
      {multi && (
        <>
          <button onClick={(e) => { e.stopPropagation(); step(-1); }} title="上一张 (←)" style={{ ...navBtn, left: 16 }}><ChevronLeft size={24} /></button>
          <button onClick={(e) => { e.stopPropagation(); step(1); }} title="下一张 (→)" style={{ ...navBtn, right: 16 }}><ChevronRight size={24} /></button>
        </>
      )}

      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: "92vw", maxHeight: "90vh", cursor: "default", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        {asVideo
          ? <video src={url} controls autoPlay style={{ maxWidth: "92vw", maxHeight: "84vh", borderRadius: 12, boxShadow: "0 20px 60px oklch(0 0 0 / 0.6)" }} />
          : <img src={url} alt={title || "预览"} style={{ maxWidth: "92vw", maxHeight: "84vh", objectFit: "contain", borderRadius: 12, boxShadow: "0 20px 60px oklch(0 0 0 / 0.6)" }} />}
        {multi && <div style={{ fontSize: 12, color: "oklch(0.85 0 0)", fontWeight: 600 }}>{index + 1} / {urls.length}</div>}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  width: 38, height: 38, borderRadius: 10, border: "1px solid oklch(1 0 0 / 0.18)",
  background: "oklch(1 0 0 / 0.10)", color: "#fff", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};
const navBtn: React.CSSProperties = {
  position: "fixed", top: "50%", transform: "translateY(-50%)",
  width: 44, height: 64, borderRadius: 12, border: "1px solid oklch(1 0 0 / 0.16)",
  background: "oklch(1 0 0 / 0.08)", color: "#fff", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};
