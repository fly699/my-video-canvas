import { describe, it, expect } from "vitest";
import { modelGroupOrder } from "./models";

describe("modelGroupOrder — 自建 LLM 必须置顶（否则被埋在 kie 列表最底，用户配了却看不到）", () => {
  it("SelfHosted 排在所有云端平台之前", () => {
    for (const p of ["Forge", "Manus", "Kie", "Poyo", "Higgsfield", "Dev"]) {
      expect(modelGroupOrder("SelfHosted")).toBeLessThan(modelGroupOrder(p));
    }
  });

  it("一组混合模型按平台排序后，SelfHosted 在最前", () => {
    const providers = ["Kie", "Forge", "SelfHosted", "Poyo", "Kie"];
    const sorted = providers.slice().sort((a, b) => modelGroupOrder(a) - modelGroupOrder(b));
    expect(sorted[0]).toBe("SelfHosted");
  });

  it("既有平台相对顺序不变（Forge<Kie<Poyo<Higgsfield）", () => {
    expect(modelGroupOrder("Forge")).toBeLessThan(modelGroupOrder("Kie"));
    expect(modelGroupOrder("Kie")).toBeLessThan(modelGroupOrder("Poyo"));
    expect(modelGroupOrder("Poyo")).toBeLessThan(modelGroupOrder("Higgsfield"));
  });

  it("金泰（本机 CLI）排在 Kie、Poyo 之前（用户明确要求）", () => {
    expect(modelGroupOrder("金泰")).toBeLessThan(modelGroupOrder("Kie"));
    expect(modelGroupOrder("金泰")).toBeLessThan(modelGroupOrder("Poyo"));
    // 但仍在内置 Manus/Forge 之后，不喧宾夺主
    expect(modelGroupOrder("Manus")).toBeLessThanOrEqual(modelGroupOrder("金泰"));
  });
});
