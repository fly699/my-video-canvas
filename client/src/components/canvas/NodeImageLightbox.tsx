import { useEffect, useRef, useState } from "react";
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
  // ⚠ 该组件全局常驻。Esc 只在 lightbox「已打开」时拦截——原来无条件 stopImmediatePropagation
  //  会把所有后注册的 window capture Esc 监听（风格库/运镜库/快速剪辑条等）全部吞掉。
  const openRef = useRef(false);
  openRef.current = src !== null; // 每次渲染同步，覆盖所有打开/关闭路径（遮罩点击、按钮等）
  useEffect(() => {
    const open = (e: Event) => setSrc((e as CustomEvent<string>).detail);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !openRef.current) return;
      e.stopImmediatePropagation();
      setSrc(null);
    };
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
      {/* 用户反馈（2026-07）：放大不满屏——改 100vw/100vh contain 等比充满（小图也放大）。
          图片元素铺满后点「黑边」落在 img 上，按 contain 实绘区域判定 letterbox 点击关闭。 */}
      <img src={src} alt="" style={{ width: "100vw", height: "100vh", cursor: "default", objectFit: "contain" }}
        onClick={(e) => {
          e.stopPropagation();
          const img = e.currentTarget;
          const r = img.getBoundingClientRect();
          const nw = img.naturalWidth, nh = img.naturalHeight;
          if (!nw || !nh) return;
          const s = Math.min(r.width / nw, r.height / nh);
          const dw = nw * s, dh = nh * s;
          const x0 = r.left + (r.width - dw) / 2, y0 = r.top + (r.height - dh) / 2;
          if (e.clientX < x0 || e.clientX > x0 + dw || e.clientY < y0 || e.clientY > y0 + dh) setSrc(null);
        }} />
    </div>,
    document.body,
  );
}
