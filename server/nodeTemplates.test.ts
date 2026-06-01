import { describe, expect, it } from "vitest";
import { sanitizeTemplatePayload } from "../client/src/lib/nodeTemplates";

describe("sanitizeTemplatePayload", () => {
  it("keeps config params and drops prompts / content / per-instance inputs", () => {
    const payload = {
      // config — kept
      ckpt: "sd_xl.safetensors", sampler: "euler", scheduler: "normal",
      steps: 20, cfg: 7, width: 1024, height: 1024, arch: "sd",
      aiLlmModel: "claude-sonnet-4-6",
      // prompts / content — dropped
      prompt: "a cat", negPrompt: "blurry", promptText: "hi", content: "script...",
      sceneDescription: "scene",
      // per-instance inputs / outputs — dropped
      seed: 123, referenceImageUrl: "/manus-storage/x.png", maskUrl: "/m.png",
      generatedImageUrl: "/manus-storage/out.png", status: "done",
    };
    const out = sanitizeTemplatePayload(payload);
    // kept
    expect(out).toMatchObject({ ckpt: "sd_xl.safetensors", sampler: "euler", steps: 20, cfg: 7, width: 1024, arch: "sd", aiLlmModel: "claude-sonnet-4-6" });
    // dropped
    for (const k of ["prompt", "negPrompt", "promptText", "content", "sceneDescription", "seed", "referenceImageUrl", "maskUrl", "generatedImageUrl", "status"]) {
      expect(out).not.toHaveProperty(k);
    }
  });
});
