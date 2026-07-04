import { describe, it, expect } from "vitest";
import { injectLoraChain } from "./_core/comfyui";

// Minimal AnimateDiff-shaped graph: CheckpointLoaderSimple("4") feeds model→AnimateDiff("12"),
// clip→CLIPTextEncode("6"/"7"), vae→VAEDecode("8").
const ckptGraph = () => ({
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "x.safetensors" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "pos", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "neg", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "12": { class_type: "ADE_AnimateDiffLoaderGen1", inputs: { model: ["4", 0] } },
});

describe("injectLoraChain", () => {
  it("is a no-op with no loras", () => {
    const g = ckptGraph();
    expect(injectLoraChain(g, [])).toEqual(g);
  });

  it("threads a LoRA off the checkpoint and rewires model/clip consumers", () => {
    const out = injectLoraChain(ckptGraph(), [{ name: "hero.safetensors", strengthModel: 0.8 }]);
    // LoRA node created, consuming the original checkpoint refs
    expect(out["char_lora_0"].class_type).toBe("LoraLoader");
    expect(out["char_lora_0"].inputs.model).toEqual(["4", 0]);
    expect(out["char_lora_0"].inputs.clip).toEqual(["4", 1]);
    // Consumers redirected to the LoRA outputs
    expect(out["12"].inputs.model).toEqual(["char_lora_0", 0]);
    expect(out["6"].inputs.clip).toEqual(["char_lora_0", 1]);
    expect(out["7"].inputs.clip).toEqual(["char_lora_0", 1]);
    // VAE (index 2) untouched
    expect(out["8"].inputs.vae).toEqual(["4", 2]);
  });

  it("chains multiple LoRAs in order", () => {
    const out = injectLoraChain(ckptGraph(), [
      { name: "a", strengthModel: 1 }, { name: "b", strengthModel: 0.5 },
    ]);
    expect(out["char_lora_1"].inputs.model).toEqual(["char_lora_0", 0]);
    expect(out["12"].inputs.model).toEqual(["char_lora_1", 0]); // consumer points at chain end
  });

  it("uses LoraLoaderModelOnly for Wan UNETLoader and rewires model consumers", () => {
    const wan = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: "wan.safetensors" } },
      "5": { class_type: "KSampler", inputs: { model: ["1", 0], seed: 1 } },
    };
    const out = injectLoraChain(wan, [{ name: "hero", strengthModel: 0.8 }]);
    expect(out["char_lora_0"].class_type).toBe("LoraLoaderModelOnly");
    expect(out["char_lora_0"].inputs.model).toEqual(["1", 0]);
    expect(out["char_lora_0"].inputs.clip).toBeUndefined(); // model-only
    expect(out["5"].inputs.model).toEqual(["char_lora_0", 0]);
  });

  it("uses LoraLoaderModelOnly for SVD ImageOnlyCheckpointLoader", () => {
    const svd = {
      "15": { class_type: "ImageOnlyCheckpointLoader", inputs: { ckpt_name: "svd.safetensors" } },
      "3": { class_type: "KSampler", inputs: { model: ["15", 0] } },
    };
    const out = injectLoraChain(svd, [{ name: "hero", strengthModel: 0.8 }]);
    expect(out["char_lora_0"].class_type).toBe("LoraLoaderModelOnly");
    expect(out["3"].inputs.model).toEqual(["char_lora_0", 0]);
  });

  it("returns unchanged when no recognized model loader exists", () => {
    const g = { "1": { class_type: "SomethingElse", inputs: {} } };
    expect(injectLoraChain(g, [{ name: "hero", strengthModel: 0.8 }])).toEqual(g);
  });
});

describe("injectLoraChain — LTXV 形态（checkpoint 的 CLIP 输出无人消费）", () => {
  // LTXV：文本编码走独立 CLIPLoader("2")，CheckpointLoaderSimple("1") 的 CLIP 槽无人用（常为 None）。
  const ltxvGraph = () => ({
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltxv.safetensors" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "t5xxl_fp16.safetensors", type: "ltxv" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "pos", clip: ["2", 0] } },
    "4": { class_type: "KSampler", inputs: { seed: 1, model: ["1", 0], positive: ["6", 0], latent_image: ["5", 0] } },
    "9": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["1", 2] } },
  });
  it("改用 LoraLoaderModelOnly（不把 clip 接到无人用/可能为 None 的 checkpoint CLIP 上）", () => {
    const out = injectLoraChain(ltxvGraph() as any, [{ name: "hero.safetensors", strengthModel: 0.8 }]);
    expect(out["char_lora_0"].class_type).toBe("LoraLoaderModelOnly");
    expect(out["char_lora_0"].inputs.clip).toBeUndefined();          // 不接 clip
    expect(out["char_lora_0"].inputs.model).toEqual(["1", 0]);
    expect(out["4"].inputs.model).toEqual(["char_lora_0", 0]);       // MODEL 消费者重连到链尾
    expect(out["9"].inputs.vae).toEqual(["1", 2]);                   // VAE 槽不动
  });
});
