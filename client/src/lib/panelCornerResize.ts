// Four-corner resize geometry for the filmstrip / timeline floating panels. These panels
// have their own constraints (min width/height, a MAX height cap, viewport width) and the
// opposite corner stays anchored. Pure / unit-testable; pointer plumbing lives in the panels.

export type Corner = "tl" | "tr" | "bl" | "br";
export type Edge = "l" | "r";
export interface Rect { left: number; top: number; width: number; height: number }
export interface PanelBounds { minW: number; minH: number; maxH: number; vw: number }

/**
 * Horizontal-only edge resize: drag the left or right edge; the opposite edge stays
 * anchored and height/top are untouched. Lets users widen/narrow the filmstrip & timeline
 * panels without the four-corner handles also changing height. Pure / unit-testable.
 */
export function resizePanelByEdge(edge: Edge, init: Rect, dx: number, b: { minW: number; vw: number }): Rect {
  const right = init.left + init.width;
  let left = init.left;
  let width = init.width;
  if (edge === "r") {
    width = Math.max(b.minW, Math.min(b.vw - init.left, init.width + dx)); // left edge anchored
  } else { // "l" — right edge anchored, left moves (≥ 0)
    left = Math.max(0, Math.min(right - b.minW, init.left + dx));
    width = right - left;
  }
  return { left, top: init.top, width, height: init.height };
}

export function resizePanelByCorner(corner: Corner, init: Rect, dx: number, dy: number, b: PanelBounds): Rect {
  const right = init.left + init.width;
  const bottom = init.top + init.height;
  const clampH = (h: number) => Math.max(b.minH, Math.min(b.maxH, h));
  const east = corner === "tr" || corner === "br";
  const south = corner === "bl" || corner === "br";

  let { left, top, width, height } = init;
  if (east) {
    width = Math.max(b.minW, Math.min(b.vw - init.left, init.width + dx)); // left anchored
  } else { // west — right edge anchored, left moves (≥ 0)
    left = Math.max(0, Math.min(right - b.minW, init.left + dx));
    width = right - left;
  }
  if (south) {
    height = clampH(init.height + dy); // top anchored
  } else { // north — bottom edge anchored, top moves (≥ 0)
    height = Math.min(clampH(init.height - dy), bottom);
    top = bottom - height;
  }
  return { left, top, width, height };
}
