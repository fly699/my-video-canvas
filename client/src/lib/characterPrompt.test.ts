import { describe, it, expect } from "vitest";
import { characterToPromptInjection, mergeCharactersIntoPrompt } from "./characterPrompt";
import type { CharacterNodeData } from "../../../shared/types";

const c = (over: Partial<CharacterNodeData>): CharacterNodeData => ({ characterKind: "person", ...over });

// #225 外观锚点短语：压缩注入（默认）/ 全量注入 切换
describe("characterToPromptInjection appearance anchor (#225)", () => {
  const full = c({
    name: "Alice", role: "侦探", age: "30岁", gender: "女",
    appearance: "银灰色短发，锐利的绿色眼睛，身材高挑", outfit: "黑色风衣配红围巾",
    personality: "冷静多疑", signature: "左眼下有一道疤痕",
  });

  it("anchor present → compressed 「名字，身份，锚点」, full fields NOT injected", () => {
    const out = characterToPromptInjection({ ...full, appearanceAnchor: "银灰短发、左眼疤痕、黑风衣红围巾" });
    expect(out).toBe("Alice，侦探，银灰短发、左眼疤痕、黑风衣红围巾");
    expect(out).not.toContain("锐利的绿色眼睛");
    expect(out).not.toContain("冷静多疑");
  });

  it("appearanceAnchorEnabled === false → byte-identical to no-anchor full injection", () => {
    const withOff = characterToPromptInjection({ ...full, appearanceAnchor: "银灰短发、左眼疤痕", appearanceAnchorEnabled: false });
    const without = characterToPromptInjection(full);
    expect(withOff).toBe(without);
    expect(withOff).toContain("锐利的绿色眼睛");
  });

  it("empty / whitespace anchor → unchanged full injection (opt-in only)", () => {
    expect(characterToPromptInjection({ ...full, appearanceAnchor: "" })).toBe(characterToPromptInjection(full));
    expect(characterToPromptInjection({ ...full, appearanceAnchor: "   " })).toBe(characterToPromptInjection(full));
  });

  it("customPromptTemplate takes precedence over the anchor", () => {
    const out = characterToPromptInjection({ ...full, appearanceAnchor: "银灰短发", customPromptTemplate: "主角{name}身穿{outfit}" });
    expect(out).toBe("主角Alice身穿黑色风衣配红围巾");
    expect(out).not.toContain("银灰短发");
  });

  it("scene kind ignores the anchor entirely", () => {
    const scene = c({ characterKind: "scene", sceneName: "夜街", sceneDescription: "霓虹灯下的湿滑街道", appearanceAnchor: "不该出现" });
    expect(characterToPromptInjection(scene)).not.toContain("不该出现");
  });

  it("name/role missing → anchor-only injection without dangling separators", () => {
    const out = characterToPromptInjection(c({ appearanceAnchor: "银灰短发、黑风衣" }));
    expect(out).toBe("银灰短发、黑风衣");
  });

  it("merge path uses the compressed form too", () => {
    const out = mergeCharactersIntoPrompt("在公园散步", [{ ...full, appearanceAnchor: "银灰短发、左眼疤痕" }]);
    expect(out).toContain("银灰短发、左眼疤痕");
    expect(out).not.toContain("锐利的绿色眼睛");
    expect(out.endsWith("在公园散步")).toBe(true);
  });
});

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

describe("mergeCharactersIntoPrompt maxLength budgeting", () => {
  it("never exceeds maxLength and PRESERVES the full base prompt", () => {
    const base = "镜头：一个人在沙漠中行走。".repeat(10); // ~130 chars
    const longAppearance = "细节".repeat(2000); // huge injection
    const out = mergeCharactersIntoPrompt(base, [c({ name: "Alice", appearance: longAppearance })], 4000);
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(out.endsWith(base)).toBe(true); // base prompt fully retained at the end
  });

  it("base alone over the limit → clamped base, injection dropped", () => {
    const base = "x".repeat(5000);
    const out = mergeCharactersIntoPrompt(base, [c({ name: "Alice" })], 4000);
    expect(out.length).toBe(4000);
    expect(out).not.toContain("Alice");
  });

  it("empty base → clamps the prefix to maxLength", () => {
    const out = mergeCharactersIntoPrompt("", [c({ name: "Alice", appearance: "红".repeat(5000) })], 100);
    expect(out.length).toBeLessThanOrEqual(100);
  });

  it("under budget → identical to the no-maxLength result", () => {
    const chars = [c({ name: "Alice" }), c({ name: "Bob" })];
    expect(mergeCharactersIntoPrompt("对话", chars, 4000)).toBe(mergeCharactersIntoPrompt("对话", chars));
  });
});

describe("mergeCharactersIntoPrompt scene labelling", () => {
  it("numbers person and scene with INDEPENDENT counters (per-kind)", () => {
    const out = mergeCharactersIntoPrompt("", [
      c({ name: "Alice" }),
      c({ characterKind: "scene", sceneName: "夜街" }),
    ]);
    expect(out).toContain("角色1：");
    expect(out).toContain("场景1："); // scene gets its own counter, not 场景2
  });

  it("person ordinals align with person-only reference order across interleaved scenes", () => {
    // [personA, scene, personB] — reference images are person-only [A, B], so the
    // prompt's 角色N must count persons only: A→角色1, B→角色2 (scene must NOT bump it).
    const out = mergeCharactersIntoPrompt("", [
      c({ name: "Alice" }),
      c({ characterKind: "scene", sceneName: "夜街" }),
      c({ name: "Bob" }),
    ]);
    expect(out).toContain("角色1：");
    expect(out).toContain("场景1：");
    expect(out).toContain("角色2："); // Bob is the 2nd PERSON → aligns with 2nd ref image
    expect(out).not.toContain("角色3");
    const iA = out.indexOf("Alice"), iB = out.indexOf("Bob");
    expect(iB).toBeGreaterThan(iA); // block order still position-preserved
  });
});
