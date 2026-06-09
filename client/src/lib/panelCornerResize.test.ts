import { describe, it, expect } from "vitest";
import { resizePanelByCorner, resizePanelByEdge, type Rect, type PanelBounds } from "./panelCornerResize";

const init: Rect = { left: 200, top: 300, width: 400, height: 200 }; // right=600, bottom=500
const b: PanelBounds = { minW: 100, minH: 80, maxH: 600, vw: 1200 };
const eb = { minW: 100, vw: 1200 };

describe("resizePanelByCorner", () => {
  it("br grows right+down, anchors top-left", () => {
    expect(resizePanelByCorner("br", init, 50, 40, b)).toEqual({ left: 200, top: 300, width: 450, height: 240 });
  });
  it("tr grows right, top moves up (bottom anchored)", () => {
    const r = resizePanelByCorner("tr", init, 30, -25, b);
    expect(r.width).toBe(430);
    expect(r.top + r.height).toBe(500); // bottom anchored
    expect(r.height).toBe(225);
    expect(r.top).toBe(275);
  });
  it("bl: left moves, right anchored; grows down", () => {
    const r = resizePanelByCorner("bl", init, -40, 30, b);
    expect(r.left).toBe(160);
    expect(r.left + r.width).toBe(600); // right anchored
    expect(r.height).toBe(230);
  });
  it("tl: left + top move, bottom-right anchored", () => {
    const r = resizePanelByCorner("tl", init, -40, -20, b);
    expect(r.left + r.width).toBe(600);
    expect(r.top + r.height).toBe(500);
    expect(r.left).toBe(160);
    expect(r.top).toBe(280);
  });
  it("enforces min width/height and max height", () => {
    expect(resizePanelByCorner("br", init, -9999, -9999, b)).toMatchObject({ width: 100, height: 80 });
    expect(resizePanelByCorner("br", init, 0, 9999, b).height).toBe(b.maxH);
  });
  it("north resize keeps top >= 0 (cannot exceed bottom)", () => {
    const tall: Rect = { left: 0, top: 50, width: 300, height: 120 }; // bottom=170
    const r = resizePanelByCorner("tr", tall, 0, -9999, { ...b, maxH: 600 });
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.height).toBe(170); // capped to bottom
  });
});

describe("resizePanelByEdge", () => {
  it("r grows width, anchors left; height/top unchanged", () => {
    expect(resizePanelByEdge("r", init, 60, eb)).toEqual({ left: 200, top: 300, width: 460, height: 200 });
  });
  it("l moves left, right edge anchored; height/top unchanged", () => {
    const r = resizePanelByEdge("l", init, -50, eb);
    expect(r.left).toBe(150);
    expect(r.left + r.width).toBe(600); // right anchored
    expect(r.height).toBe(200);
    expect(r.top).toBe(300);
  });
  it("enforces min width on both edges", () => {
    expect(resizePanelByEdge("r", init, -9999, eb).width).toBe(100); // left anchored, min width
    const l = resizePanelByEdge("l", init, 9999, eb); // drag left edge past right − minW
    expect(l.width).toBe(100);
    expect(l.left + l.width).toBe(600);
  });
  it("clamps right edge to viewport width", () => {
    expect(resizePanelByEdge("r", init, 9999, eb).width).toBe(eb.vw - init.left); // 1000
  });
  it("keeps left edge >= 0", () => {
    expect(resizePanelByEdge("l", init, -9999, eb).left).toBe(0);
  });
});
