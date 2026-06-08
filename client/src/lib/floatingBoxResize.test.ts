import { describe, it, expect } from "vitest";
import { resizeBoxByCorner, type Box } from "../hooks/useFloatingBox";

const start: Box = { x: 100, y: 100, w: 200, h: 200 }; // right=300, bottom=300
const VW = 1000, VH = 800, MINW = 50, MINH = 50;

describe("resizeBoxByCorner", () => {
  it("br: grows w/h, anchors top-left", () => {
    expect(resizeBoxByCorner(start, "br", 40, 30, MINW, MINH, VW, VH)).toEqual({ x: 100, y: 100, w: 240, h: 230 });
  });
  it("tl: anchors bottom-right (right/bottom fixed)", () => {
    const r = resizeBoxByCorner(start, "tl", -20, -10, MINW, MINH, VW, VH);
    expect(r).toEqual({ x: 80, y: 90, w: 220, h: 210 });
    expect(r.x + r.w).toBe(300);
    expect(r.y + r.h).toBe(300);
  });
  it("bl: x moves, right edge fixed; h grows", () => {
    const r = resizeBoxByCorner(start, "bl", -30, 20, MINW, MINH, VW, VH);
    expect(r).toEqual({ x: 70, y: 100, w: 230, h: 220 });
    expect(r.x + r.w).toBe(300);
  });
  it("tr: y moves, bottom edge fixed; w grows", () => {
    const r = resizeBoxByCorner(start, "tr", 25, -15, MINW, MINH, VW, VH);
    expect(r).toEqual({ x: 100, y: 85, w: 225, h: 215 });
    expect(r.y + r.h).toBe(300);
  });
  it("enforces min width/height", () => {
    const r = resizeBoxByCorner(start, "br", -500, -500, MINW, MINH, VW, VH);
    expect(r.w).toBe(MINW); expect(r.h).toBe(MINH);
  });
  it("clamps br to viewport", () => {
    const r = resizeBoxByCorner(start, "br", 9999, 9999, MINW, MINH, VW, VH);
    expect(r.w).toBe(VW - start.x); expect(r.h).toBe(VH - start.y);
  });
});
