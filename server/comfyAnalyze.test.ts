import { describe, expect, it } from "vitest";
import { analyzeWorkflow } from "../server/_core/comfyui";

// Reproduces the z_image_turbo workflow shape: the positive CLIPTextEncode (6)
// is WIRED from an "easy promptLine" node (19) whose multi-line `prompt` drives
// ComfyUI's per-line list execution (→ multiple images). The analyzer must NOT
// expose the wired CLIPTextEncode.text (editing it would sever the batch) and
// MUST expose node 19's literal `prompt` so the user can enter the multi-line
// prompt that produces multiple images.
const WORKFLOW = JSON.stringify({
  "3": { class_type: "KSampler", inputs: { seed: 1, steps: 9, cfg: 1, sampler_name: "euler_ancestral", scheduler: "beta", denoise: 1, model: ["16", 0], positive: ["6", 0], negative: ["21", 0], latent_image: ["13", 0] } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: ["19", 0], clip: ["18", 0] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["17", 0] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "ComfyUI", images: ["8", 0] } },
  "13": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  "16": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_nvfp4.safetensors", weight_dtype: "default" } },
  "17": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
  "18": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b_fp8_mixed.safetensors", type: "lumina2" } },
  "19": { class_type: "easy promptLine", inputs: { prompt: "", start_index: 0, max_rows: 1000, remove_empty_lines: "" }, _meta: { title: "提示词行" } },
  "21": { class_type: "CLIPTextEncode", inputs: { text: "低质量", clip: ["18", 0] } },
});

describe("analyzeWorkflow — wired prompt source (easy promptLine)", () => {
  it("exposes the upstream promptLine prompt, not the wired CLIPTextEncode", async () => {
    const { detectedParams, outputNodeIds, outputType } = await analyzeWorkflow(WORKFLOW);
    const byKey = (nodeId: string, fieldPath: string) =>
      detectedParams.find((p) => p.nodeId === nodeId && p.fieldPath === fieldPath);

    // The wired positive CLIPTextEncode (6) must NOT be editable.
    expect(byKey("6", "inputs.text")).toBeUndefined();
    // The promptLine source (19) prompt IS editable (the real multi-line input).
    const promptLine = byKey("19", "inputs.prompt");
    expect(promptLine).toBeDefined();
    expect(promptLine!.type).toBe("text");
    expect(promptLine!.label).toBe("提示词行");
    // The literal negative CLIPTextEncode (21) is still exposed.
    expect(byKey("21", "inputs.text")?.label).toBe("负向提示词");
    // SaveImage is the image output node.
    expect(outputNodeIds).toContain("9");
    expect(outputType).toBe("image");
  });
});
