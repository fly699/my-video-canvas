import { useRef } from "react";
import { usePersistentState } from "../../hooks/usePersistentState";
import { AssetPanel } from "./AssetPanel";

interface Box { x: number; y: number; w: number; h: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const MIN_W = 260;
const MIN_H = 320;

/**
 * Floating, draggable, resizable container for the asset library — drag by the
 * panel header, resize from the bottom-right corner. Position/size persist across
 * sessions. Pointer events are stopped from reaching the React Flow canvas so
 * interacting with the panel never pans/zooms the board.
 */
export function FloatingAssetPanel({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const [box, setBox] = usePersistentState<Box>(
    "ui:asset-panel:v1",
    {
      x: Math.max(16, (typeof window !== "undefined" ? window.innerWidth : 1200) - 360),
      y: 84,
      w: 320,
      h: 560,
    },
    { validate: (p) => (p && typeof p === "object" && "x" in p && "w" in p ? (p as Box) : null) },
  );
  const dragRef = useRef<{ mx: number; my: number; x: number; y: number } | null>(null);
  const rezRef = useRef<{ mx: number; my: number; w: number; h: number } | null>(null);

  function onHeaderDown(e: React.MouseEvent) {
    // Ignore clicks on interactive header controls (e.g. the close button).
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    dragRef.current = { mx: e.clientX, my: e.clientY, x: box.x, y: box.y };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      setBox((b) => ({
        ...b,
        x: clamp(d.x + ev.clientX - d.mx, 0, window.innerWidth - 120),
        y: clamp(d.y + ev.clientY - d.my, 0, window.innerHeight - 48),
      }));
    };
    const up = () => { dragRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function onResizeDown(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    rezRef.current = { mx: e.clientX, my: e.clientY, w: box.w, h: box.h };
    const move = (ev: MouseEvent) => {
      const r = rezRef.current; if (!r) return;
      setBox((b) => ({
        ...b,
        w: clamp(r.w + (ev.clientX - r.mx), MIN_W, window.innerWidth - b.x),
        h: clamp(r.h + (ev.clientY - r.my), MIN_H, window.innerHeight - b.y),
      }));
    };
    const up = () => { rezRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div
      className="nodrag nowheel animate-scale-in"
      style={{
        position: "fixed", left: box.x, top: box.y, width: box.w, height: box.h, zIndex: 40,
        borderRadius: 14, overflow: "hidden",
        border: "1px solid var(--c-bd2)",
        background: "color-mix(in oklch, var(--c-base) 96%, transparent)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 18px 50px oklch(0 0 0 / 0.45)",
        display: "flex", flexDirection: "column",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <AssetPanel projectId={projectId} onClose={onClose} onHeaderMouseDown={onHeaderDown} />

      {/* Resize handle (bottom-right corner) */}
      <div
        onMouseDown={onResizeDown}
        title="拖拽缩放"
        style={{
          position: "absolute", right: 0, bottom: 0, width: 16, height: 16,
          cursor: "nwse-resize", zIndex: 2,
          background: "linear-gradient(135deg, transparent 50%, var(--c-bd3) 50%)",
        }}
      />
    </div>
  );
}
