import { describe, expect, it } from "vitest";
import { buildImageWorkflow } from "./_core/comfyui";

const base = {
  template: "txt2img" as const, prompt: "p", negPrompt: "", ckpt: "flux.sft", loras: [],
  arch: "flux" as const, modelSource: "unet" as const, seed: 1, steps: 4, cfg: 1,
  sampler: "euler", scheduler: "simple", denoise: 1, width: 512, height: 512, batchSize: 1,
};

describe("buildImageWorkflow — UNETLoader requires separate CLIP/VAE", () => {
  it("throws a readable error when the unet arch has no CLIP (avoids dangling ref to UNETLoader slot 1)", () => {
    expect(() => buildImageWorkflow({ ...base })).toThrow(/CLIP/);
  });

  it("throws when the unet arch has CLIP but no VAE (avoids dangling ref to UNETLoader slot 2)", () => {
    expect(() => buildImageWorkflow({ ...base, clip: { clipType: "flux", name1: "t5.sft", name2: "clip_l.sft" } })).toThrow(/VAE/);
  });

  it("builds with CLIP+VAE loaders wired (refs point at nodes 21/20, not UNETLoader slots)", () => {
    const wf = buildImageWorkflow({ ...base, clip: { clipType: "flux", name1: "t5.sft", name2: "clip_l.sft" }, vae: "ae.sft" });
    const clipEnc = Object.values(wf).find((n) => n.class_type === "CLIPTextEncode")!;
    const vaeDecode = Object.values(wf).find((n) => n.class_type === "VAEDecode")!;
    expect(clipEnc.inputs.clip).toEqual(["21", 0]);
    expect(vaeDecode.inputs.vae).toEqual(["20", 0]);
  });

  it("checkpoint source needs no separate CLIP/VAE (embedded on slots 1/2)", () => {
    const wf = buildImageWorkflow({ ...base, modelSource: "checkpoint", arch: "sd", ckpt: "sd15.safetensors" });
    const clipEnc = Object.values(wf).find((n) => n.class_type === "CLIPTextEncode")!;
    expect(clipEnc.inputs.clip).toEqual(["4", 1]); // checkpoint's embedded CLIP
  });
});
