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
});
