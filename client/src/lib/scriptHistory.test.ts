import { describe, it, expect } from "vitest";
import { appendSnapshot, MAX_HISTORY } from "./scriptHistory";

describe("appendSnapshot", () => {
  it("追加一条快照", () => {
    const r = appendSnapshot(undefined, "hello", "润色前", 100);
    expect(r).toEqual([{ content: "hello", label: "润色前", at: 100 }]);
  });

  it("空 content 不快照", () => {
    expect(appendSnapshot([], "", "润色前")).toEqual([]);
    expect(appendSnapshot([], "   \n  ", "润色前")).toEqual([]);
  });

  it("与上一条相同则不快照（相邻去重）", () => {
    const base = [{ content: "abc", label: "x", at: 1 }];
    expect(appendSnapshot(base, "abc", "y", 2)).toBe(base);
  });

  it("内容不同则追加", () => {
    const base = [{ content: "abc", label: "x", at: 1 }];
    const r = appendSnapshot(base, "abcd", "y", 2);
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual({ content: "abcd", label: "y", at: 2 });
  });

  it("超过上限丢弃最旧", () => {
    let h = appendSnapshot(undefined, "v0", "L0", 0);
    for (let i = 1; i <= MAX_HISTORY + 5; i++) {
      h = appendSnapshot(h, "v" + i, "L" + i, i);
    }
    expect(h).toHaveLength(MAX_HISTORY);
    // 最旧的若干条被丢弃，最新一条保留
    expect(h[h.length - 1].content).toBe("v" + (MAX_HISTORY + 5));
    expect(h[0].content).toBe("v6"); // 0..5 共 6 条被丢弃
  });

  it("不修改原数组（纯函数）", () => {
    const base = [{ content: "a", label: "x", at: 1 }];
    const r = appendSnapshot(base, "b", "y", 2);
    expect(base).toHaveLength(1);
    expect(r).not.toBe(base);
  });
});
