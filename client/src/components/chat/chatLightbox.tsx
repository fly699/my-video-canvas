import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { mediaFetchUrl } from "@/lib/download";

/** 触发图片放大预览（任意图片 onClick 调用）。 */
export function openLightbox(src: string) {
  window.dispatchEvent(new CustomEvent("chat:lightbox", { detail: src }));
}

/** Download an image src locally. data:/blob: URLs download directly; remote / relative
 *  (/manus-storage) paths go through the media proxy's download URL to avoid CORS. */
async function downloadImage(src: string) {
  const name = `image-${Date.now()}.png`;
  try {
    if (src.startsWith("data:") || src.startsWith("blob:")) {
      const a = document.createElement("a");
      a.href = src; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    const res = await fetch(mediaFetchUrl(src, true, "image"));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    // Fallback: open the proxied download URL in a new tab.
    window.open(mediaFetchUrl(src, true, "image"), "_blank");
  }
}

/** 全屏图片预览层；点击背景关闭。每个 ChatProvider 渲染一个。 */
export function Lightbox() {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: Event) => setSrc((e as CustomEvent<string>).detail);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setSrc(null); };
    window.addEventListener("chat:lightbox", h);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("chat:lightbox", h); window.removeEventListener("keydown", esc); };
  }, []);
  if (!src) return null;
  const btn: React.CSSProperties = {
    width: 38, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff", cursor: "pointer",
    backdropFilter: "blur(6px)",
  };
  return (
    <div onClick={() => setSrc(null)} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 3000,
      display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out",
    }}>
      {/* Toolbar — download + close (stop propagation so they don't close the layer) */}
      <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: 16, right: 16, display: "flex", gap: 8, zIndex: 1 }}>
        <button onClick={() => downloadImage(src)} title="下载图片" style={btn}><Download size={18} /></button>
        <button onClick={() => setSrc(null)} title="关闭" style={btn}><X size={18} /></button>
      </div>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "94vw", maxHeight: "94vh", borderRadius: 8, boxShadow: "0 10px 50px rgba(0,0,0,0.6)", cursor: "default" }} />
    </div>
  );
}
