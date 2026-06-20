import { describe, it, expect } from "vitest";
import { canMergeClips, mergeClips, rightNeighbour, mergeContiguousRun, canMergeSource, mergeSourceRun, rippleMergeTrack } from "../components/editor/editorStore";
import type { Clip, Track } from "@shared/editorTypes";

// Minimal clip factory mirroring a video source split into [0,2]+[2,5] on the timeline.
function clip(p: Partial<Clip>): Clip {
  return { id: "x", kind: "video", assetUrl: "u.mp4", start: 0, trimIn: 0, trimOut: 2, speed: 1, ...p };
}

describe("canMergeClips（split 的逆判定）", () => {
  it("同源、时间相邻、源连续 → 可合并（刚被 split 出来的一对）", () => {
    const a = clip({ id: "a", start: 0, trimIn: 0, trimOut: 2 });
    const b = clip({ id: "b", start: 2, trimIn: 2, trimOut: 5 });
    expect(canMergeClips(a, b)).toBe(true);
  });
  it("时间线有间隙 → 不可合并", () => {
    expect(canMergeClips(clip({ trimOut: 2 }), clip({ id: "b", start: 3, trimIn: 2, trimOut: 5 }))).toBe(false);
  });
  it("源不连续（b 的入点≠a 的出点）→ 不可合并", () => {
    expect(canMergeClips(clip({ trimOut: 2 }), clip({ id: "b", start: 2, trimIn: 4, trimOut: 6 }))).toBe(false);
  });
  it("不同源 / 不同速度 / 不同方向 → 不可合并", () => {
    const a = clip({ trimOut: 2 });
    expect(canMergeClips(a, clip({ id: "b", assetUrl: "other.mp4", start: 2, trimIn: 2, trimOut: 5 }))).toBe(false);
    expect(canMergeClips(a, clip({ id: "b", speed: 2, start: 2, trimIn: 2, trimOut: 5 }))).toBe(false);
    expect(canMergeClips(a, clip({ id: "b", reverse: true, start: 2, trimIn: 2, trimOut: 5 }))).toBe(false);
  });
  it("不同速度下相邻判定用可见时长（speed=2，时长=1s）", () => {
    const a = clip({ id: "a", start: 0, trimIn: 0, trimOut: 2, speed: 2 }); // 可见 1s
    const b = clip({ id: "b", start: 1, trimIn: 2, trimOut: 4, speed: 2 });
    expect(canMergeClips(a, b)).toBe(true);
  });
});

describe("mergeClips（拼回一段）", () => {
  it("延长出点到 b、保留 a 的起点/入点", () => {
    const m = mergeClips(clip({ id: "a", trimIn: 0, trimOut: 2 }), clip({ id: "b", start: 2, trimIn: 2, trimOut: 5 }));
    expect(m.id).toBe("a");
    expect(m.trimIn).toBe(0);
    expect(m.trimOut).toBe(5);
    expect(m.start).toBe(0);
  });
  it("关键帧拼接：b 的按 a 可见时长重基准，去掉边界重复", () => {
    const a = clip({ id: "a", start: 0, trimIn: 0, trimOut: 2, keyframes: [{ t: 0 }, { t: 2 }] as never });
    const b = clip({ id: "b", start: 2, trimIn: 2, trimOut: 5, keyframes: [{ t: 0 }, { t: 3 }] as never });
    const m = mergeClips(a, b);
    // a: t=0,2 ; b rebased +2: t=2(dup→drop),5 → 合并后 0,2,5
    expect(m.keyframes?.map((k) => k.t)).toEqual([0, 2, 5]);
  });
});

describe("mergeContiguousRun（多段连续合并）", () => {
  // 一段被切成 4 块：[0,2][2,4][4,6][6,9]
  const four = [
    clip({ id: "a", start: 0, trimIn: 0, trimOut: 2 }),
    clip({ id: "b", start: 2, trimIn: 2, trimOut: 4 }),
    clip({ id: "c", start: 4, trimIn: 4, trimOut: 6 }),
    clip({ id: "d", start: 6, trimIn: 6, trimOut: 9 }),
  ];
  it("连续 4 段折叠成 1 段，保留首段起点、延到末段出点", () => {
    const out = mergeContiguousRun(four);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
    expect(out[0].trimIn).toBe(0);
    expect(out[0].trimOut).toBe(9);
  });
  it("中间断开 → 折叠成两段（run + 独立段）", () => {
    const broken = [
      four[0], four[1],                              // [0,2][2,4] 连续
      clip({ id: "x", start: 5, trimIn: 4, trimOut: 7 }), // 时间有间隙 → 断开
    ];
    const out = mergeContiguousRun(broken);
    expect(out.map((c) => c.id)).toEqual(["a", "x"]);
    expect(out[0].trimOut).toBe(4);
  });
  it("单段 / 空 原样返回", () => {
    expect(mergeContiguousRun([four[0]]).map((c) => c.id)).toEqual(["a"]);
    expect(mergeContiguousRun([])).toEqual([]);
  });
});

describe("canMergeSource / mergeSourceRun（波纹合并：容忍时间间隙）", () => {
  it("源连续但时间线有间隙 → canMergeSource 仍为真（canMergeClips 为假）", () => {
    const a = clip({ id: "a", start: 0, trimIn: 0, trimOut: 2 });
    const b = clip({ id: "b", start: 5, trimIn: 2, trimOut: 4 }); // 时间隔了，但源接上
    expect(canMergeClips(a, b)).toBe(false);
    expect(canMergeSource(a, b)).toBe(true);
  });
  it("源不连续仍不可合并", () => {
    expect(canMergeSource(clip({ trimOut: 2 }), clip({ id: "b", start: 5, trimIn: 4, trimOut: 6 }))).toBe(false);
  });
  it("折叠跨间隙的同源多段为一段，保留首段起点", () => {
    const run = [
      clip({ id: "a", start: 0, trimIn: 0, trimOut: 2 }),
      clip({ id: "b", start: 5, trimIn: 2, trimOut: 4 }),
      clip({ id: "c", start: 9, trimIn: 4, trimOut: 7 }),
    ];
    const out = mergeSourceRun(run);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
    expect(out[0].start).toBe(0);
    expect(out[0].trimOut).toBe(7);
  });
});

describe("rippleMergeTrack（合并 + 闭合所释放间隙，与波纹删除一致）", () => {
  it("合并跨间隙的同源段，并把后续片段左移「释放的间隙量」（保留其它间隙）", () => {
    const A = clip({ id: "a", start: 0, trimIn: 0, trimOut: 2 });   // 可见 2s
    const B = clip({ id: "b", start: 5, trimIn: 2, trimOut: 4 });   // 与 A 源连续，时间隔了 3s
    const D = clip({ id: "d", start: 12, trimIn: 0, trimOut: 3, assetUrl: "other.mp4" }); // 末尾无关段
    const res = rippleMergeTrack([A, B, D], new Set(["a", "b"]))!;
    expect(res).not.toBeNull();
    expect(res.mergedIds).toEqual(["a"]);
    const merged = res.clips.find((c) => c.id === "a")!;
    expect(merged.start).toBe(0);
    expect(merged.trimOut).toBe(4);           // 拼回一段
    // runSpan = (5+2)-0 = 7；合并可见时长 = 4；释放 3 → D 左移 3：12→9
    expect(res.clips.find((c) => c.id === "d")!.start).toBe(9);
  });
  it("两段之间夹着未选中片段 → 不跨它合并（避免重叠）", () => {
    const A = clip({ id: "a", start: 0, trimIn: 0, trimOut: 2 });
    const X = clip({ id: "x", start: 2, trimIn: 0, trimOut: 1, assetUrl: "other.mp4" }); // 中间未选
    const B = clip({ id: "b", start: 3, trimIn: 2, trimOut: 4 });
    expect(rippleMergeTrack([A, X, B], new Set(["a", "b"]))).toBeNull(); // 无可合并的连续对
  });
  it("无可合并 → 返回 null", () => {
    expect(rippleMergeTrack([clip({ id: "a" })], new Set(["a"]))).toBeNull();
  });
});

describe("rightNeighbour", () => {
  it("取同轨最近的右邻片段", () => {
    const a = clip({ id: "a", start: 0 });
    const b = clip({ id: "b", start: 2 });
    const c = clip({ id: "c", start: 6 });
    const track = { id: "t", type: "video", clips: [c, a, b] } as unknown as Track;
    expect(rightNeighbour(track, a)?.id).toBe("b");
    expect(rightNeighbour(track, b)?.id).toBe("c");
    expect(rightNeighbour(track, c)).toBeUndefined();
  });
});
