import { describe, it, expect } from "vitest";
import { pickNodeSize } from "./nodeSize";

const CFG = { defaultWidth: 280, defaultHeight: 200 };

describe("pickNodeSize（群组底框/布局包围盒尺寸）", () => {
  it("measured 更大 → 取 measured（修：未显式设高但实际渲染更高的节点探出底框）", () => {
    expect(pickNodeSize({ measured: { width: 300, height: 640 } }, CFG)).toEqual({ w: 300, h: 640 });
  });
  it("显式 width/height（NodeResizer）更大 → 取显式值", () => {
    expect(pickNodeSize({ width: 400, height: 500, measured: { width: 300, height: 200 } }, CFG)).toEqual({ w: 400, h: 500 });
  });
  it("取 measured 与估算的较大值（永不低估）", () => {
    // 显式高 300 但实测 620（展开后更高）→ 取 620，保证底框盖住
    expect(pickNodeSize({ height: 300, measured: { height: 620 } }, CFG).h).toBe(620);
  });
  it("无任何尺寸信息 → 回退配置默认", () => {
    expect(pickNodeSize({}, CFG)).toEqual({ w: 280, h: 200 });
  });
  it("style 尺寸兜底", () => {
    expect(pickNodeSize({ style: { width: 360, height: 240 } }, CFG)).toEqual({ w: 360, h: 240 });
  });
  it("无配置默认 → 兜底 280×200", () => {
    expect(pickNodeSize({}, {})).toEqual({ w: 280, h: 200 });
  });
  it("非法/非数值尺寸忽略", () => {
    expect(pickNodeSize({ width: NaN, measured: { height: 0 } }, CFG)).toEqual({ w: 280, h: 200 });
  });
});
