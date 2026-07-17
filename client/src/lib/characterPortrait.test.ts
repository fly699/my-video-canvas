import { describe, it, expect } from "vitest";
import { buildPortraitPrompt, PORTRAIT_ASPECT } from "./characterPortrait";
import type { CharacterNodeData } from "../../../shared/types";

const person = (p: Partial<CharacterNodeData> = {}): CharacterNodeData =>
  ({ characterKind: "person", ...p }) as CharacterNodeData;

describe("buildPortraitPrompt（定妆照提示词，与角色卡/助手自动定妆共用）", () => {
  it("含角色描述时生成定妆照提示词（带主体描述与定妆规范要素）", () => {
    const prompt = buildPortraitPrompt(person({ name: "李雷", appearance: "短黑发，剑眉星目", outfit: "藏青色风衣" }));
    expect(prompt).toContain("角色定妆照");
    expect(prompt).toContain("李雷");
    expect(prompt).toContain("短黑发");
    expect(prompt).toContain("全身像");
    expect(prompt).toContain("背景");
    expect(prompt.length).toBeLessThanOrEqual(2000);
  });

  it("场景节点不做人物定妆：返回空串", () => {
    expect(buildPortraitPrompt({ characterKind: "scene", sceneName: "老宅", sceneDescription: "废弃老宅" } as CharacterNodeData)).toBe("");
  });

  it("角色无任何可用描述时返回空串（调用方应跳过，不烧空生图）", () => {
    expect(buildPortraitPrompt(person())).toBe("");
    expect(buildPortraitPrompt(person({ name: "  " }))).toBe("");
  });

  it("结构化注入为空时回退 name/appearance/outfit/role 直拼", () => {
    // customPromptTemplate 渲染为空 → 走字段直拼兜底
    const prompt = buildPortraitPrompt(person({ customPromptTemplate: "{signature}", name: "韩梅梅", role: "侦探" }));
    expect(prompt).toContain("韩梅梅");
    expect(prompt).toContain("侦探");
  });

  it("比例为竖构图 3:4", () => {
    expect(PORTRAIT_ASPECT).toBe("3:4");
  });
});
