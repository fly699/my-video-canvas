import { describe, expect, it } from "vitest";
import { summarizeComfyWorkflow } from "../client/src/lib/comfyWorkflowSummary";

const SDXL = JSON.stringify({
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
  "10": { class_type: "LoraLoader", inputs: { lora_name: "add_detail.safetensors", model: ["4", 0] } },
  "11": { class_type: "LoraLoader", inputs: { lora_name: "style.safetensors", model: ["10", 0] } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "a cat", clip: ["4", 1] } },
  "3": { class_type: "KSampler", inputs: { seed: 42, steps: 30, model: ["11", 0], positive: ["6", 0] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
});

describe("summarizeComfyWorkflow", () => {
  it("extracts checkpoint, LoRAs and node count, shortening filenames", () => {
    const s = summarizeComfyWorkflow(SDXL);
    expect(s.ok).toBe(true);
    expect(s.checkpoints).toEqual(["sd_xl_base_1.0"]);
    expect(s.loras).toEqual(["add_detail", "style"]);
    expect(s.nodeCount).toBe(6);
    expect(s.brief).toBe("sd_xl_base_1.0 · +2 LoRA · 6 节点");
    // literal inputs counted as params, array links excluded
    expect(s.paramCount).toBeGreaterThan(0);
    expect(s.detail).toContain("模型: sd_xl_base_1.0");
    expect(s.detail).toContain("LoRA: add_detail, style");
  });

  it("dedupes repeated model names", () => {
    const json = JSON.stringify({
      "1": { class_type: "UNETLoader", inputs: { unet_name: "flux1-dev.safetensors" } },
      "2": { class_type: "UNETLoader", inputs: { unet_name: "flux1-dev.safetensors" } },
    });
    const s = summarizeComfyWorkflow(json);
    expect(s.checkpoints).toEqual(["flux1-dev"]);
  });

  it("degrades to a node count when no known model loaders are present", () => {
    const json = JSON.stringify({ "1": { class_type: "SomeCustomNode", inputs: { foo: 1 } } });
    const s = summarizeComfyWorkflow(json);
    expect(s.ok).toBe(true);
    expect(s.brief).toBe("1 节点");
    expect(s.checkpoints).toEqual([]);
  });

  it("returns ok:false for empty / invalid JSON", () => {
    expect(summarizeComfyWorkflow("").ok).toBe(false);
    expect(summarizeComfyWorkflow("not json").ok).toBe(false);
    expect(summarizeComfyWorkflow("[]").ok).toBe(false);
    expect(summarizeComfyWorkflow(undefined).ok).toBe(false);
  });
});
