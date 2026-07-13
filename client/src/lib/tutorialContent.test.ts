import { describe, it, expect } from "vitest";
import { TUTORIAL_CHAPTERS, allTutorialImageSlugs } from "./tutorialContent";

describe("TUTORIAL_CHAPTERS 教程内容完整性（#116）", () => {
  it("覆盖全部规划章节（≥13 章）", () => {
    expect(TUTORIAL_CHAPTERS.length).toBeGreaterThanOrEqual(13);
  });

  it("章节 id 唯一、每章有 intro 与至少一节", () => {
    const ids = TUTORIAL_CHAPTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of TUTORIAL_CHAPTERS) {
      expect(c.intro.trim().length).toBeGreaterThan(0);
      expect(c.sections.length).toBeGreaterThan(0);
    }
  });

  it("小节 id 全局唯一（章 id/节 id 组合）且正文非空", () => {
    const seen = new Set<string>();
    for (const c of TUTORIAL_CHAPTERS) for (const s of c.sections) {
      const key = `${c.id}/${s.id}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(s.paragraphs.length).toBeGreaterThan(0);
      expect(s.paragraphs.every((p) => p.trim().length > 0)).toBe(true);
    }
  });

  it("截图 slug 唯一且符合命名规范（小写字母/数字/连字符）", () => {
    const slugs = allTutorialImageSlugs().map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
  });
});
