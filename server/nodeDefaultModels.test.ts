// #249 出厂槽位默认守卫：agent.llm 出厂默认 = 本机 Claude Opus（用户拍板），且任何
// 显式配置（项目 perSlot/category、管理员系统默认）都必须盖过它——用户设置永远第一位。
import { describe, it, expect } from "vitest";
import { resolveNodeModel, resolveCategoryModel, FACTORY_SLOT_DEFAULTS, FACTORY_DEFAULT_MODELS } from "../shared/nodeDefaultModels";

describe("FACTORY_SLOT_DEFAULTS (agent.llm → claude-local:opus)", () => {
  it("无任何配置时，画布助手规划（agent.llm）出厂默认为本机 Claude Opus", () => {
    expect(FACTORY_SLOT_DEFAULTS["agent.llm"]).toBe("claude-local:opus");
    expect(resolveNodeModel(null, "agent", "llm")).toBe("claude-local:opus");
  });

  it("其它节点的 llm 槽不受影响（仍走类别出厂默认）", () => {
    expect(resolveNodeModel(null, "script", "llm")).toBe(FACTORY_DEFAULT_MODELS.llm);
    expect(resolveNodeModel(null, "ai_chat", "llm")).toBe(FACTORY_DEFAULT_MODELS.llm);
    expect(resolveCategoryModel(null, "llm")).toBe(FACTORY_DEFAULT_MODELS.llm);
  });

  it("显式配置全部盖过出厂槽位默认：项目 perSlot > 项目 category > 系统默认", () => {
    expect(resolveNodeModel({ perSlot: { "agent.llm": "kie_gpt_5_2" } }, "agent", "llm")).toBe("kie_gpt_5_2");
    expect(resolveNodeModel({ categories: { llm: "kie_gpt_5_2" } }, "agent", "llm")).toBe("kie_gpt_5_2");
    expect(resolveNodeModel(null, "agent", "llm", { llm: "kie_gpt_5_2" })).toBe("kie_gpt_5_2");
  });

  it("agent 的非 llm 槽不受槽位默认影响", () => {
    expect(resolveNodeModel(null, "agent", "image")).toBe(FACTORY_DEFAULT_MODELS.image);
  });
});
