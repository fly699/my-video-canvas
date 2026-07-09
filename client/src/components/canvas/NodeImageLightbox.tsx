import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { mediaFetchUrl } from "@/lib/download";

/** 打开画布级图片放大预览（任意节点的参考图/结果图点击调用）。 */
export function openNodeImage(src: string) {
  if (src) window.dispatchEvent(new CustomEvent("canvas:image-lightbox", { detail: src }));
}

async function downloadImage(src: string) {
  const name = `image-${Date.now()}.png`;
  try {
    if (src.startsWith("data:") || src.startsWith("blob:")) {
      const a = document.createElement("a"); a.href = src; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    const res = await fetch(mediaFetchUrl(src, true, "image"));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    window.open(mediaFetchUrl(src, true, "image"), "_blank", "noopener,noreferrer");
  }
}

/** 画布级全屏图片预览层（下载 + 关闭）。在 Canvas 里挂载一个。 */
export function NodeImageLightbox() {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const open = (e: Event) => setSrc((e as CustomEvent<string>).detail);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); setSrc(null); } };
    window.addEventListener("canvas:image-lightbox", open);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("canvas:image-lightbox", open); window.removeEventListener("keydown", esc, true); };
  }, []);
  if (!src) return null;
  const btn: React.CSSProperties = {
    width: 38, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff", cursor: "pointer", backdropFilter: "blur(6px)",
  };
  return createPortal(
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) setSrc(null); }} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100000,
      display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: 16, right: 16, display: "flex", gap: 8 }}>
        <button onClick={() => downloadImage(src)} title="下载图片" style={btn}><Download size={18} /></button>
        <button onClick={() => setSrc(null)} title="关闭" style={btn}><X size={18} /></button>
      </div>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "94vw", maxHeight: "94vh", borderRadius: 8, boxShadow: "0 10px 50px rgba(0,0,0,0.6)", cursor: "default", objectFit: "contain" }} />
    </div>,
    document.body,
  );
}
