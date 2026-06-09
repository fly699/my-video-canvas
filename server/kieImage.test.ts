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
  it("每个 id 非空，编辑模型有正确的参考图字段（image_urls vs input_urls）", () => {
    for (const [, spec] of Object.entries(KIE_IMAGE_MODELS)) {
      expect(spec.id.length).toBeGreaterThan(0);
      expect(["aspect_ratio", "image_size"]).toContain(spec.aspect);
    }
    // 编辑模型必须有 ref；Flux-2 / GPT 用 input_urls，Seedream / Nano 用 image_urls（文档约定）。
    expect(KIE_IMAGE_MODELS.kie_nano_banana_edit.ref).toBe("image_urls");
    expect(KIE_IMAGE_MODELS.kie_seedream_v4_edit.ref).toBe("image_urls");
    expect(KIE_IMAGE_MODELS.kie_flux2_pro_i2i.ref).toBe("input_urls");
    expect(KIE_IMAGE_MODELS.kie_gpt_image_15_edit.ref).toBe("input_urls");
    // 文生图模型无 ref。
    expect(KIE_IMAGE_MODELS.kie_nano_banana.ref).toBeUndefined();
    // Seedream 4.0 用 image_size 而非 aspect_ratio。
    expect(KIE_IMAGE_MODELS.kie_seedream_v4.aspect).toBe("image_size");
    expect(KIE_IMAGE_MODELS.kie_nano_banana.aspect).toBe("aspect_ratio");
  });
});
