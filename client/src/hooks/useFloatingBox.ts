import { useEffect, useRef } from "react";
import { usePersistentState } from "./usePersistentState";

export interface Box { x: number; y: number; w: number; h: number }
export type Corner = "tl" | "tr" | "bl" | "br";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Pure four-corner resize: drag a corner; the OPPOSITE corner stays anchored. `start` is
 * the box at drag-start, `dx/dy` the pointer delta. Clamps to `minW/minH` and the viewport
 * (`vw/vh`). Extracted so it's unit-testable independent of pointer plumbing.
 */
export function resizeBoxByCorner(
  start: Box, corner: Corner, dx: number, dy: number,
  minW: number, minH: number, vw: number, vh: number,
): Box {
  const right = start.x + start.w, bottom = start.y + start.h;
  let { x, y, w, h } = start;
  if (corner === "br") {
    w = clamp(start.w + dx, minW, vw - start.x);
    h = clamp(start.h + dy, minH, vh - start.y);
  } else if (corner === "bl") {
    x = clamp(start.x + dx, 0, right - minW);
    w = right - x;
    h = clamp(start.h + dy, minH, vh - start.y);
  } else if (corner === "tr") {
    w = clamp(start.w + dx, minW, vw - start.x);
    y = clamp(start.y + dy, 0, bottom - minH);
    h = bottom - y;
  } else { // tl
    x = clamp(start.x + dx, 0, right - minW);
    y = clamp(start.y + dy, 0, bottom - minH);
    w = right - x;
    h = bottom - y;
  }
  return { x, y, w, h };
}

/**
 * Floating-panel layout: a persisted {x,y,w,h} box plus drag-by-header and four-corner
 * resize handlers. Keeps the panel on-screen when the window shrinks. Mirrors the logic
 * previously inlined in FloatingAssetPanel, generalized for reuse (character library,
 * filmstrip/timeline four-corner resize).
 */
export function useFloatingBox(
  storageKey: string, defaults: Box, opts?: { minW?: number; minH?: number },
) {
  const minW = opts?.minW ?? 200;
  const minH = opts?.minH ?? 220;
  const [box, setBox] = usePersistentState<Box>(storageKey, defaults, {
    validate: (p) => (p && typeof p === "object" && "x" in p && "w" in p ? (p as Box) : null),
  });
  const dragRef = useRef<{ mx: number; my: number; x: number; y: number } | null>(null);
  const rezRef = useRef<{ mx: number; my: number; start: Box; corner: Corner } | null>(null);

  // Keep on-screen when the window shrinks (e.g. exiting fullscreen) and on mount.
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

  function onHeaderMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button,input,select,a")) return; // don't drag from controls
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

  function onResizeMouseDown(corner: Corner) {
    return (e: React.MouseEvent) => {
      e.preventDefault(); e.stopPropagation();
      rezRef.current = { mx: e.clientX, my: e.clientY, start: box, corner };
      const move = (ev: MouseEvent) => {
        const r = rezRef.current; if (!r) return;
        setBox(resizeBoxByCorner(r.start, r.corner, ev.clientX - r.mx, ev.clientY - r.my, minW, minH, window.innerWidth, window.innerHeight));
      };
      const up = () => { rezRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
  }

  return { box, setBox, onHeaderMouseDown, onResizeMouseDown };
}
