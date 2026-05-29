import { useEffect, useState } from "react";

/** 触发图片放大预览（任意图片 onClick 调用）。 */
export function openLightbox(src: string) {
  window.dispatchEvent(new CustomEvent("chat:lightbox", { detail: src }));
}

/** 全屏图片预览层；点击任意处关闭。每个 ChatProvider 渲染一个。 */
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
  return (
    <div onClick={() => setSrc(null)} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 3000,
      display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out",
    }}>
      <img src={src} alt="" style={{ maxWidth: "94vw", maxHeight: "94vh", borderRadius: 8, boxShadow: "0 10px 50px rgba(0,0,0,0.6)" }} />
    </div>
  );
}
