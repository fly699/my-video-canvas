import { describe, it, expect } from "vitest";
import { mergeCharactersIntoPrompt } from "./characterPrompt";
import type { CharacterNodeData } from "../../../shared/types";

const c = (over: Partial<CharacterNodeData>): CharacterNodeData => ({ characterKind: "person", ...over });

describe("mergeCharactersIntoPrompt", () => {
  it("single character → bracketed block, no ordinal", () => {
    const out = mergeCharactersIntoPrompt("在公园散步", [c({ name: "Alice", appearance: "红裙" })]);
    expect(out.startsWith("[")).toBe(true);
    expect(out).not.toContain("角色1");
    expect(out).toContain("Alice");
    expect(out.endsWith("在公园散步")).toBe(true);
  });

  it("multiple characters → numbered 角色1/角色2 for ordered reference alignment", () => {
    const out = mergeCharactersIntoPrompt("对话", [c({ name: "Alice" }), c({ name: "Bob" })]);
    expect(out).toContain("[角色1：");
    expect(out).toContain("[角色2：");
    const i1 = out.indexOf("角色1"), i2 = out.indexOf("角色2");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1); // order preserved
  });

  it("empty characters → base prompt unchanged", () => {
    expect(mergeCharactersIntoPrompt("hello", [])).toBe("hello");
    expect(mergeCharactersIntoPrompt("hello", [c({})])).toBe("hello"); // empty char renders nothing
  });

  it("empty base + character → just the block", () => {
    expect(mergeCharactersIntoPrompt("", [c({ name: "Z" })])).toBe("[Z]");
  });
});

describe("mergeCharactersIntoPrompt scene labelling", () => {
  it("labels person vs scene with kind-appropriate ordinals", () => {
    const out = mergeCharactersIntoPrompt("", [
      c({ name: "Alice" }),
      c({ characterKind: "scene", sceneName: "夜街" }),
    ]);
    expect(out).toContain("角色1：");
    expect(out).toContain("场景2：");
  });
});
