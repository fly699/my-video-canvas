import { describe, it, expect } from "vitest";
import { buildRecognitionRows } from "./characterRecognition";
import type { CharacterNodeData } from "../../../shared/types";

describe("buildRecognitionRows", () => {
  it("skips empty recognized values; maps labels", () => {
    const rows = buildRecognitionRows({}, { name: "Alice", age: "  ", appearance: "红裙" });
    expect(rows.map((r) => r.key)).toEqual(["name", "appearance"]);
    expect(rows.find((r) => r.key === "name")?.label).toBe("角色名");
  });

  it("default-checks fields that differ from current, unchecks identical (no-op)", () => {
    const payload: CharacterNodeData = { name: "Alice", outfit: "黑西装" };
    const rows = buildRecognitionRows(payload, { name: "Alice", outfit: "红裙", age: "青年" });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.name.defaultChecked).toBe(false); // identical → no-op
    expect(byKey.outfit.defaultChecked).toBe(true); // differs → checked
    expect(byKey.outfit.current).toBe("黑西装");
    expect(byKey.age.defaultChecked).toBe(true); // current empty → checked
    expect(byKey.age.current).toBe("");
  });

  it("works for scene fields too", () => {
    const rows = buildRecognitionRows({ characterKind: "scene" }, { sceneName: "夜街", timeOfDay: "夜晚" });
    expect(rows.find((r) => r.key === "timeOfDay")?.label).toBe("时间");
    expect(rows.length).toBe(2);
  });
});
