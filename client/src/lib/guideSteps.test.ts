import { describe, it, expect } from "vitest";
import { GUIDE_STEPS, type GuidePanel } from "./guideSteps";

const VALID_PANELS: (GuidePanel)[] = [
  "nodePicker", "connectionHints", "assets", "charLib", "agentChat", "shortcuts", null,
];

describe("GUIDE_STEPS 新手导览步骤定义", () => {
  it("覆盖足够多的主要功能（≥15 步）", () => {
    expect(GUIDE_STEPS.length).toBeGreaterThanOrEqual(15);
  });

  it("每步 id 唯一", () => {
    const ids = GUIDE_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每步都有标题与至少一段正文", () => {
    for (const s of GUIDE_STEPS) {
      expect(s.title.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(s.body) && s.body.length > 0).toBe(true);
      expect(s.body.every((p) => p.trim().length > 0)).toBe(true);
    }
  });

  it("openPanel 只用允许的面板键", () => {
    for (const s of GUIDE_STEPS) {
      if (s.openPanel !== undefined) {
        expect(VALID_PANELS).toContain(s.openPanel);
      }
    }
  });

  it("target 要么为 null（居中）要么是 CSS 选择器字符串", () => {
    for (const s of GUIDE_STEPS) {
      expect(s.target === null || typeof s.target === "string").toBe(true);
      if (typeof s.target === "string") expect(s.target.length).toBeGreaterThan(0);
    }
  });

  it("interactive 步必须给出 actionHint（否则用户不知要点什么）", () => {
    for (const s of GUIDE_STEPS) {
      if (s.interactive) expect((s.actionHint ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("首步为欢迎、末步为完成，均为居中卡", () => {
    expect(GUIDE_STEPS[0].id).toBe("welcome");
    expect(GUIDE_STEPS[0].target).toBeNull();
    expect(GUIDE_STEPS[GUIDE_STEPS.length - 1].target).toBeNull();
  });
});
