import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Paintbrush } from "lucide-react";

/**
 * Inpaint mask painter. Shows the reference image; the user paints over the
 * areas to regenerate. A hidden mask canvas (black bg, white strokes) is kept at
 * the image's natural resolution so it matches the uploaded reference exactly,
 * then exported as a PNG data URL via onExport.
 */
export function MaskCanvas({
  imageUrl,
  onExport,
  accent,
}: {
  imageUrl: string;
  onExport: (dataUrl: string) => void;
  accent: string;
}) {
  const viewRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [brush, setBrush] = useState(48);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Load the reference at natural resolution; size both canvases to match.
  useEffect(() => {
    setReady(false); setDirty(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const mask = document.createElement("canvas");
      mask.width = img.naturalWidth; mask.height = img.naturalHeight;
      const mctx = mask.getContext("2d")!;
      mctx.fillStyle = "#000"; mctx.fillRect(0, 0, mask.width, mask.height);
      maskRef.current = mask;
      const view = viewRef.current;
      if (view) { view.width = img.naturalWidth; view.height = img.naturalHeight; }
      setReady(true);
      render();
    };
    img.onerror = () => setReady(false);
    img.src = imageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  const render = useCallback(() => {
    const view = viewRef.current, img = imgRef.current, mask = maskRef.current;
    if (!view || !img || !mask) return;
    const ctx = view.getContext("2d")!;
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.drawImage(img, 0, 0);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(mask, 0, 0);
    ctx.globalAlpha = 1;
  }, []);

  const toMaskCoords = (e: React.PointerEvent) => {
    const view = viewRef.current!;
    const rect = view.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * view.width,
      y: ((e.clientY - rect.top) / rect.height) * view.height,
    };
  };

  const paint = (x: number, y: number) => {
    const mask = maskRef.current; if (!mask) return;
    const mctx = mask.getContext("2d")!;
    mctx.strokeStyle = "#fff"; mctx.fillStyle = "#fff";
    mctx.lineCap = "round"; mctx.lineJoin = "round"; mctx.lineWidth = brush;
    if (last.current) {
      mctx.beginPath(); mctx.moveTo(last.current.x, last.current.y); mctx.lineTo(x, y); mctx.stroke();
    }
    mctx.beginPath(); mctx.arc(x, y, brush / 2, 0, Math.PI * 2); mctx.fill();
    last.current = { x, y };
    render();
  };

  const onDown = (e: React.PointerEvent) => {
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true; last.current = null;
    const { x, y } = toMaskCoords(e); paint(x, y); setDirty(true);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const { x, y } = toMaskCoords(e); paint(x, y);
  };
  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false; last.current = null;
    const mask = maskRef.current;
    if (mask) onExport(mask.toDataURL("image/png"));
  };

  const clear = () => {
    const mask = maskRef.current; if (!mask) return;
    const mctx = mask.getContext("2d")!;
    mctx.fillStyle = "#000"; mctx.fillRect(0, 0, mask.width, mask.height);
    render(); setDirty(false); onExport("");
  };

  return (
    <div className="flex flex-col gap-1.5">
      <canvas
        ref={viewRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        className="nodrag nowheel"
        style={{ width: "100%", height: "auto", maxHeight: 220, objectFit: "contain", borderRadius: 8, border: "1px solid var(--c-bd2)", cursor: "crosshair", touchAction: "none", background: "var(--c-canvas)" }}
      />
      <div className="flex items-center gap-2">
        <Paintbrush style={{ width: 11, height: 11, color: "var(--c-t4)" }} />
        <input type="range" min={8} max={120} step={2} value={brush} onChange={(e) => setBrush(Number(e.target.value))} className="nodrag" style={{ flex: 1, accentColor: accent }} />
        <span style={{ fontSize: 9.5, color: "var(--c-t4)", width: 26 }}>{brush}px</span>
        <button onClick={clear} disabled={!dirty} className="nodrag flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px]" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: dirty ? "var(--c-t3)" : "var(--c-t4)", cursor: dirty ? "pointer" : "not-allowed" }}>
          <Eraser style={{ width: 10, height: 10 }} /> 清除
        </button>
      </div>
      <p style={{ fontSize: 9.5, color: "var(--c-t4)", margin: 0 }}>在图上涂抹要重绘的区域（白色＝重绘）。</p>
    </div>
  );
}
