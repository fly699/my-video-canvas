// #203 模型技能库：种子格式守卫 + DB(devStore) 覆盖/回退/停用合并语义。
import { describe, it, expect } from "vitest";
import { MODEL_SKILL_SEEDS } from "../shared/modelSkillSeeds";
import { getMergedModelSkills, getModelSkillText, MODEL_SKILL_KINDS } from "./_core/modelSkills";
import { devUpsertModelSkill, devDeleteModelSkill } from "./_core/devStore";

describe("模型技能库种子（shared/modelSkillSeeds）", () => {
  it("modelId 全局唯一、tips/source 非空、kind 合法", () => {
    const ids = new Set<string>();
    for (const s of MODEL_SKILL_SEEDS) {
      expect(ids.has(s.modelId), `duplicate seed modelId: ${s.modelId}`).toBe(false);
      ids.add(s.modelId);
      expect(s.tips.trim().length).toBeGreaterThan(0);
      expect(s.source.trim().length).toBeGreaterThan(0);
      expect(MODEL_SKILL_KINDS).toContain(s.kind);
    }
    expect(MODEL_SKILL_SEEDS.length).toBeGreaterThanOrEqual(20); // 首批家族展开后的规模守卫
  });
});

describe("合并读取（DB 覆盖种子 / 回退 / 停用）", () => {
  it("默认：种子全部以 builtin 出现且 enabled", async () => {
    const all = await getMergedModelSkills();
    const grok = all.find((s) => s.modelId === "kie_grok_i2v");
    expect(grok?.origin).toBe("builtin");
    expect(grok?.enabled).toBe(true);
    expect(await getModelSkillText("kie_grok_i2v")).toContain("英文");
  });

  it("DB 覆盖种子 → overridden；停用后 getModelSkillText 返回 null；删除回退 builtin", async () => {
    devUpsertModelSkill({ modelId: "kie_grok_i2v", kind: "video", tips: "自定义技法 A", source: "手工", enabled: true });
    let hit = (await getMergedModelSkills()).find((s) => s.modelId === "kie_grok_i2v");
    expect(hit?.origin).toBe("overridden");
    expect(await getModelSkillText("kie_grok_i2v")).toBe("自定义技法 A");

    devUpsertModelSkill({ modelId: "kie_grok_i2v", kind: "video", tips: "自定义技法 A", enabled: false });
    expect(await getModelSkillText("kie_grok_i2v")).toBeNull();

    devDeleteModelSkill("kie_grok_i2v");
    hit = (await getMergedModelSkills()).find((s) => s.modelId === "kie_grok_i2v");
    expect(hit?.origin).toBe("builtin");
    expect(await getModelSkillText("kie_grok_i2v")).toContain("英文");
  });

  it("DB 新增种子外模型 → custom；删除后彻底消失", async () => {
    devUpsertModelSkill({ modelId: "my_custom_model", kind: "llm", tips: "自定义模型技法" });
    let hit = (await getMergedModelSkills()).find((s) => s.modelId === "my_custom_model");
    expect(hit?.origin).toBe("custom");
    expect(await getModelSkillText("my_custom_model")).toBe("自定义模型技法");
    devDeleteModelSkill("my_custom_model");
    expect((await getMergedModelSkills()).some((s) => s.modelId === "my_custom_model")).toBe(false);
  });
});
