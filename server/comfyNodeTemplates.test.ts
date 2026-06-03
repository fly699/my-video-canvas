import { describe, expect, it } from "vitest";
import { sanitizeComfyPayload, colorForTemplate } from "../client/src/lib/comfyNodeTemplates";

describe("sanitizeComfyPayload", () => {
  it("keeps prompts / params / workflow JSON, drops runtime+output state", () => {
    const payload = {
      // kept — full config incl. prompts
      prompt: "a cat", negPrompt: "blurry", ckpt: "sd_xl.safetensors",
      steps: 20, cfg: 7, seed: 123,
      workflowJson: '{"3":{"class_type":"KSampler"}}',
      paramValues: { "3.inputs.text": "hello" },
      useCloudComfy: true, customBaseUrl: "http://x",
      // dropped — runtime / output
      status: "done", progress: 100, errorMessage: "x", taskId: "t1",
      outputUrl: "/a.png", outputUrls: ["/a.png"], imageUrl: "/b.png",
      resultVideoUrl: "/c.mp4", pinned: true,
    };
    const out = sanitizeComfyPayload(payload);
    expect(out).toMatchObject({
      prompt: "a cat", negPrompt: "blurry", ckpt: "sd_xl.safetensors",
      steps: 20, seed: 123, paramValues: { "3.inputs.text": "hello" },
      useCloudComfy: true,
    });
    expect(out.workflowJson).toBe('{"3":{"class_type":"KSampler"}}');
    for (const k of ["status", "progress", "errorMessage", "taskId", "outputUrl", "outputUrls", "imageUrl", "resultVideoUrl", "pinned"]) {
      expect(out).not.toHaveProperty(k);
    }
  });

  it("drops oversized strings but always keeps workflowJson", () => {
    const big = "x".repeat(9000);
    const bigJson = '{"a":1}' + "/* pad */".repeat(2000);
    const out = sanitizeComfyPayload({ referenceImageUrl: big, workflowJson: bigJson });
    expect(out).not.toHaveProperty("referenceImageUrl");
    expect(out.workflowJson).toBe(bigJson);
  });
});

describe("colorForTemplate", () => {
  it("returns 4 distinct colors across the comfyui node types", () => {
    const image = colorForTemplate("comfyui_image");
    const video = colorForTemplate("comfyui_video");
    const wfLocal = colorForTemplate("comfyui_workflow", false);
    const wfCloud = colorForTemplate("comfyui_workflow", true);
    const all = [image, video, wfLocal, wfCloud];
    expect(new Set(all).size).toBe(4);
    expect(wfCloud).toBe("oklch(0.68 0.16 235)");
  });
});
