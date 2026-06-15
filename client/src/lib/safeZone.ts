// 安全区（竖屏平台 UI 遮挡参考框）的拖动 / 缩放纯计算，独立成 lib 便于单测。

export type SafeMargins = { top: number; bottom: number; left: number; right: number };
export type SafeDragMode = "move" | "nw" | "ne" | "sw" | "se";

/**
 * Apply a safe-zone drag to its starting inner rect (normalized {x,y,w,h}) and
 * return the resulting margins {top,bottom,left,right}. `mode` is "move" or a
 * corner; dx/dy are normalized (fraction-of-frame) deltas. Keeps the box inside
 * [0,1] with a minimum size, so it can never invert or escape the frame.
 */
export function computeSafeRect(
  start: { x: number; y: number; w: number; h: number },
  mode: SafeDragMode,
  dx: number,
  dy: number,
): SafeMargins {
  const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const MIN = 0.06;
  let { x, y, w: iw, h: ih } = start;
  if (mode === "move") {
    x = cl(x + dx, 0, 1 - iw); y = cl(y + dy, 0, 1 - ih);
  } else {
    if (mode.includes("w")) { const nx = cl(x + dx, 0, x + iw - MIN); iw += x - nx; x = nx; }
    if (mode.includes("e")) { iw = cl(iw + dx, MIN, 1 - x); }
    if (mode.includes("n")) { const ny = cl(y + dy, 0, y + ih - MIN); ih += y - ny; y = ny; }
    if (mode.includes("s")) { ih = cl(ih + dy, MIN, 1 - y); }
  }
  return { top: y, bottom: 1 - y - ih, left: x, right: 1 - x - iw };
}
