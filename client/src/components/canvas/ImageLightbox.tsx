import { useEffect, useCallback, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Check, Download } from "lucide-react";
import { makeImageProxyFallback } from "@/lib/utils";
import { downloadMedia } from "@/lib/download";

interface ImageLightboxProps {
  images: string[];
  currentIndex: number;
  selectedUrl?: string;
  onClose: () => void;
  onNavigate: (index: number) => void;
  /** Optional: when omitted, the "select this image" action is hidden — the
   *  lightbox becomes a plain zoomable viewer (asset / reference-image previews). */
  onSelect?: (url: string) => void;
}

const accent = "oklch(0.72 0.20 330)";
const MIN_SCALE = 1;
const MAX_SCALE = 8;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function ImageLightbox({
  images,
  currentIndex,
  selectedUrl,
  onClose,
  onNavigate,
  onSelect,
}: ImageLightboxProps) {
  const currentUrl = images[currentIndex];
  const isSelected = !!onSelect && currentUrl === selectedUrl;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < images.length - 1;

  // ── Zoom / pan state (scroll wheel to zoom toward cursor, drag to pan) ──
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const imgWrapRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ mx: number; my: number; tx: number; ty: number } | null>(null);

  const resetZoom = useCallback(() => { setScale(1); setTx(0); setTy(0); }, []);
  // Reset when switching image.
  useEffect(() => { resetZoom(); }, [currentIndex, resetZoom]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = imgWrapRef.current?.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setScale((prev) => {
      const next = clamp(prev * factor, MIN_SCALE, MAX_SCALE);
      if (next === prev) return prev;
      if (rect) {
        // Keep the point under the cursor stationary while zooming.
        const cx = e.clientX - (rect.left + rect.width / 2);
        const cy = e.clientY - (rect.top + rect.height / 2);
        const ratio = next / prev;
        setTx((px) => (next === MIN_SCALE ? 0 : px - cx * (ratio - 1)));
        setTy((py) => (next === MIN_SCALE ? 0 : py - cy * (ratio - 1)));
      }
      return next;
    });
  }, []);

  const onImgMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault(); e.stopPropagation();
    panRef.current = { mx: e.clientX, my: e.clientY, tx, ty };
    const move = (ev: MouseEvent) => {
      const p = panRef.current; if (!p) return;
      setTx(p.tx + (ev.clientX - p.mx));
      setTy(p.ty + (ev.clientY - p.my));
    };
    const up = () => { panRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [scale, tx, ty]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onNavigate(currentIndex - 1);
      if (e.key === "ArrowRight" && hasNext) onNavigate(currentIndex + 1);
      if (e.key === "Enter") onSelect?.(currentUrl);
      if ((e.key === "+" || e.key === "=")) setScale((s) => clamp(s * 1.2, MIN_SCALE, MAX_SCALE));
      if (e.key === "-") setScale((s) => { const n = clamp(s / 1.2, MIN_SCALE, MAX_SCALE); if (n === MIN_SCALE) { setTx(0); setTy(0); } return n; });
      if (e.key === "0") resetZoom();
    },
    [onClose, hasPrev, hasNext, currentIndex, onNavigate, onSelect, currentUrl, resetZoom]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleDownload = () => {
    void downloadMedia(currentUrl, `generated-${currentIndex + 1}.png`, "image");
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.88)" }}
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Main image container */}
      <div
        ref={imgWrapRef}
        className="relative flex items-center justify-center"
        style={{ maxWidth: "90vw", maxHeight: "90vh", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
      >
        <img
          src={currentUrl}
          alt={`preview-${currentIndex}`}
          style={{
            maxWidth: "85vw",
            maxHeight: "85vh",
            objectFit: "contain",
            borderRadius: 8,
            boxShadow: "0 0 60px oklch(0 0 0 / 0.6)",
            border: isSelected ? `2px solid ${accent}` : "2px solid var(--c-bd3)",
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transition: panRef.current ? "none" : "transform 100ms ease, border-color 150ms ease",
            cursor: scale > 1 ? (panRef.current ? "grabbing" : "grab") : "zoom-in",
          }}
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={onImgMouseDown}
          onDoubleClick={(e) => { e.stopPropagation(); scale > 1 ? resetZoom() : setScale(2); }}
          onError={makeImageProxyFallback(currentUrl)}
        />

        {/* Top bar */}
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 rounded-t-lg"
          style={{ background: "oklch(0 0 0 / 0.6)", backdropFilter: "blur(8px)" }}
        >
          <span style={{ fontSize: 12, color: "var(--c-t3)" }}>
            {currentIndex + 1} / {images.length}
            {scale > 1.01 && (
              <span style={{ marginLeft: 8, color: "var(--c-t2)" }} title="滚轮缩放 · 双击复位 · 拖拽平移">
                {Math.round(scale * 100)}%
              </span>
            )}
            {isSelected && (
              <span style={{ marginLeft: 8, color: accent, fontWeight: 600 }}>· 已选择</span>
            )}
          </span>
          <div className="flex items-center gap-1.5">
            {/* Download */}
            <button
              onClick={handleDownload}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all"
              style={{
                background: "var(--c-bd1)",
                borderWidth: 1, borderStyle: "solid",
                borderColor: "var(--c-bd3)",
                color: "var(--c-t2)",
                cursor: "pointer",
              }}
              title="下载此图像"
            >
              <Download style={{ width: 12, height: 12 }} />
              下载
            </button>
            {/* Select (only when a select handler is provided) */}
            {onSelect && (
              <button
                onClick={() => onSelect(currentUrl)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all"
                style={{
                  background: isSelected ? `oklch(0.72 0.20 330 / 0.2)` : "var(--c-bd1)",
                  borderWidth: 1, borderStyle: "solid",
                  borderColor: isSelected ? `oklch(0.72 0.20 330 / 0.5)` : "var(--c-bd3)",
                  color: isSelected ? accent : "var(--c-t2)",
                  cursor: "pointer",
                }}
              >
                <Check style={{ width: 12, height: 12 }} />
                {isSelected ? "已选择" : "选择此图"}
              </button>
            )}
            {/* Close */}
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-md transition-all"
              style={{
                width: 28, height: 28,
                background: "var(--c-bd1)",
                borderWidth: 1, borderStyle: "solid",
                borderColor: "var(--c-bd3)",
                color: "var(--c-t3)",
                cursor: "pointer",
              }}
            >
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>

        {/* Thumbnail strip */}
        {images.length > 1 && (
          <div
            className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1.5 px-3 py-2 rounded-b-lg"
            style={{ background: "oklch(0 0 0 / 0.6)", backdropFilter: "blur(8px)" }}
          >
            {images.map((url, idx) => (
              <button
                key={idx}
                onClick={() => onNavigate(idx)}
                style={{
                  width: 40, height: 40,
                  borderRadius: 4,
                  overflow: "hidden",
                  borderWidth: 2, borderStyle: "solid",
                  borderColor: idx === currentIndex ? accent : (url === selectedUrl ? `oklch(0.72 0.20 330 / 0.5)` : "transparent"),
                  opacity: idx === currentIndex ? 1 : 0.6,
                  cursor: "pointer",
                  transition: "all 150ms ease",
                  padding: 0,
                  flexShrink: 0,
                }}
              >
                <img src={url} alt={`thumb-${idx}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} onError={makeImageProxyFallback(url)} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Prev / Next arrows */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(currentIndex - 1); }}
          className="absolute left-4 flex items-center justify-center rounded-full transition-all"
          style={{
            width: 44, height: 44,
            background: "oklch(0.14 0.007 260 / 0.8)",
            borderWidth: 1, borderStyle: "solid",
            borderColor: "var(--c-bd3)",
            color: "var(--c-t2)",
            cursor: "pointer",
            backdropFilter: "blur(4px)",
          }}
        >
          <ChevronLeft style={{ width: 20, height: 20 }} />
        </button>
      )}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(currentIndex + 1); }}
          className="absolute right-4 flex items-center justify-center rounded-full transition-all"
          style={{
            width: 44, height: 44,
            background: "oklch(0.14 0.007 260 / 0.8)",
            borderWidth: 1, borderStyle: "solid",
            borderColor: "var(--c-bd3)",
            color: "var(--c-t2)",
            cursor: "pointer",
            backdropFilter: "blur(4px)",
          }}
        >
          <ChevronRight style={{ width: 20, height: 20 }} />
        </button>
      )}
    </div>,
    document.body
  );
}
