import { describe, it, expect } from "vitest";
import { buildAtempoFilters } from "./_core/videoEditor";

// buildAtempoFilters chains atempo for speeds outside [0.5, 2]. A speed of 0 made the
// `< 0.5` loop spin forever (0/0.5 = 0), and negative/NaN/Infinity are meaningless.
// The guard returns [] (treat as 1×) for any non-finite/non-positive speed so the shared
// helper can never hang. Verified: speed=0 returns instantly instead of looping.
describe("buildAtempoFilters — speed 守卫（防死循环）", () => {
  it("非正/非有限 speed → [] 且不死循环", () => {
    for (const s of [0, -1, -0.5, NaN, Infinity, -Infinity]) {
      expect(buildAtempoFilters(s)).toEqual([]);
    }
  });

  it("正常 speed 仍正确链式 atempo", () => {
    expect(buildAtempoFilters(0.25)).toEqual(["atempo=0.5", "atempo=0.500000"]); // 0.5*0.5=0.25
    expect(buildAtempoFilters(4)).toEqual(["atempo=2.0", "atempo=2.000000"]);   // 2*2=4
    // 区间内（0.5–2.0）单个 atempo
    expect(buildAtempoFilters(1.5)).toEqual(["atempo=1.500000"]);
    expect(buildAtempoFilters(1)).toEqual(["atempo=1.000000"]); // 既有行为：1× 也写一条（无害）
  });

  it("极端大 speed 被钳制、仍终止（不无限 push）", () => {
    const f = buildAtempoFilters(1e9);
    expect(f.length).toBeLessThan(20); // 钳到 256 → 至多 ~8 个 atempo=2.0 + 余项
    expect(f.every((x) => x.startsWith("atempo="))).toBe(true);
  });
});
