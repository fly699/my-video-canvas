import { describe, it, expect } from "vitest";
import { composeCharacterEffectPrompt } from "./promptCompose";

describe("composeCharacterEffectPrompt（视频提示词组装·video runner 与逐节点单一事实源）", () => {
  it("空图（无角色/无效果节点）：基础提示词原样透传", () => {
    const r = composeCharacterEffectPrompt("v1", "城市夜景，赛博朋克", [], [], 4000);
    expect(r).toBe("城市夜景，赛博朋克");
  });

  it("空提示词 → 空串", () => {
    expect(composeCharacterEffectPrompt("v1", "", [], [], 4000)).toBe("");
  });

  it("maxLen 生效：超长基础提示词被 cap 到 maxLen 以内", () => {
    const long = "字".repeat(5000);
    const r = composeCharacterEffectPrompt("v1", long, [], [], 4000);
    expect(r.length).toBeLessThanOrEqual(4000);
  });
});
