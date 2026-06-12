import { describe, expect, it } from "vitest";
import { validateWorkflowWithInfo } from "../server/_core/comfyui";

// 模拟目标服务器的 /object_info：装了 KSampler / CheckpointLoaderSimple / CLIPTextEncode，
// 但只有有限的 ckpt / sampler 列表；故意不装 FooCustomNode。
const INFO: any = {
  KSampler: { input: { required: {
    seed: ["INT", { min: 0, max: 1e9 }],
    sampler_name: [["euler", "dpmpp_2m"]],
    scheduler: [["normal", "karras"]],
    steps: ["INT", { min: 1, max: 150 }],
    model: ["MODEL"], positive: ["CONDITIONING"], negative: ["CONDITIONING"], latent_image: ["LATENT"],
  } } },
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [["sdxl.safetensors", "sd15.safetensors"]] } } },
  CLIPTextEncode: { input: { required: { text: ["STRING"], clip: ["CLIP"] } } },
};

describe("validateWorkflowWithInfo", () => {
  it("枚举/模型值不在服务器清单 → invalidEnums，带合法 options 供重映射", () => {
    const wf: any = {
      "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "不存在的模型.ckpt" } },
      "3": { class_type: "KSampler", inputs: { seed: 1, sampler_name: "euler", scheduler: "karras", steps: 20, model: ["4", 0], positive: ["6", 0], negative: ["6", 0], latent_image: ["5", 0] } },
      "6": { class_type: "CLIPTextEncode", inputs: { text: "hi", clip: ["4", 1] } },
    };
    const r = validateWorkflowWithInfo(wf, INFO, true);
    expect(r.ok).toBe(false);
    expect(r.invalidEnums).toHaveLength(1);
    expect(r.invalidEnums[0]).toMatchObject({ nodeId: "4", classType: "CheckpointLoaderSimple", field: "ckpt_name", current: "不存在的模型.ckpt" });
    expect(r.invalidEnums[0].options).toEqual(["sdxl.safetensors", "sd15.safetensors"]);
  });
  it("合法值 → 预检通过 ok=true", () => {
    const wf: any = {
      "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sdxl.safetensors" } },
      "3": { class_type: "KSampler", inputs: { seed: 1, sampler_name: "euler", scheduler: "normal", steps: 20, model: ["4", 0], positive: ["6", 0], negative: ["6", 0], latent_image: ["5", 0] } },
      "6": { class_type: "CLIPTextEncode", inputs: { text: "hi", clip: ["4", 1] } },
    };
    expect(validateWorkflowWithInfo(wf, INFO, true).ok).toBe(true);
  });
  it("未安装的自定义节点 → missingNodes", () => {
    const wf: any = { "9": { class_type: "FooCustomNode", inputs: { bar: "x" } } };
    const r = validateWorkflowWithInfo(wf, INFO, true);
    expect(r.missingNodes).toEqual(["FooCustomNode"]);
    expect(r.ok).toBe(false);
  });
  it("连线输入（数组）不当作枚举校验", () => {
    const wf: any = { "3": { class_type: "KSampler", inputs: { sampler_name: "euler", scheduler: "normal", seed: 1, steps: 20, model: ["4", 0], positive: ["6", 0], negative: ["6", 0], latent_image: ["5", 0] } } };
    expect(validateWorkflowWithInfo(wf, INFO, true).invalidEnums).toHaveLength(0);
  });
  it("无 object_info → 不报错但 ok=false（无法预检）", () => {
    const wf: any = { "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "随便.ckpt" } } };
    const r = validateWorkflowWithInfo(wf, {}, false);
    expect(r.objectInfoAvailable).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.invalidEnums).toHaveLength(0);
    expect(r.nodeCount).toBe(1);
  });
});
