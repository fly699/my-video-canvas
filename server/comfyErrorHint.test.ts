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
  it("appends the deepest traceback frame (file:line of the actual failure)", () => {
    const messages = [
      ["execution_error", {
        node_id: "3", node_type: "KSampler", exception_message: "boom",
        traceback: [
          "Traceback (most recent call last):\n",
          "  File \"/comfy/nodes.py\", line 1500, in sample\n",
          "  File \"/comfy/custom_nodes/foo.py\", line 42, in run\n    raise RuntimeError('boom')\n",
        ],
      }],
    ];
    const s = extractExecError(messages)!;
    expect(s).toContain("KSampler");
    expect(s).toContain("boom");
    expect(s).toContain("foo.py"); // deepest frame surfaced
    expect(s).toContain("↳");
  });
  it("deep-scans for an exception under a non-standard tag", () => {
    const messages = [
      ["execution_start", { prompt_id: "x" }],
      ["some_custom_event", { node_id: "7", node_type: "WeirdNode", exception_type: "RuntimeError", exception_message: "boom" }],
    ];
    expect(extractExecError(messages)).toContain("boom");
  });
  it("surfaces a validation node_errors map", () => {
    const messages = [
      ["execution_error", { node_errors: { "4": { errors: [{ message: "Value not in list", details: "ckpt_name: 'x' not in [...]" }] } } }],
    ];
    const s = extractExecError(messages);
    expect(s).toContain("#4");
    expect(s).toContain("Value not in list");
  });
});

import { sanitizeFilenamePrefix } from "./_core/comfyui";
describe("sanitizeFilenamePrefix", () => {
  it("strips path separators / illegal chars and drops extension", () => {
    expect(sanitizeFilenamePrefix("ComfyUI 图像 #1_sd_xl.safetensors"))
      .toBe("ComfyUI_图像_#1_sd_xl");
  });
  it("falls back to comfyui_output when empty or all-illegal", () => {
    expect(sanitizeFilenamePrefix("")).toBe("comfyui_output");
    expect(sanitizeFilenamePrefix(undefined)).toBe("comfyui_output");
    expect(sanitizeFilenamePrefix("///")).toBe("comfyui_output");
  });
  it("caps length at 64", () => {
    expect(sanitizeFilenamePrefix("a".repeat(200)).length).toBe(64);
  });
});

describe("comfyErrorHint ckpt_name cross-hint", () => {
  it("suggests switching to 单独 UNet when a checkpoint name is actually a UNet file", () => {
    const raw = '{"node_errors":{"4":{"errors":[{"type":"value_not_in_list","details":"ckpt_name: \'z_image_turbo_bf16.safetensors\' not in [\'a.safetensors\']"}]}}}';
    const h = comfyErrorHint(raw);
    expect(h).toContain("不在这台 ComfyUI 服务器上");
    expect(h).toContain("models/checkpoints");
    expect(h).toContain("单独 UNet");
  });
});

describe("comfyErrorHint missing_node_type", () => {
  it("names the VideoHelperSuite plugin for VHS_VideoCombine", () => {
    const raw = '{"error":{"type":"missing_node_type","message":"Node \'VHS_VideoCombine\' not found. The custom node may not be installed.","details":"Node ID \'#13\'","extra_info":{"node_id":"13","class_type":"VHS_VideoCombine"}}}';
    const h = comfyErrorHint(raw);
    expect(h).toContain("未安装节点");
    expect(h).toContain("VHS_VideoCombine");
    expect(h).toContain("ComfyUI-VideoHelperSuite");
  });
  it("gives a generic plugin hint for an unknown custom node", () => {
    const h = comfyErrorHint('{"type":"missing_node_type","class_type":"SomeRandomNode"}');
    expect(h).toContain("SomeRandomNode");
    expect(h).toContain("ComfyUI-Manager");
  });
});
