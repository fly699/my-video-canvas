import { describe, it, expect } from "vitest";
import {
  resolveNodeModel, resolveCategoryModel, normalizeSystemDefaultModels, FACTORY_DEFAULT_MODELS,
} from "../shared/nodeDefaultModels";

describe("normalizeSystemDefaultModels", () => {
  it("对象：只留合法槽位的非空字符串，去空白", () => {
    expect(normalizeSystemDefaultModels({ llm: " kie_x ", image: "img1", bogus: "y", video: 3, transcribe: "" }))
      .toEqual({ llm: "kie_x", image: "img1" });
  });
  it("字符串（MariaDB JSON 返回）：先 JSON.parse", () => {
    expect(normalizeSystemDefaultModels('{"video":"kie_v"}')).toEqual({ video: "kie_v" });
  });
  it("非法输入 → 空对象", () => {
    expect(normalizeSystemDefaultModels(null)).toEqual({});
    expect(normalizeSystemDefaultModels("not json")).toEqual({});
    expect(normalizeSystemDefaultModels(42)).toEqual({});
  });
});

describe("resolveNodeModel —— 系统默认插在项目配置与出厂默认之间", () => {
  it("无任何配置 → 出厂默认", () => {
    expect(resolveNodeModel(null, "ai_chat", "llm")).toBe(FACTORY_DEFAULT_MODELS.llm);
  });
  it("仅系统默认 → 用系统默认（覆盖出厂）", () => {
    expect(resolveNodeModel(null, "ai_chat", "llm", { llm: "sys_llm" })).toBe("sys_llm");
  });
  it("项目 category 覆盖系统默认", () => {
    expect(resolveNodeModel({ categories: { llm: "proj_llm" } }, "ai_chat", "llm", { llm: "sys_llm" })).toBe("proj_llm");
  });
  it("项目 perSlot 最高优先级", () => {
    expect(resolveNodeModel({ perSlot: { "storyboard.image": "exact" }, categories: { image: "proj" } }, "storyboard", "image", { image: "sys" }))
      .toBe("exact");
  });
  it("系统默认只对设了的槽位生效，其它槽位仍出厂默认", () => {
    expect(resolveNodeModel(null, "image_gen", "image", { llm: "sys_llm" })).toBe(FACTORY_DEFAULT_MODELS.image);
  });
});

describe("resolveCategoryModel —— 系统默认层级", () => {
  it("项目 category > 系统默认 > 出厂默认", () => {
    expect(resolveCategoryModel({ categories: { video: "proj_v" } }, "video", { video: "sys_v" })).toBe("proj_v");
    expect(resolveCategoryModel(null, "video", { video: "sys_v" })).toBe("sys_v");
    expect(resolveCategoryModel(null, "video")).toBe(FACTORY_DEFAULT_MODELS.video);
  });
});
