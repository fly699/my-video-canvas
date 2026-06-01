import { describe, expect, it } from "vitest";
import { buildImageWorkflow } from "./_core/comfyui";

// The "server model" stress mode builds a minimal txt2img workflow from a chosen
// checkpoint + params (router/comfyStress.ts) and feeds it to the same probe
// engine. Validate that build produces a ComfyUI graph carrying the selections
// and that it round-trips through JSON (the engine receives it as a string).
describe("buildImageWorkflow (server-model stress mode)", () => {
  const wf = buildImageWorkflow({
    template: "txt2img",
    prompt: "a photo of a cat",
    negPrompt: "blurry",
    ckpt: "sd_xl_base_1.0.safetensors",
    loras: [],
    seed: 123,
    steps: 8,
    cfg: 6.5,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    denoise: 1.0,
    width: 768,
    height: 1024,
    batchSize: 2,
  });

  const byClass = (ct: string) => Object.values(wf).find((n) => n.class_type === ct);

  it("loads the chosen checkpoint", () => {
    expect(byClass("CheckpointLoaderSimple")?.inputs.ckpt_name).toBe("sd_xl_base_1.0.safetensors");
  });

  it("carries the sampler params", () => {
    const ks = byClass("KSampler")!;
    expect(ks.inputs.steps).toBe(8);
    expect(ks.inputs.cfg).toBe(6.5);
    expect(ks.inputs.sampler_name).toBe("dpmpp_2m");
    expect(ks.inputs.scheduler).toBe("karras");
    expect(ks.inputs.seed).toBe(123);
  });

  it("sets latent size + batch", () => {
    const latent = byClass("EmptyLatentImage")!;
    expect(latent.inputs.width).toBe(768);
    expect(latent.inputs.height).toBe(1024);
    expect(latent.inputs.batch_size).toBe(2);
  });

  it("round-trips through JSON (engine receives a string)", () => {
    const json = JSON.stringify(wf);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)).toEqual(wf);
  });

  it("uses the checkpoint's CLIP when no separate clip is given", () => {
    const cte = Object.values(wf).find((n) => n.class_type === "CLIPTextEncode")!;
    expect(cte.inputs.clip).toEqual(["4", 1]); // checkpoint node 4, CLIP output
    expect(Object.values(wf).some((n) => n.class_type === "CLIPLoader" || n.class_type === "DualCLIPLoader")).toBe(false);
  });

  it("wires a single CLIPLoader and feeds CLIPTextEncode from it", () => {
    const w = buildImageWorkflow({
      template: "txt2img", prompt: "p", negPrompt: "", ckpt: "unet.safetensors",
      loras: [], clip: { clipType: "stable_diffusion", name1: "clip_l.safetensors" },
      seed: 1, steps: 8, cfg: 7, sampler: "euler", scheduler: "normal", denoise: 1,
      width: 512, height: 512, batchSize: 1,
    });
    const loader = Object.entries(w).find(([, n]) => n.class_type === "CLIPLoader")!;
    expect(loader[1].inputs).toMatchObject({ clip_name: "clip_l.safetensors", type: "stable_diffusion" });
    expect(Object.values(w).some((n) => n.class_type === "DualCLIPLoader")).toBe(false);
    const cte = Object.values(w).find((n) => n.class_type === "CLIPTextEncode")!;
    expect(cte.inputs.clip).toEqual([loader[0], 0]);
  });

  it("wires a DualCLIPLoader when two clip names are given (Flux/SD3)", () => {
    const w = buildImageWorkflow({
      template: "txt2img", prompt: "p", negPrompt: "", ckpt: "flux1-dev.safetensors",
      loras: [], clip: { clipType: "flux", name1: "clip_l.safetensors", name2: "t5xxl_fp16.safetensors" },
      seed: 1, steps: 8, cfg: 1, sampler: "euler", scheduler: "simple", denoise: 1,
      width: 1024, height: 1024, batchSize: 1,
    });
    const loader = Object.entries(w).find(([, n]) => n.class_type === "DualCLIPLoader")!;
    expect(loader[1].inputs).toMatchObject({ clip_name1: "clip_l.safetensors", clip_name2: "t5xxl_fp16.safetensors", type: "flux" });
    const cte = Object.values(w).find((n) => n.class_type === "CLIPTextEncode")!;
    expect(cte.inputs.clip).toEqual([loader[0], 0]);
  });

  it("wires a TripleCLIPLoader when three clip names are given (SD3)", () => {
    const w = buildImageWorkflow({
      template: "txt2img", prompt: "p", negPrompt: "", ckpt: "sd3.5_large.safetensors",
      loras: [], clip: { clipType: "", name1: "clip_g.safetensors", name2: "clip_l.safetensors", name3: "t5xxl.safetensors" },
      seed: 1, steps: 20, cfg: 4.5, sampler: "dpmpp_2m", scheduler: "sgm_uniform", denoise: 1,
      width: 1024, height: 1024, batchSize: 1,
    });
    const loader = Object.values(w).find((n) => n.class_type === "TripleCLIPLoader")!;
    expect(loader.inputs).toMatchObject({ clip_name1: "clip_g.safetensors", clip_name2: "clip_l.safetensors", clip_name3: "t5xxl.safetensors" });
  });
});

describe("buildImageWorkflow architectures (DiT)", () => {
  const base = {
    template: "txt2img" as const, prompt: "p", negPrompt: "n", loras: [],
    seed: 1, steps: 20, cfg: 4, sampler: "euler", scheduler: "simple", denoise: 1,
    width: 1024, height: 1024, batchSize: 1,
  };
  const byClass = (w: Record<string, { class_type: string; inputs: Record<string, unknown> }>, ct: string) =>
    Object.entries(w).find(([, n]) => n.class_type === ct);

  it("flux: UNETLoader + DualCLIPLoader + FluxGuidance + EmptySD3LatentImage + KSampler cfg=1", () => {
    const w = buildImageWorkflow({
      ...base, ckpt: "flux1-dev.safetensors", arch: "flux", modelSource: "unet", guidance: 3.5,
      clip: { clipType: "flux", name1: "clip_l.safetensors", name2: "t5xxl_fp16.safetensors" }, vae: "ae.safetensors",
    });
    expect(byClass(w, "UNETLoader")![1].inputs.unet_name).toBe("flux1-dev.safetensors");
    expect(byClass(w, "EmptySD3LatentImage")).toBeTruthy();
    const fg = byClass(w, "FluxGuidance")!;
    expect(fg[1].inputs.guidance).toBe(3.5);
    const ks = byClass(w, "KSampler")![1];
    expect(ks.inputs.cfg).toBe(1); // guidance-distilled
    expect(ks.inputs.positive).toEqual([fg[0], 0]); // positive routed through FluxGuidance
  });

  it("sd3: ModelSamplingSD3 feeds KSampler.model", () => {
    const w = buildImageWorkflow({
      ...base, ckpt: "sd3.5.safetensors", arch: "sd3", modelSource: "checkpoint", shift: 3,
    });
    const ms = byClass(w, "ModelSamplingSD3")!;
    expect(ms[1].inputs.shift).toBe(3);
    expect(byClass(w, "KSampler")![1].inputs.model).toEqual([ms[0], 0]);
    expect(byClass(w, "EmptySD3LatentImage")).toBeTruthy();
  });

  it("qwen: ModelSamplingAuraFlow + UNETLoader + single CLIPLoader(qwen_image)", () => {
    const w = buildImageWorkflow({
      ...base, ckpt: "qwen-image.safetensors", arch: "qwen", modelSource: "unet", shift: 3.1,
      clip: { clipType: "qwen_image", name1: "qwen_2.5_vl_7b.safetensors" }, vae: "qwen_image_vae.safetensors",
    });
    const ms = byClass(w, "ModelSamplingAuraFlow")!;
    expect(ms[1].inputs.shift).toBe(3.1);
    expect(byClass(w, "KSampler")![1].inputs.model).toEqual([ms[0], 0]);
    expect(byClass(w, "CLIPLoader")![1].inputs).toMatchObject({ clip_name: "qwen_2.5_vl_7b.safetensors", type: "qwen_image" });
    expect(byClass(w, "UNETLoader")).toBeTruthy();
  });

  it("new-arch ignores ControlNet/IPAdapter (classic-SD only)", () => {
    const w = buildImageWorkflow({
      ...base, ckpt: "flux1-dev.safetensors", arch: "flux", modelSource: "unet",
      clip: { clipType: "flux", name1: "a", name2: "b" },
      controlnet: { model: "cn", imageName: "x.png", strength: 1 },
      ipadapter: { model: "ip", imageName: "y.png" },
    });
    expect(byClass(w, "ControlNetLoader")).toBeUndefined();
    expect(byClass(w, "IPAdapterModelLoader")).toBeUndefined();
  });
});
