import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Check, Download } from "lucide-react";
import { makeImageProxyFallback } from "@/lib/utils";

interface ImageLightboxProps {
  images: string[];
  currentIndex: number;
  selectedUrl?: string;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onSelect: (url: string) => void;
}

const accent = "oklch(0.72 0.20 330)";

export function ImageLightbox({
  images,
  currentIndex,
  selectedUrl,
  onClose,
  onNavigate,
  onSelect,
}: ImageLightboxProps) {
  const currentUrl = images[currentIndex];
  const isSelected = currentUrl === selectedUrl;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < images.length - 1;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onNavigate(currentIndex - 1);
      if (e.key === "ArrowRight" && hasNext) onNavigate(currentIndex + 1);
      if (e.key === "Enter") onSelect(currentUrl);
    },
    [onClose, hasPrev, hasNext, currentIndex, onNavigate, onSelect, currentUrl]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleDownload = () => {
    const a = document.createElement("a");
    const filename = `generated-${currentIndex + 1}.png`;
    if (currentUrl.startsWith("/") || currentUrl.startsWith(window.location.origin)) {
      a.href = currentUrl;
    } else {
      a.href = `/api/image-proxy?url=${encodeURIComponent(currentUrl)}&download=1`;
    }
    a.download = filename;
    a.click();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.88)" }}
      onClick={onClose}
    >
      {/* Main image container */}
      <div
        className="relative flex items-center justify-center"
        style={{ maxWidth: "90vw", maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
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
            transition: "border-color 150ms ease",
          }}
          draggable={false}
          onError={makeImageProxyFallback(currentUrl)}
        />

        {/* Top bar */}
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 rounded-t-lg"
          style={{ background: "oklch(0 0 0 / 0.6)", backdropFilter: "blur(8px)" }}
        >
          <span style={{ fontSize: 12, color: "var(--c-t3)" }}>
            {currentIndex + 1} / {images.length}
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
            {/* Select */}
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
