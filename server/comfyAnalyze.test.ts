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
    // The literal negative CLIPTextEncode (21) is still exposed, tagged negative.
    expect(byKey("21", "inputs.text")).toMatchObject({ label: "负向提示词", role: "negative" });
    // The promptLine positive source is tagged positive.
    expect(promptLine!.role).toBe("positive");
    // SaveImage is the image output node.
    expect(outputNodeIds).toContain("9");
    expect(outputType).toBe("image");
  });

  it("surfaces LoadImage and LoadImageMask as image params (inpaint 遮罩)", async () => {
    const wf = JSON.stringify({
      "10": { class_type: "LoadImage", inputs: { image: "in.png" }, _meta: { title: "底图" } },
      "11": { class_type: "LoadImageMask", inputs: { image: "mask.png", channel: "red" } },
      "9": { class_type: "SaveImage", inputs: { images: ["10", 0] } },
    });
    const { detectedParams } = await analyzeWorkflow(wf);
    const p10 = detectedParams.find((p) => p.nodeId === "10");
    const p11 = detectedParams.find((p) => p.nodeId === "11");
    expect(p10).toMatchObject({ type: "image", label: "底图", role: "reference" });
    expect(p11).toMatchObject({ type: "image", fieldPath: "inputs.image", label: "遮罩", role: "mask" });
  });
});

describe("analyzeWorkflow — Flux 共用 CLIPTextEncode（正负同节点）", () => {
  // 复现内置 PRESET_FLUX：KSampler 的 positive 与 negative 都指向节点 6（Flux 在 CFG=1
  // 时不用负向，故官方默认图把两者接到同一个 CLIPTextEncode）。此前分析器把节点 6 误判为
  // negative-only → 没有任何 positive 参数、正向/上游提示词被丢、负向词写进实际驱动出图的
  // 编码器。修复后正向优先：节点 6 必须 role=positive。
  const FLUX_SHARED = JSON.stringify({
    "1": { class_type: "UNETLoader", inputs: { unet_name: "flux.safetensors" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "a cat", clip: ["2", 0] } },
    "4": { class_type: "KSampler", inputs: { seed: 1, steps: 20, cfg: 1, model: ["1", 0], positive: ["6", 0], negative: ["6", 0], latent_image: ["5", 0] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["7", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0] } },
  });

  it("正负共用节点判为 positive（正向优先），存在可写入的正向提示词参数", async () => {
    const { detectedParams } = await analyzeWorkflow(FLUX_SHARED);
    const p6 = detectedParams.find((p) => p.nodeId === "6" && p.fieldPath === "inputs.text");
    expect(p6).toMatchObject({ role: "positive", label: "提示词" });
    // 至少存在一个 positive 文本参数（供 positivePromptParamKey 写入上游/正向词）。
    expect(detectedParams.some((p) => p.type === "text" && p.role === "positive")).toBe(true);
  });

  it("仍能正确区分独立的正/负节点（无回归）", async () => {
    const wf = JSON.stringify({
      "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
      "6": { class_type: "CLIPTextEncode", inputs: { text: "pos", clip: ["2", 0] } },
      "7": { class_type: "CLIPTextEncode", inputs: { text: "neg", clip: ["2", 0] } },
      "4": { class_type: "KSampler", inputs: { seed: 1, steps: 20, cfg: 7, model: ["1", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
      "9": { class_type: "SaveImage", inputs: { images: ["4", 0] } },
    });
    const { detectedParams } = await analyzeWorkflow(wf);
    expect(detectedParams.find((p) => p.nodeId === "6")).toMatchObject({ role: "positive" });
    expect(detectedParams.find((p) => p.nodeId === "7")).toMatchObject({ role: "negative" });
  });
});
