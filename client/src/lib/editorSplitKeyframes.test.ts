import { describe, it, expect } from "vitest";
import { splitKeyframesAt } from "../components/editor/editorStore";
import type { TransformKeyframe } from "@shared/editorTypes";

const kf = (t: number, scale = 1): TransformKeyframe => ({ t, x: 0, y: 0, scale, opacity: 1, rotation: 0 });

// Regression: splitting a clip must re-base the right half's keyframes by -offset,
// because keyframe `t` is clip-start-relative timeline seconds. Before the fix both
// halves kept the original keyframes verbatim → the right half's animation jumped.
describe("splitKeyframesAt（分割时关键帧按片段起点重基准）", () => {
  it("左半保留 [0,offset]、右半保留 [offset,…] 并整体 -offset", () => {
    const kfs = [kf(0, 1), kf(1, 1.5), kf(3, 2)]; // 在 offset=2 处分割
    const { left, right } = splitKeyframesAt(kfs, 2);
    expect(left!.map((k) => k.t)).toEqual([0, 1]);        // 起点未变，原样保留
    expect(right!.map((k) => k.t)).toEqual([1]);          // t=3 → 3-2=1（重基准）
    expect(right![0].scale).toBe(2);                       // 值不变，只移时间
  });

  it("边界处关键帧两侧都保留（跨切点连续）", () => {
    const { left, right } = splitKeyframesAt([kf(0), kf(2), kf(4)], 2);
    expect(left!.map((k) => k.t)).toEqual([0, 2]);
    expect(right!.map((k) => k.t)).toEqual([0, 2]);        // t=2→0, t=4→2
  });

  it("无关键帧 → 两侧均 undefined（不无中生有）", () => {
    expect(splitKeyframesAt(undefined, 2)).toEqual({ left: undefined, right: undefined });
    expect(splitKeyframesAt([], 2)).toEqual({ left: undefined, right: undefined });
  });

  it("一侧无关键帧时该侧为 undefined", () => {
    const { left, right } = splitKeyframesAt([kf(3), kf(4)], 2); // 全在右半
    expect(left).toBeUndefined();
    expect(right!.map((k) => k.t)).toEqual([1, 2]);
  });
});
