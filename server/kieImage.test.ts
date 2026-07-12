import { describe, it, expect } from "vitest";
import { KIE_IMAGE_MODELS, isKieImageModel, kieImageSupportsNegative, KIE_T2I_TO_I2I, clampAspectTo } from "./_core/kieImage";
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
      expect(["aspect_ratio", "image_size", "image_size_raw"]).toContain(spec.aspect);
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

  it("aspect_ratio 模型都带非空枚举（防 422 空/越界）；image_size 模型不需要枚举", () => {
    for (const [k, s] of Object.entries(KIE_IMAGE_MODELS)) {
      if (s.aspect === "aspect_ratio") {
        expect(s.aspects && s.aspects.length > 0, `${k} 缺 aspects 枚举`).toBe(true);
      }
    }
    // GPT Image 只接受 1:1 / 2:3 / 3:2（不含 16:9）——默认必须落在枚举内。
    expect(KIE_IMAGE_MODELS.kie_gpt_image_15.aspects).not.toContain("16:9");
    expect(KIE_IMAGE_MODELS.kie_grok_image.aspects).toContain("16:9");
  });

  it("专属端点模型 endpoint/ref 字段正确（Flux Kontext / OpenAI 4o）", () => {
    expect(KIE_IMAGE_MODELS.kie_flux_kontext_pro.endpoint).toBe("flux-kontext");
    expect(KIE_IMAGE_MODELS.kie_flux_kontext_max.endpoint).toBe("flux-kontext");
    expect(KIE_IMAGE_MODELS.kie_flux_kontext_pro.ref).toBe("inputImage"); // 单数，可选编辑图
    expect(KIE_IMAGE_MODELS.kie_gpt_4o_image.endpoint).toBe("gpt4o");
    expect(KIE_IMAGE_MODELS.kie_gpt_4o_image.ref).toBe("filesUrl");       // 数组 ≤5
    expect(KIE_IMAGE_MODELS.kie_gpt_4o_image.aspect).toBe("image_size_raw"); // size 字段
    // 4o size 仅 1:1 / 3:2 / 2:3（不含 16:9）。
    expect(KIE_IMAGE_MODELS.kie_gpt_4o_image.aspects).not.toContain("16:9");
  });

  it("negPrompt 标志恰好覆盖文档支持 negative_prompt 的图像模型（Imagen4 家族/Ideogram V3/Qwen 系列）", () => {
    // 依据 docs/kie-api.md：仅这些图像模型的 input schema 含 negative_prompt。
    const expectedNeg = new Set([
      "kie_imagen4", "kie_imagen4_fast", "kie_imagen4_ultra",
      "kie_ideogram_v3", "kie_qwen_image", "kie_qwen_image_i2i", "kie_qwen_image_edit",
    ]);
    const actualNeg = new Set(
      Object.entries(KIE_IMAGE_MODELS).filter(([, s]) => s.negPrompt).map(([k]) => k),
    );
    expect(actualNeg).toEqual(expectedNeg);
    // helper 与标志一致；不支持者（nano-banana/seedream/gpt-image-2/grok…）为 false。
    expect(kieImageSupportsNegative("kie_imagen4")).toBe(true);
    expect(kieImageSupportsNegative("kie_qwen_image_edit")).toBe(true);
    expect(kieImageSupportsNegative("kie_nano_banana")).toBe(false);
    expect(kieImageSupportsNegative("kie_gpt_image_2")).toBe(false);
    expect(kieImageSupportsNegative("poyo_seedream_4")).toBe(false);
    expect(kieImageSupportsNegative(undefined)).toBe(false);
  });

  // 2026-07 真实故障回归：t2i 模型带参考图时 jobs 分支静默丢参考（画面推演产物与源图无关）。
  describe("KIE_T2I_TO_I2I 文生图→图生图自动切换映射", () => {
    it("每对配对：键为无 ref 的 t2i、值为有 ref 的 i2i，且同族同版本", () => {
      for (const [t2i, i2i] of Object.entries(KIE_T2I_TO_I2I)) {
        const a = KIE_IMAGE_MODELS[t2i], b = KIE_IMAGE_MODELS[i2i];
        expect(a, `${t2i} 不在模型表`).toBeTruthy();
        expect(b, `${i2i} 不在模型表`).toBeTruthy();
        expect(a.ref, `${t2i} 应为纯文生图`).toBeUndefined();
        expect(b.ref, `${i2i} 应有参考图字段`).toBeTruthy();
        expect(a.family).toBe(b.family);
        expect(a.endpoint ?? "jobs").toBe("jobs"); // 专属端点(flux-kontext/gpt4o)本就支持可选参考图，不参与切换
      }
    });
    it("默认模型 GPT Image 2 必须在映射里（画面推演主通道）", () => {
      expect(KIE_T2I_TO_I2I.kie_gpt_image_2).toBe("kie_gpt_image_2_i2i");
    });
    it("无同版编辑兄弟的模型不得乱配（Seedream 4.5 / Imagen / Grok / Wan / Z-Image）", () => {
      for (const k of ["kie_seedream_45", "kie_imagen4", "kie_grok_image", "kie_wan27_image", "kie_z_image", "kie_nano_banana_pro", "kie_nano_banana_2"]) {
        expect(k in KIE_T2I_TO_I2I, `${k} 不应出现在映射`).toBe(false);
      }
    });
  });

  describe("clampAspectTo 比例就近夹取（旧行为一律回落首位 → 21:9 源图被夹成方图）", () => {
    const A_GPT2 = KIE_IMAGE_MODELS.kie_gpt_image_2.aspects!;
    it("命中枚举原样返回；未传比例回枚举首位默认", () => {
      expect(clampAspectTo(A_GPT2, "16:9")).toBe("16:9");
      expect(clampAspectTo(A_GPT2, undefined)).toBe(A_GPT2[0]);
    });
    it("未命中时按数值就近：2.39:1 宽幅 → 21:9；非数值串回首位", () => {
      expect(clampAspectTo(["1:1", "16:9", "21:9"], "2.39:1")).toBe("21:9");
      expect(clampAspectTo(["1:1", "3:2"], "16:9")).toBe("3:2"); // GPT Image 1.5 无 16:9 → 就近 3:2 而非 1:1
      expect(clampAspectTo(["1:1", "3:2"], "garbage")).toBe("1:1");
    });
    it("auto 等非数值令牌不参与就近比较（不会把 21:9 就近到 auto）", () => {
      expect(clampAspectTo(["auto", "1:1", "21:9"], "2.2:1")).toBe("21:9");
    });
    it("未传比例且枚举含 auto → 用 auto（i2i 下跟随输入图画幅，防编辑请求被压成首位 1:1）", () => {
      expect(clampAspectTo(["1:1", "9:16", "auto"], undefined)).toBe("auto"); // nano-banana-edit 场景
      expect(clampAspectTo(["1:1", "3:2"], undefined)).toBe("1:1");           // 无 auto 仍回首位
    });
  });

  it("有额外必填参数的模型带 fixed 默认（Seedream4.5/GPT quality、Flux resolution）", () => {
    expect(KIE_IMAGE_MODELS.kie_seedream_45.fixed).toMatchObject({ quality: expect.any(String) });
    expect(KIE_IMAGE_MODELS.kie_gpt_image_15.fixed).toMatchObject({ quality: expect.any(String) });
    expect(KIE_IMAGE_MODELS.kie_gpt_image_15_edit.fixed).toMatchObject({ quality: expect.any(String) });
    expect(KIE_IMAGE_MODELS.kie_flux2_pro.fixed).toMatchObject({ resolution: expect.any(String) });
    expect(KIE_IMAGE_MODELS.kie_flux2_pro_i2i.fixed).toMatchObject({ resolution: expect.any(String) });
  });
});
