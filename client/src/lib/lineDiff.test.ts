import { describe, it, expect } from "vitest";
import { diffLines, diffStats } from "./lineDiff";

describe("diffLines", () => {
  it("全同：所有行标 same，无增删", () => {
    const r = diffLines("a\nb\nc", "a\nb\nc");
    expect(r.every((l) => l.type === "same")).toBe(true);
    expect(r.map((l) => l.text)).toEqual(["a", "b", "c"]);
    expect(diffStats(r)).toEqual({ added: 0, removed: 0 });
  });

  it("纯增：新文本追加行", () => {
    const r = diffLines("a\nb", "a\nb\nc\nd");
    expect(diffStats(r)).toEqual({ added: 2, removed: 0 });
    expect(r.filter((l) => l.type === "add").map((l) => l.text)).toEqual(["c", "d"]);
  });

  it("纯删：旧文本被删行", () => {
    const r = diffLines("a\nb\nc\nd", "a\nd");
    expect(diffStats(r)).toEqual({ added: 0, removed: 2 });
    expect(r.filter((l) => l.type === "del").map((l) => l.text)).toEqual(["b", "c"]);
  });

  it("中间改：保留首尾，改动呈现为删旧+增新", () => {
    const r = diffLines("a\nOLD\nc", "a\nNEW\nc");
    expect(diffStats(r)).toEqual({ added: 1, removed: 1 });
    // 首尾 same 保留
    expect(r[0]).toEqual({ type: "same", text: "a" });
    expect(r[r.length - 1]).toEqual({ type: "same", text: "c" });
    expect(r.some((l) => l.type === "del" && l.text === "OLD")).toBe(true);
    expect(r.some((l) => l.type === "add" && l.text === "NEW")).toBe(true);
  });

  it("空 → 非空：全部为新增", () => {
    const r = diffLines("", "x\ny");
    expect(diffStats(r)).toEqual({ added: 2, removed: 0 });
    expect(r.every((l) => l.type === "add")).toBe(true);
  });

  it("非空 → 空：全部为删除", () => {
    const r = diffLines("x\ny", "");
    expect(diffStats(r)).toEqual({ added: 0, removed: 2 });
    expect(r.every((l) => l.type === "del")).toBe(true);
  });

  it("空 → 空：无任何行", () => {
    expect(diffLines("", "")).toEqual([]);
  });
});
