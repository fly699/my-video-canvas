import { describe, it, expect } from "vitest";
import { buildPortraitPrompt, buildScenePrompt, buildCharacterImagePrompt, characterImageAspect, PORTRAIT_ASPECT, SCENE_ASPECT } from "./characterPortrait";
import type { CharacterNodeData } from "../../../shared/types";

const person = (p: Partial<CharacterNodeData> = {}): CharacterNodeData =>
  ({ characterKind: "person", ...p }) as CharacterNodeData;
const scene = (p: Partial<CharacterNodeData> = {}): CharacterNodeData =>
  ({ characterKind: "scene", ...p }) as CharacterNodeData;

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

// ── #271 场景图提示词 + 统一入口（用户实报：勾自动定妆后场景节点没被覆盖） ──────
describe("buildScenePrompt / buildCharacterImagePrompt（#271 场景图）", () => {
  it("含场景描述时生成空镜概念图提示词（无人物、含场景要素）", () => {
    const prompt = buildScenePrompt(scene({ name: "废弃老宅", locationType: "室内", atmosphere: "阴森压抑", sceneDescription: "布满蛛网的客厅", timeOfDay: "深夜" }));
    expect(prompt).toContain("场景概念图");
    expect(prompt).toContain("废弃老宅");
    expect(prompt).toContain("阴森压抑");
    expect(prompt).toContain("不出现任何人物");
    expect(prompt.length).toBeLessThanOrEqual(2000);
  });

  it("name 空时回退 sceneName；人物节点/全空场景返回空串（不烧空生图）", () => {
    expect(buildScenePrompt(scene({ sceneName: "足球场" }))).toContain("足球场");
    expect(buildScenePrompt(person({ name: "李雷", appearance: "短发" }))).toBe("");
    expect(buildScenePrompt(scene())).toBe("");
  });

  it("统一入口按类别分派：人物→定妆照、场景→场景图；比例 3:4 / 16:9", () => {
    const p = person({ name: "李雷", appearance: "短黑发" });
    const s = scene({ sceneName: "海边悬崖", atmosphere: "暴风雨前" });
    expect(buildCharacterImagePrompt(p)).toContain("角色定妆照");
    expect(buildCharacterImagePrompt(s)).toContain("场景概念图");
    expect(characterImageAspect(p)).toBe(PORTRAIT_ASPECT);
    expect(characterImageAspect(s)).toBe(SCENE_ASPECT);
    expect(SCENE_ASPECT).toBe("16:9");
  });
});
