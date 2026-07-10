import { useRef, useEffect } from "react";
import { usePersistentState } from "../../hooks/usePersistentState";
import { AssetPanel } from "./AssetPanel";

interface Box { x: number; y: number; w: number; h: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const MIN_W = 150;
const MIN_H = 280;

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
      // 窄屏（手机）默认宽不超过 92vw、高不超过 78vh，且整体落在屏内（B 档移动端适配）。
      x: Math.max(8, (typeof window !== "undefined" ? window.innerWidth : 1200) - Math.min(320, (typeof window !== "undefined" ? window.innerWidth : 1200) * 0.92) - 16),
      y: 84,
      w: Math.min(320, (typeof window !== "undefined" ? window.innerWidth : 1200) * 0.92),
      h: Math.min(560, (typeof window !== "undefined" ? window.innerHeight : 900) * 0.78),
    },
    { validate: (p) => (p && typeof p === "object" && "x" in p && "w" in p ? (p as Box) : null) },
  );
  const dragRef = useRef<{ mx: number; my: number; x: number; y: number } | null>(null);

  // Keep the panel on-screen when the window shrinks (e.g. exiting F11 fullscreen),
  // and on mount in case it was persisted from a larger window.
  useEffect(() => {
    const fix = () => setBox((b) => {
      const w = Math.min(b.w, window.innerWidth);
      const h = Math.min(b.h, window.innerHeight);
      return { w, h, x: clamp(b.x, 0, Math.max(0, window.innerWidth - w)), y: clamp(b.y, 0, Math.max(0, window.innerHeight - h)) };
    });
    window.addEventListener("resize", fix);
    fix();
    return () => window.removeEventListener("resize", fix);
  }, [setBox]);

  // Pointer 事件统一鼠标/触屏（触屏上 mousedown 收不到，面板拖不动——B 档移动端适配）。
  function onHeaderDown(e: React.PointerEvent) {
    // Ignore clicks on interactive header controls (e.g. the close button).
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    dragRef.current = { mx: e.clientX, my: e.clientY, x: box.x, y: box.y };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current; if (!d) return;
      setBox((b) => ({
        ...b,
        x: clamp(d.x + ev.clientX - d.mx, 0, window.innerWidth - 120),
        y: clamp(d.y + ev.clientY - d.my, 0, window.innerHeight - 48),
      }));
    };
    const up = () => { dragRef.current = null; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // 四角缩放：east/south 角拉伸宽/高；west/north 角固定对边、移动 x/y 反向改尺寸。
  function onResizeDown(e: React.PointerEvent, dir: "se" | "sw" | "ne" | "nw") {
    e.preventDefault(); e.stopPropagation();
    const start = { mx: e.clientX, my: e.clientY, x: box.x, y: box.y, w: box.w, h: box.h };
    const east = dir === "se" || dir === "ne";
    const south = dir === "se" || dir === "sw";
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.mx, dy = ev.clientY - start.my;
      setBox(() => {
        let { x, y, w, h } = start;
        if (east) { w = clamp(start.w + dx, MIN_W, window.innerWidth - start.x); }
        else { const right = start.x + start.w; x = clamp(start.x + dx, 0, right - MIN_W); w = right - x; }
        if (south) { h = clamp(start.h + dy, MIN_H, window.innerHeight - start.y); }
        else { const bottom = start.y + start.h; y = clamp(start.y + dy, 0, bottom - MIN_H); h = bottom - y; }
        return { x, y, w, h };
      });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
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
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <AssetPanel projectId={projectId} onClose={onClose} onHeaderMouseDown={onHeaderDown} />

      {/* 四角拖拽缩放手柄（右下角带可见斜纹提示，其余三角为透明热区 + 对应光标）*/}
      {([
        ["se", { right: 0, bottom: 0 }, "nwse-resize", true],
        ["sw", { left: 0, bottom: 0 }, "nesw-resize", false],
        ["ne", { right: 0, top: 0 }, "nesw-resize", false],
        ["nw", { left: 0, top: 0 }, "nwse-resize", false],
      ] as const).map(([dir, pos, cursor, visible]) => (
        <div
          key={dir}
          onPointerDown={(e) => onResizeDown(e, dir)}
          title="拖拽缩放"
          style={{
            position: "absolute", ...pos, width: 16, height: 16, touchAction: "none",
            cursor, zIndex: 3,
            background: visible ? "linear-gradient(135deg, transparent 50%, var(--c-bd3) 50%)" : "transparent",
          }}
        />
      ))}
    </div>
  );
}
