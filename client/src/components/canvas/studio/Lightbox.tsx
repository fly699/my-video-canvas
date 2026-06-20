import { useEffect } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { X, Download, ChevronLeft, ChevronRight, Star, RefreshCw } from "lucide-react";
import { downloadMedia } from "../../../lib/download";
import { useCanvasStore } from "../../../hooks/useCanvasStore";

// Global, studio-only fullscreen media viewer. A node's hero opens it with its result
// media (one or many); the viewer is rendered once at the canvas root. Presentation
// only — it reads URLs already in the node payload, never mutates state.
interface LightboxState {
  urls: string[];
  index: number;
  type: "image" | "video";
  title: string;
  nodeId: string | null;   // source node → enables 设为封面 / 重新生成
  open: (urls: string[], index: number, type: "image" | "video", title?: string, nodeId?: string) => void;
  close: () => void;
  step: (delta: number) => void;
  goto: (i: number) => void;
}

export const useLightbox = create<LightboxState>((set) => ({
  urls: [],
  index: 0,
  type: "image",
  title: "",
  nodeId: null,
  open: (urls, index, type, title = "", nodeId) => set({ urls, index: Math.max(0, Math.min(index, urls.length - 1)), type, title, nodeId: nodeId ?? null }),
  close: () => set({ urls: [] }),
  goto: (i) => set((s) => (i >= 0 && i < s.urls.length ? { index: i } : s)),
  step: (delta) => set((s) => {
    if (s.urls.length < 2) return s;
    const n = (s.index + delta + s.urls.length) % s.urls.length;
    return { index: n };
  }),
}));

const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u);

export function Lightbox() {
  const { urls, index, type, title, nodeId, close, step, goto } = useLightbox();
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
  // 设为封面: make the viewed image the node's primary `imageUrl` (what downstream uses).
  // Only meaningful for a multi-result image node.
  const canSetCover = !!nodeId && !asVideo && multi;
  const setCover = () => {
    if (!nodeId) return;
    useCanvasStore.getState().updateNodeData(nodeId, { imageUrl: url });
    toast.success("已设为该节点封面（下游将使用此图）", { duration: 1400 });
  };
  const regen = () => {
    if (!nodeId) return;
    useCanvasStore.getState().requestRun(null, [nodeId]);
    toast.success("已重新生成", { duration: 1200 });
    close();
  };

  return (
    <div
      onClick={close}
      style={{ position: "fixed", inset: 0, zIndex: 100060, background: "oklch(0 0 0 / 0.86)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}
    >
      {/* top-right actions */}
      <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: 16, right: 16, display: "flex", gap: 8, cursor: "default" }}>
        {canSetCover && <button onClick={setCover} title="设为封面（下游使用此图）" style={btn}><Star size={16} /></button>}
        {nodeId && <button onClick={regen} title="重新生成此节点" style={btn}><RefreshCw size={16} /></button>}
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
        {(() => {
          const mediaMaxH = multi ? "72vh" : "86vh";
          return asVideo
            ? <video src={url} controls autoPlay style={{ maxWidth: "92vw", maxHeight: mediaMaxH, borderRadius: 12, boxShadow: "0 20px 60px oklch(0 0 0 / 0.6)" }} />
            : <img src={url} alt={title || "预览"} style={{ maxWidth: "92vw", maxHeight: mediaMaxH, objectFit: "contain", borderRadius: 12, boxShadow: "0 20px 60px oklch(0 0 0 / 0.6)" }} />;
        })()}
        {multi && <div style={{ fontSize: 12, color: "oklch(0.85 0 0)", fontWeight: 600 }}>{index + 1} / {urls.length}</div>}
      </div>

      {/* Filmstrip: thumbnails of all results, click to jump, current highlighted. */}
      {multi && (
        <div onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", bottom: 14, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6,
            padding: 8, borderRadius: 12, background: "oklch(0 0 0 / 0.45)", border: "1px solid oklch(1 0 0 / 0.12)",
            maxWidth: "92vw", overflowX: "auto" }}>
          {urls.map((u, i) => (
            <button key={i} onClick={() => goto(i)} title={`第 ${i + 1} 张`}
              style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", flexShrink: 0, padding: 0, cursor: "pointer", background: "#000",
                border: i === index ? "2px solid var(--ui-accent, #fff)" : "2px solid transparent" }}>
              {isVideoUrl(u)
                ? <video src={u} muted style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: i === index ? 1 : 0.55 }} />
                : <img src={u} alt={`${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: i === index ? 1 : 0.55 }} />}
            </button>
          ))}
        </div>
      )}
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
