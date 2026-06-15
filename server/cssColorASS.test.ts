import { describe, it, expect } from "vitest";
import { cssColorToASSHex, cssColorToASSAlpha } from "./_core/videoEditor";

describe("cssColorToASSHex — CSS 颜色 → ASS BBGGRR", () => {
  it("命名色保持原映射", () => {
    expect(cssColorToASSHex("white")).toBe("FFFFFF");
    expect(cssColorToASSHex("black")).toBe("000000");
    expect(cssColorToASSHex("red")).toBe("0000FF");   // ASS 为 BGR
    expect(cssColorToASSHex("blue")).toBe("FF0000");
  });
  it("#RRGGBB → BBGGRR（修复：旧实现对任何 hex 都返回白色）", () => {
    expect(cssColorToASSHex("#FF0000")).toBe("0000FF"); // 红
    expect(cssColorToASSHex("#00FF00")).toBe("00FF00"); // 绿
    expect(cssColorToASSHex("#0000FF")).toBe("FF0000"); // 蓝
    expect(cssColorToASSHex("#1a2b3c")).toBe("3C2B1A");
  });
  it("#RGB 简写与 #RRGGBBAA（忽略 alpha）", () => {
    expect(cssColorToASSHex("#f00")).toBe("0000FF");
    expect(cssColorToASSHex("#00000080")).toBe("000000");
    expect(cssColorToASSHex("#FFE60080")).toBe("00E6FF");
  });
  it("rgb()/rgba()", () => {
    expect(cssColorToASSHex("rgb(255,0,0)")).toBe("0000FF");
    expect(cssColorToASSHex("rgba(0, 128, 255, 0.5)")).toBe("FF8000");
  });
  it("无法解析 → 白色兜底", () => {
    expect(cssColorToASSHex("not-a-color")).toBe("FFFFFF");
    expect(cssColorToASSHex("")).toBe("FFFFFF");
  });
});

describe("cssColorToASSAlpha — 透明度（ASS 反向：00=不透明，FF=全透明）", () => {
  it("无 alpha 的颜色 → 不透明 00", () => {
    expect(cssColorToASSAlpha("#000000")).toBe("00");
    expect(cssColorToASSAlpha("white")).toBe("00");
    expect(cssColorToASSAlpha("rgb(1,2,3)")).toBe("00");
  });
  it("#RRGGBBAA 的 alpha 取反", () => {
    expect(cssColorToASSAlpha("#000000FF")).toBe("00"); // CSS 全不透明 → ASS 00
    expect(cssColorToASSAlpha("#00000000")).toBe("FF"); // CSS 全透明 → ASS FF
    expect(cssColorToASSAlpha("#00000080")).toBe("7F"); // 半透明 ≈ 7F
  });
  it("rgba() 的 alpha 取反", () => {
    expect(cssColorToASSAlpha("rgba(0,0,0,1)")).toBe("00");
    expect(cssColorToASSAlpha("rgba(0,0,0,0)")).toBe("FF");
    expect(cssColorToASSAlpha("rgba(0,0,0,0.5)")).toBe("7F");
  });
});
