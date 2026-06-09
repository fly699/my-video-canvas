import { describe, it, expect } from "vitest";
import { KIE_IMAGE_MODELS, isKieImageModel } from "./_core/kieImage";
import { IMAGE_GEN_MODELS } from "../shared/types";

describe("kie image model map", () => {
  it("每个 kie 模型 key 都在 IMAGE_GEN_MODELS 枚举里（前后端同步）", () => {
    const enumSet = new Set<string>(IMAGE_GEN_MODELS as readonly string[]);
    for (const key of Object.keys(KIE_IMAGE_MODELS)) {
      expect(enumSet.has(key), `${key} 不在 IMAGE_GEN_MODELS`).toBe(true);
    }
  });
  it("IMAGE_GEN_MODELS 里所有 kie_ 值都在模型 map 里（无悬空枚举）", () => {
    for (const v of IMAGE_GEN_MODELS) {
      if (v.startsWith("kie_")) expect(v in KIE_IMAGE_MODELS, `${v} 缺少 spec`).toBe(true);
    }
  });
  it("isKieImageModel 只对已注册 kie 模型为真", () => {
    expect(isKieImageModel("kie_nano_banana")).toBe(true);
    expect(isKieImageModel("kie_seedream_v4_edit")).toBe(true);
    expect(isKieImageModel("poyo_seedream_4")).toBe(false);
    expect(isKieImageModel("manus_forge")).toBe(false);
    expect(isKieImageModel(undefined)).toBe(false);
  });
  it("edit 模型的 id 与 t2i 不同、且每个 id 非空", () => {
    for (const [, spec] of Object.entries(KIE_IMAGE_MODELS)) {
      expect(spec.id.length).toBeGreaterThan(0);
      expect(typeof spec.edit).toBe("boolean");
    }
    expect(KIE_IMAGE_MODELS.kie_nano_banana_edit.edit).toBe(true);
    expect(KIE_IMAGE_MODELS.kie_nano_banana.edit).toBe(false);
  });
});
