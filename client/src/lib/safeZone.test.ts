import { describe, it, expect } from "vitest";
import { computeSafeRect } from "./safeZone";

// 起始内框：左上(0.1,0.1)，宽高 0.6 × 0.6 → 余量 top/left=0.1, right/bottom=0.3
const START = { x: 0.1, y: 0.1, w: 0.6, h: 0.6 };
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("computeSafeRect — 安全区拖动/缩放", () => {
  it("移动：整体平移，宽高不变", () => {
    const r = computeSafeRect(START, "move", 0.05, -0.04);
    close(r.left, 0.15); close(r.top, 0.06);
    close(1 - r.left - r.right, 0.6); close(1 - r.top - r.bottom, 0.6);
  });

  it("移动：撞到边界被夹住（不越界）", () => {
    const r = computeSafeRect(START, "move", -1, -1);
    close(r.left, 0); close(r.top, 0);
    close(1 - r.left - r.right, 0.6); close(1 - r.top - r.bottom, 0.6);
    const r2 = computeSafeRect(START, "move", 1, 1);
    close(r2.left, 0.4); close(r2.top, 0.4);
  });

  it("东南角(se)缩放：右/下扩大，左上不动", () => {
    const r = computeSafeRect(START, "se", 0.1, 0.1);
    close(r.left, 0.1); close(r.top, 0.1);
    close(1 - r.left - r.right, 0.7); close(1 - r.top - r.bottom, 0.7);
  });

  it("西北角(nw)缩放：左上收，宽高反向", () => {
    const r = computeSafeRect(START, "nw", 0.05, 0.05);
    close(r.left, 0.15); close(r.top, 0.15);
    close(1 - r.left - r.right, 0.55); close(1 - r.top - r.bottom, 0.55);
  });

  it("最小尺寸下限（≥0.06），不反转", () => {
    const r = computeSafeRect(START, "se", -1, -1);
    expect(1 - r.left - r.right).toBeGreaterThanOrEqual(0.06 - 1e-9);
    expect(1 - r.top - r.bottom).toBeGreaterThanOrEqual(0.06 - 1e-9);
    const r2 = computeSafeRect(START, "nw", 1, 1);
    expect(1 - r2.left - r2.right).toBeGreaterThanOrEqual(0.06 - 1e-9);
  });

  it("东北角(ne)：右扩 + 上收，左不动", () => {
    const r = computeSafeRect(START, "ne", 0.1, 0.05);
    close(r.top, 0.15); close(r.left, 0.1);
    close(1 - r.left - r.right, 0.7); close(1 - r.top - r.bottom, 0.55);
  });
});
