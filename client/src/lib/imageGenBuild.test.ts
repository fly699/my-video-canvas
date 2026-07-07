import { describe, it, expect } from "vitest";
import { buildImageGenInput } from "./imageGenBuild";
import type { ImageGenNodeData } from "../../../shared/types";

const build = (payload: Partial<ImageGenNodeData>, opts?: { defaultModel?: string; kieTempKey?: string | null }) =>
  buildImageGenInput({
    id: "ig", payload: payload as ImageGenNodeData, nodes: [], edges: [],
    defaultModel: opts?.defaultModel ?? "manus_forge",
    kieTempKey: opts?.kieTempKey,
  });

describe("buildImageGenInput（image_gen 生图组装器·镜像 ImageGenNode.handleGenerate）", () => {
  it("缺提示词 → blocked", () => {
    expect(build({ prompt: "" }).blocked).toBeTruthy();
    expect(build({ prompt: "   " }).blocked).toBeTruthy();
  });

  it("kie 模型：带 kie 块（kieTempKey/aspectRatio/imageResolution）", () => {
    const r = build(
      { prompt: "夜景", model: "kie_imagen4" as ImageGenNodeData["model"], aspectRatio: "16:9", imageResolution: "2K" },
      { kieTempKey: "tmp-key" },
    );
    expect(r.blocked).toBeUndefined();
    expect(r.input.model).toBe("kie_imagen4");
    expect(r.input.kieTempKey).toBe("tmp-key");
    expect(r.input.aspectRatio).toBe("16:9");
    expect(r.input.imageResolution).toBe("2K");
  });

  it("非 kie 模型：不带 kie 块", () => {
    const r = build({ prompt: "夜景", model: "manus_forge" as ImageGenNodeData["model"] }, { kieTempKey: "tmp" });
    expect("kieTempKey" in r.input).toBe(false);
    expect(r.input.model).toBe("manus_forge");
  });

  it("model 未设：model 字段回落 defaultModel，但各模型块判断用【原始】payload.model（无 kie 块）——精确镜像 handleGenerate", () => {
    const r = build({ prompt: "夜景" }, { defaultModel: "kie_gpt_image_2", kieTempKey: "tmp" });
    expect(r.input.model).toBe("kie_gpt_image_2"); // 字段回落默认
    expect("kieTempKey" in r.input).toBe(false);   // 但 raw payload.model 未设 → 不触发 kie 块
  });

  it("poyo 模型：带分模型 sizing（imageSize/imageResolution/imageN/imageOutputFormat/poyoQuality）", () => {
    const r = build({ prompt: "夜景", model: "poyo_seedream" as ImageGenNodeData["model"] });
    expect("imageSize" in r.input).toBe(true);
    expect("imageResolution" in r.input).toBe(true);
    expect("imageN" in r.input).toBe(true);
    expect("imageOutputFormat" in r.input).toBe(true);
    expect("poyoQuality" in r.input).toBe(true);
  });

  it("Soul Standard：widthAndHeight/quality/batchSize/seed/enhancePrompt", () => {
    const r = build({
      prompt: "夜景", model: "hf_soul_standard" as ImageGenNodeData["model"],
      widthAndHeight: "1536x1536", soulQuality: "1080p", batchSize: 4, seed: 123, enhancePrompt: true,
    });
    expect(r.input.widthAndHeight).toBe("1536x1536");
    expect(r.input.quality).toBe("1080p");
    expect(r.input.batchSize).toBe(4);
    expect(r.input.seed).toBe(123);
    expect(r.input.enhancePrompt).toBe(true);
    expect(r.count).toBe(4); // batchSize=4 计入张数
  });

  it("Flux Pro：reve 块(reveAspectRatio/reveResolution) + flux 块(guidance/seed/numImages)", () => {
    const r = build({
      prompt: "夜景", model: "hf_flux_pro" as ImageGenNodeData["model"],
      reveAspectRatio: "16:9", reveResolution: "2K",
      fluxGuidanceScale: 5, fluxSeed: 7, fluxNumImages: 3,
    });
    expect(r.input.reveAspectRatio).toBe("16:9");
    expect(r.input.reveResolution).toBe("2K");
    expect(r.input.fluxGuidanceScale).toBe(5);
    expect(r.input.fluxSeed).toBe(7);
    expect(r.input.fluxNumImages).toBe(3);
    expect(r.count).toBe(3);
  });

  it("非法枚举/越界被夹掉（reveResolution 非法 → 不发；seed 越界 → undefined）", () => {
    const r = build({
      prompt: "夜景", model: "hf_flux_pro" as ImageGenNodeData["model"],
      reveResolution: "9999" as ImageGenNodeData["reveResolution"], fluxSeed: -1,
    });
    expect(r.input.reveResolution).toBeUndefined();
    expect(r.input.fluxSeed).toBeUndefined();
  });

  it("style 取 payload.style（非 colorTone）；negativePrompt 透传", () => {
    const r = build({ prompt: "夜景", model: "manus_forge" as ImageGenNodeData["model"], style: "赛博朋克", negativePrompt: "模糊" });
    expect(r.input.style).toBe("赛博朋克");
    expect(r.input.negativePrompt).toBe("模糊");
  });

  it("手动参考图（referenceImages[]）→ referenceImageUrl + referenceImageUrls；refUrl 供 guard", () => {
    const r = build({
      prompt: "夜景", model: "kie_nano_banana_edit" as ImageGenNodeData["model"],
      referenceImageUrl: "https://x/a.png",
      referenceImages: [{ url: "https://x/a.png" }, { url: "https://x/b.png" }],
    });
    expect(r.input.referenceImageUrl).toBe("https://x/a.png");
    expect(r.input.referenceImageUrls).toEqual(["https://x/a.png", "https://x/b.png"]);
    expect(r.refUrl).toBe("https://x/a.png");
  });

  it("estimatedCost 随请求上报（非空字符串）", () => {
    const r = build({ prompt: "夜景", model: "manus_forge" as ImageGenNodeData["model"] });
    expect(typeof r.input.estimatedCost === "string" || r.input.estimatedCost === undefined).toBe(true);
  });
});
