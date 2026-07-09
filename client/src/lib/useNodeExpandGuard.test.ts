import { describe, it, expect, beforeEach } from "vitest";
import { markGestureSelected, clearGestureSelected, isGestureSuppressed } from "../hooks/useNodeExpandGuard";

// 「展开需真点击」守卫的核心逻辑（拖拽/框选选中→抑制展开；真点击→解除）。
describe("useNodeExpandGuard", () => {
  beforeEach(() => clearGestureSelected()); // 每例前清空全局抑制集

  it("默认不抑制任何节点（程序化选中/新建节点照常展开）", () => {
    expect(isGestureSuppressed("a")).toBe(false);
  });

  it("markGestureSelected 把手势(拖拽/框选)选中的节点标记为抑制", () => {
    markGestureSelected(["a", "b"]);
    expect(isGestureSuppressed("a")).toBe(true);
    expect(isGestureSuppressed("b")).toBe(true);
    expect(isGestureSuppressed("c")).toBe(false);
  });

  it("clearGestureSelected(id) 解除单个（模拟真点击该节点 → 允许展开）", () => {
    markGestureSelected(["a", "b"]);
    clearGestureSelected("a");
    expect(isGestureSuppressed("a")).toBe(false); // 被点击 → 可展开
    expect(isGestureSuppressed("b")).toBe(true);  // 未点击 → 仍抑制
  });

  it("clearGestureSelected() 解除全部（模拟点空白/清空选区）", () => {
    markGestureSelected(["a", "b", "c"]);
    clearGestureSelected();
    expect(isGestureSuppressed("a")).toBe(false);
    expect(isGestureSuppressed("b")).toBe(false);
    expect(isGestureSuppressed("c")).toBe(false);
  });

  it("重复标记幂等；未标记 id 的解除是无操作", () => {
    markGestureSelected(["a"]);
    markGestureSelected(["a"]);
    expect(isGestureSuppressed("a")).toBe(true);
    clearGestureSelected("zzz"); // 不存在 → 安全
    expect(isGestureSuppressed("a")).toBe(true);
  });

  it("典型时序：框选选中 3 个(全抑制) → 点其中 1 个(该 1 个可展开，另 2 个仍抑制)", () => {
    markGestureSelected(["n1", "n2", "n3"]); // 框选结束
    expect(["n1", "n2", "n3"].every(isGestureSuppressed)).toBe(true);
    clearGestureSelected("n2"); // 真点击 n2
    expect(isGestureSuppressed("n2")).toBe(false);
    expect(isGestureSuppressed("n1")).toBe(true);
    expect(isGestureSuppressed("n3")).toBe(true);
  });
});
