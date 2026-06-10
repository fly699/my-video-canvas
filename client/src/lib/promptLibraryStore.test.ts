import { describe, it, expect, beforeEach } from "vitest";
import { setPromptLibrary, favoriteSlots, promptsInCategory, allCategories, getPromptLibrary, type PromptLibItem } from "./promptLibraryStore";

const P = (over: Partial<PromptLibItem>): PromptLibItem => ({ id: 0, label: "", text: "", category: "通用", slot: null, slotKind: null, sortOrder: 0, ...over });

describe("promptLibraryStore", () => {
  beforeEach(() => setPromptLibrary([]));

  it("favoriteSlots：按 slot 0..9 归位，空槽位为 undefined", () => {
    setPromptLibrary([
      P({ id: 1, label: "A", slot: 0, slotKind: "prompt", text: "a" }),
      P({ id: 2, label: "B", slot: 2, slotKind: "category", category: "镜头" }),
      P({ id: 3, label: "C", slot: null }),
    ]);
    const slots = favoriteSlots();
    expect(slots).toHaveLength(10);
    expect(slots[0]?.label).toBe("A");
    expect(slots[1]).toBeUndefined();
    expect(slots[2]?.slotKind).toBe("category");
  });

  it("promptsInCategory：按 sortOrder/id 排序返回该类提示词", () => {
    setPromptLibrary([
      P({ id: 1, label: "X", category: "光照", sortOrder: 2 }),
      P({ id: 2, label: "Y", category: "光照", sortOrder: 1 }),
      P({ id: 3, label: "Z", category: "镜头" }),
    ]);
    expect(promptsInCategory("光照").map((p) => p.label)).toEqual(["Y", "X"]);
    expect(promptsInCategory("镜头").map((p) => p.label)).toEqual(["Z"]);
  });

  it("allCategories：去重保序", () => {
    setPromptLibrary([P({ id: 1, category: "镜头" }), P({ id: 2, category: "光照" }), P({ id: 3, category: "镜头" })]);
    expect(allCategories()).toEqual(["镜头", "光照"]);
  });

  it("setPromptLibrary / getPromptLibrary 往返", () => {
    const items = [P({ id: 7, label: "G" })];
    setPromptLibrary(items);
    expect(getPromptLibrary()).toHaveLength(1);
    expect(getPromptLibrary()[0].label).toBe("G");
  });
});
