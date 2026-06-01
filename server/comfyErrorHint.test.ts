import { describe, expect, it } from "vitest";
import { comfyErrorHint } from "./_core/comfyui";

describe("comfyErrorHint", () => {
  it("explains the Qwen (3584) text-encoder dimension mismatch", () => {
    const raw = 'Given normalized_shape=[3584], expected input with shape [*, 3584], but got input of size[1, 71, 2560]';
    const h = comfyErrorHint(raw);
    expect(h).toContain("文本编码器与模型不匹配");
    expect(h).toContain("3584");
    expect(h).toContain("2560");
    expect(h).toContain("qwen_image");
  });

  it("flags a checkpoint without embedded CLIP", () => {
    expect(comfyErrorHint("ERROR: clip input is invalid: None")).toContain("不含 CLIP");
  });

  it("returns empty for unrelated errors", () => {
    expect(comfyErrorHint("CUDA out of memory")).toBe("");
  });
});

describe("comfyErrorHint value_not_in_list", () => {
  it("explains a missing UNet file and points to the right folder", () => {
    const raw = '{"node_errors":{"4":{"errors":[{"type":"value_not_in_list","message":"Value not in list","details":"unet_name: \'intorealismQwen_v10.safetensors\' not in [\'z_image_turbo_bf16.safetensors\']"}]}}}';
    const h = comfyErrorHint(raw);
    expect(h).toContain("不在这台 ComfyUI 服务器上");
    expect(h).toContain("intorealismQwen_v10.safetensors");
    expect(h).toContain("diffusion_models");
    expect(h).toContain("完整 Checkpoint");
  });
});

import { extractExecError } from "./_core/comfyui";
describe("extractExecError", () => {
  it("surfaces the exception_message past execution_start/cached", () => {
    const messages = [
      ["execution_start", { prompt_id: "x" }],
      ["execution_cached", { nodes: ["4", "5"] }],
      ["execution_error", { node_id: "3", node_type: "KSampler", exception_message: "mat1 and mat2 shapes cannot be multiplied" }],
    ];
    const s = extractExecError(messages);
    expect(s).toContain("KSampler");
    expect(s).toContain("mat1 and mat2");
  });
  it("returns null when no execution_error present", () => {
    expect(extractExecError([["execution_start", {}], ["execution_cached", { nodes: [] }]])).toBeNull();
  });
});
