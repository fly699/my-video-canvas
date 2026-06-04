import { describe, it, expect } from "vitest";
import { analyzeWorkflow } from "./_core/comfyui";

const find = (params: { nodeId: string; fieldPath: string }[], nodeId: string, field: string) =>
  params.find((p) => p.nodeId === nodeId && p.fieldPath === `inputs.${field}`);

describe("analyzeWorkflow — UI-format guard", () => {
  it("rejects a UI-exported workflow with actionable guidance", async () => {
    const ui = JSON.stringify({ last_node_id: 5, last_link_id: 3, nodes: [{ id: 1, type: "KSampler" }], links: [], version: 0.4 });
    await expect(analyzeWorkflow(ui)).rejects.toThrow(/UI|API/);
  });
});

describe("analyzeWorkflow — generic widget sweep (expanded whitelist)", () => {
  it("surfaces literal params on unrecognized/custom nodes", async () => {
    const wf = JSON.stringify({
      "1": { class_type: "UNETLoader", inputs: { unet_name: "flux.safetensors", weight_dtype: "fp8" } },
      "2": { class_type: "FluxGuidance", inputs: { guidance: 3.5, conditioning: ["6", 0] } },
      "3": { class_type: "ModelSamplingSD3", inputs: { shift: 8.0, model: ["1", 0] } },
      "5": { class_type: "EmptyHunyuanLatentVideo", inputs: { width: 832, height: 480, length: 81, batch_size: 1 } },
      "6": { class_type: "CLIPTextEncode", inputs: { text: "a cat", clip: ["7", 0] } },
      "7": { class_type: "CLIPLoader", inputs: { clip_name: "t5.safetensors", type: "flux" } },
      "13": { class_type: "VHS_VideoCombine", inputs: { frame_rate: 16, filename_prefix: "out", pingpong: false, images: ["8", 0] } },
    });
    const { detectedParams } = await analyzeWorkflow(wf);

    // Custom/unrecognized node literals now editable:
    expect(find(detectedParams, "2", "guidance")).toMatchObject({ type: "number", label: "Guidance" });
    expect(find(detectedParams, "3", "shift")).toMatchObject({ type: "number", label: "Shift" });
    expect(find(detectedParams, "7", "clip_name")).toMatchObject({ type: "text" });
    // EmptyHunyuanLatentVideo.length (帧数) surfaced by the sweep.
    expect(find(detectedParams, "5", "length")).toMatchObject({ type: "number", label: "帧数" });
    // Boolean widget surfaced.
    expect(find(detectedParams, "13", "pingpong")).toMatchObject({ type: "boolean" });

    // Wired inputs and noise fields stay hidden.
    expect(find(detectedParams, "2", "conditioning")).toBeUndefined(); // wired array
    expect(find(detectedParams, "13", "filename_prefix")).toBeUndefined(); // noise
    expect(find(detectedParams, "13", "images")).toBeUndefined(); // wired

    // Curated CLIPTextEncode prompt is still the specific binding (not duplicated).
    const text6 = detectedParams.filter((p) => p.nodeId === "6" && p.fieldPath === "inputs.text");
    expect(text6.length).toBe(1);
  });
});
