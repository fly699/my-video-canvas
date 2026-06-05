import { describe, it, expect } from "vitest";
import { NODE_CATEGORIES, categoryOf } from "./nodeCategories";
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
});
