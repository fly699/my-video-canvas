import { describe, it, expect } from "vitest";
import { GRID_PRESETS, gridCameraPosition } from "./directorGrid";

describe("directorGrid", () => {
  it("每个预设 rows×cols === 角度数", () => {
    for (const p of GRID_PRESETS) {
      expect(p.angles.length, `${p.key}`).toBe(p.rows * p.cols);
    }
  });

  it("中心机位 {az:0,el:0,dist:1} 还原当前机位（恒等）", () => {
    const cam: [number, number, number] = [0, 1.5, 4.2];
    const target: [number, number, number] = [0, 1.0, 0];
    const out = gridCameraPosition(cam, target, { az: 0, el: 0, dist: 1 });
    expect(out[0]).toBeCloseTo(cam[0], 4);
    expect(out[1]).toBeCloseTo(cam[1], 4);
    expect(out[2]).toBeCloseTo(cam[2], 4);
  });

  it("dist 倍数线性缩放与注视点的距离", () => {
    const cam: [number, number, number] = [0, 1, 4];
    const target: [number, number, number] = [0, 1, 0];
    const out = gridCameraPosition(cam, target, { az: 0, el: 0, dist: 2 });
    const d = Math.hypot(out[0] - target[0], out[1] - target[1], out[2] - target[2]);
    expect(d).toBeCloseTo(8, 3); // 原距 4 → ×2 = 8
  });

  it("方位偏移改变水平角、保持到注视点的距离", () => {
    const cam: [number, number, number] = [0, 1, 4];
    const target: [number, number, number] = [0, 1, 0];
    const out = gridCameraPosition(cam, target, { az: 90, el: 0, dist: 1 });
    const d = Math.hypot(out[0] - target[0], out[1] - target[1], out[2] - target[2]);
    expect(d).toBeCloseTo(4, 3);            // 距离不变
    expect(Math.abs(out[0])).toBeCloseTo(4, 2); // 转到侧面（+x 方向）
    expect(Math.abs(out[2])).toBeLessThan(0.01);
  });
});
