import { describe, it, expect } from "vitest";
import { analyzeWorkflow } from "./_core/comfyui";

// Phase A: deterministic per-shot duration (frames/fps) detection from a video
// workflow's node graph, used by the agent to plan enough shots for a target.
describe("analyzeWorkflow videoCapabilities", () => {
  it("reads frames from EmptyHunyuanLatentVideo.length and fps from VHS_VideoCombine", async () => {
    const wf = JSON.stringify({
      "1": { class_type: "UNETLoader", inputs: { unet_name: "wan.safetensors" } },
      "5": { class_type: "EmptyHunyuanLatentVideo", inputs: { width: 832, height: 480, length: 81, batch_size: 1 } },
      "8": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["3", 0] } },
      "13": { class_type: "VHS_VideoCombine", inputs: { frame_rate: 16, images: ["8", 0] } },
    });
    const a = await analyzeWorkflow(wf);
    expect(a.outputType).toBe("video");
    expect(a.videoCapabilities).toEqual({ maxFrames: 81, fps: 16 });
  });

  it("falls back to EmptyLatentImage.batch_size for AnimateDiff video workflows", async () => {
    const wf = JSON.stringify({
      "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 16 } },
      "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
      "13": { class_type: "VHS_VideoCombine", inputs: { frame_rate: 8, images: ["8", 0] } },
    });
    const a = await analyzeWorkflow(wf);
    expect(a.outputType).toBe("video");
    expect(a.videoCapabilities).toEqual({ maxFrames: 16, fps: 8 });
  });

  it("ignores a `length` input on a non-video node (no false frame count)", async () => {
    // A text/list helper node that happens to expose a numeric `length` must not
    // clobber the real frame count read from the video-latent node. (#7)
    const wf = JSON.stringify({
      "2": { class_type: "StringListHelper", inputs: { length: 999 } },
      "5": { class_type: "EmptyHunyuanLatentVideo", inputs: { width: 832, height: 480, length: 81 } },
      "8": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["3", 0] } },
      "13": { class_type: "VHS_VideoCombine", inputs: { frame_rate: 16, images: ["8", 0] } },
    });
    const a = await analyzeWorkflow(wf);
    expect(a.outputType).toBe("video");
    expect(a.videoCapabilities).toEqual({ maxFrames: 81, fps: 16 });
  });

  it("returns no videoCapabilities for an image-only workflow", async () => {
    const wf = JSON.stringify({
      "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 4 } },
      "9": { class_type: "SaveImage", inputs: { images: ["8", 0] } },
    });
    const a = await analyzeWorkflow(wf);
    expect(a.outputType).toBe("image");
    expect(a.videoCapabilities).toBeUndefined();
  });
});
