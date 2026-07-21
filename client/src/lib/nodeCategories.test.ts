import { describe, it, expect } from "vitest";
import { NODE_CATEGORIES, categoryOf, MAIN_FLOW_TYPES } from "./nodeCategories";
import { NODE_TYPE_LIST } from "./nodeConfig";

describe("NODE_CATEGORIES", () => {
  it("covers every node type exactly once", () => {
    const all = NODE_TYPE_LIST.map((c) => c.type).sort();
    const categorized = NODE_CATEGORIES.flatMap((c) => c.types).sort();
    // no duplicates across categories
    expect(new Set(categorized).size).toBe(categorized.length);
    // exact coverage — nothing missing, nothing extra
    expect(categorized).toEqual(all);
  });

  it("categoryOf returns a defined category for every type", () => {
    for (const c of NODE_TYPE_LIST) {
      expect(NODE_CATEGORIES.some((cat) => cat.id === categoryOf(c.type))).toBe(true);
    }
  });

  // #93 主流程快捷区守卫：每个主流程类型必须真实存在且可用（非 comingSoon 占位）、
  // 且同时归属于某个分类（主流程只是快捷重复入口，不允许出现"只在主流程、不在分类"
  // 的孤儿类型——否则搜索/右键等其它入口会找不到它）。
  it("MAIN_FLOW_TYPES are real, usable, and each belongs to a category", () => {
    expect(MAIN_FLOW_TYPES.length).toBeGreaterThan(0);
    expect(new Set(MAIN_FLOW_TYPES).size).toBe(MAIN_FLOW_TYPES.length); // 不重复
    for (const t of MAIN_FLOW_TYPES) {
      const cfg = NODE_TYPE_LIST.find((c) => c.type === t);
      expect(cfg, `主流程类型 ${t} 不存在于 NODE_CONFIGS`).toBeTruthy();
      expect(cfg?.comingSoon, `主流程类型 ${t} 是 comingSoon 占位，不可入主流程`).not.toBe(true);
      expect(NODE_CATEGORIES.some((cat) => cat.types.includes(t)), `主流程类型 ${t} 未归类`).toBe(true);
    }
  });
});
