import { describe, it, expect } from "vitest";
import { parseSkillFrontmatter } from "./_core/bridgeSkills";

describe("parseSkillFrontmatter", () => {
  it("取 frontmatter 的 name / description，去成对引号", () => {
    const md = `---\nname: fenjing\ndescription: "分镜脚本助手，做镜头表"\n---\n\n# 正文\n忽略正文`;
    expect(parseSkillFrontmatter(md)).toEqual({ name: "fenjing", description: "分镜脚本助手，做镜头表" });
  });
  it("字段顺序无关、大小写键容错", () => {
    const md = `---\nDescription: 提取发票\nName: fapiao\n---\nbody`;
    expect(parseSkillFrontmatter(md)).toEqual({ name: "fapiao", description: "提取发票" });
  });
  it("CRLF + 单引号也能解", () => {
    const md = "---\r\nname: 'x'\r\ndescription: y\r\n---\r\nbody";
    expect(parseSkillFrontmatter(md)).toEqual({ name: "x", description: "y" });
  });
  it("无 frontmatter → 空串（调用方回退目录名）", () => {
    expect(parseSkillFrontmatter("# 只有正文\n没有头部")).toEqual({ name: "", description: "" });
    expect(parseSkillFrontmatter("")).toEqual({ name: "", description: "" });
  });
  it("只有 name 没 description", () => {
    expect(parseSkillFrontmatter("---\nname: solo\n---\n")).toEqual({ name: "solo", description: "" });
  });
});
