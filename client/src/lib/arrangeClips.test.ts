import { describe, it, expect } from "vitest";
import { arrangeClips } from "./arrangeClips";

type C = { id: string; start: number; len: number };
const dur = (c: C) => c.len;

describe("arrangeClips — 轨道片段首尾衔接排布", () => {
  it("全部排布：按 start 排序后无缝拼接，锚定最早起点", () => {
    const clips: C[] = [
      { id: "b", start: 10, len: 2 },
      { id: "a", start: 3, len: 1 },
      { id: "c", start: 20, len: 3 },
    ];
    const out = arrangeClips(clips, dur);
    const by = Object.fromEntries(out.map((c) => [c.id, c.start]));
    expect(by.a).toBe(3);      // 锚点 = 最早 start
    expect(by.b).toBe(4);      // 3 + 1
    expect(by.c).toBe(6);      // 4 + 2
  });

  it("仅排布选中：未选片段不动，选中片段从最早选中处衔接", () => {
    const clips: C[] = [
      { id: "a", start: 0, len: 2 },
      { id: "b", start: 5, len: 1 },
      { id: "c", start: 9, len: 2 },
    ];
    const out = arrangeClips(clips, dur, new Set(["b", "c"]));
    const by = Object.fromEntries(out.map((c) => [c.id, c.start]));
    expect(by.a).toBe(0);  // 未选 → 不动
    expect(by.b).toBe(5);  // 锚点 = 最早选中
    expect(by.c).toBe(6);  // 5 + 1（衔接）
  });

  it("空集合视为全部；0/1 个目标原样返回（拷贝）", () => {
    const clips: C[] = [{ id: "a", start: 4, len: 2 }, { id: "b", start: 1, len: 1 }];
    const full = arrangeClips(clips, dur, new Set());
    expect(Object.fromEntries(full.map((c) => [c.id, c.start]))).toEqual({ b: 1, a: 2 });
    const one = arrangeClips([{ id: "a", start: 9, len: 2 }], dur);
    expect(one[0].start).toBe(9); // 单个不动
    expect(one).not.toBe(clips);  // 返回新数组
  });

  it("起点为负时锚点 clamp 到 0", () => {
    const out = arrangeClips([{ id: "a", start: -3, len: 1 }, { id: "b", start: 2, len: 1 }], dur);
    expect(out.find((c) => c.id === "a")!.start).toBe(0);
    expect(out.find((c) => c.id === "b")!.start).toBe(1);
  });
});
