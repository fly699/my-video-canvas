import { describe, it, expect } from "vitest";
import { sentinelDecide, selectPerfLite, PERF_MODE_ORDER, PERF_MODE_LABEL } from "./perfMode";

describe("perfMode #81（FPS 哨兵判决 + 生效档选择器）", () => {
  describe("sentinelDecide 迟滞规则", () => {
    it("连续 4 秒 <34 才进 lite；不足 4 样本或有一秒回升都不进", () => {
      expect(sentinelDecide([20, 25, 30, 28], false)).toBe("enter");
      expect(sentinelDecide([20, 25, 30], false)).toBe(null);           // 样本不足
      expect(sentinelDecide([20, 25, 40, 28], false)).toBe(null);       // 中途回升
      expect(sentinelDecide([60, 60, 20, 25, 30, 28], false)).toBe("enter"); // 只看最近 4 秒
      expect(sentinelDecide([34, 34, 34, 34], false)).toBe(null);       // 边界：34 不算低
    });
    it("已 lite 时需连续 10 秒 >55 才退出（大迟滞防来回抖动）", () => {
      const good = Array(10).fill(60);
      expect(sentinelDecide(good, true)).toBe("exit");
      expect(sentinelDecide(Array(9).fill(60), true)).toBe(null);       // 样本不足
      expect(sentinelDecide([...Array(9).fill(60), 50], true)).toBe(null); // 最后一秒掉帧
      expect(sentinelDecide(Array(10).fill(55), true)).toBe(null);      // 边界：55 不算高
      // 已 lite 时低帧不产生重复 enter
      expect(sentinelDecide([20, 20, 20, 20], true)).toBe(null);
    });
  });

  it("selectPerfLite：lite 恒真；auto 看 autoLite；quality 恒假（永不降档）", () => {
    expect(selectPerfLite({ mode: "lite", autoLite: false })).toBe(true);
    expect(selectPerfLite({ mode: "auto", autoLite: false })).toBe(false);
    expect(selectPerfLite({ mode: "auto", autoLite: true })).toBe(true);
    expect(selectPerfLite({ mode: "quality", autoLite: true })).toBe(false);
  });

  it("三档顺序与标签齐全", () => {
    expect(PERF_MODE_ORDER).toEqual(["auto", "lite", "quality"]);
    for (const m of PERF_MODE_ORDER) expect(PERF_MODE_LABEL[m]).toBeTruthy();
  });
});
