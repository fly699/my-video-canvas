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
  EmptyLatentImage: { input: { required: { width: ["INT", { default: 512 }], height: ["INT", { default: 512 }], batch_size: ["INT", { default: 1 }] } } },
  // LoadImage.image 是「已上传文件」枚举 + image_upload 标志：运行时上传，不该按服务器现有文件校验。
  LoadImage: { input: { required: { image: [["alreadyOnServer.png"], { image_upload: true }] } } },
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
  it("合法值（完整图）→ 预检通过 ok=true", () => {
    const wf: any = {
      "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sdxl.safetensors" } },
      "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
      "3": { class_type: "KSampler", inputs: { seed: 1, sampler_name: "euler", scheduler: "normal", steps: 20, model: ["4", 0], positive: ["6", 0], negative: ["6", 0], latent_image: ["5", 0] } },
      "6": { class_type: "CLIPTextEncode", inputs: { text: "hi", clip: ["4", 1] } },
    };
    const r = validateWorkflowWithInfo(wf, INFO, true);
    expect(r.ok).toBe(true);
    expect(r.danglingLinks).toHaveLength(0);
  });

  it("连线指向不存在的节点 → danglingLinks，ok=false（即便其它都合法）", () => {
    const wf: any = {
      "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sdxl.safetensors" } },
      "3": { class_type: "KSampler", inputs: { seed: 1, sampler_name: "euler", scheduler: "normal", steps: 20, model: ["4", 0], positive: ["6", 0], negative: ["6", 0], latent_image: ["99", 0] } }, // 99 不存在
      "6": { class_type: "CLIPTextEncode", inputs: { text: "hi", clip: ["4", 1] } },
    };
    const r = validateWorkflowWithInfo(wf, INFO, true);
    expect(r.ok).toBe(false);
    expect(r.danglingLinks).toHaveLength(1);
    expect(r.danglingLinks[0]).toMatchObject({ nodeId: "3", classType: "KSampler", field: "latent_image", current: "99" });
  });

  it("悬空连线纯结构、不依赖 object_info（服务器离线也能查出）", () => {
    const wf: any = {
      "3": { class_type: "KSampler", inputs: { latent_image: ["99", 0], model: ["4", 0] } },
      "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "x" } },
    };
    const r = validateWorkflowWithInfo(wf, {}, false); // objectInfoAvailable=false
    expect(r.danglingLinks).toHaveLength(1);
    expect(r.danglingLinks[0].current).toBe("99");
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
  it("运行时媒体输入（LoadImage.image / image_upload）不当枚举校验，避免误报", () => {
    const wf: any = {
      "11": { class_type: "LoadImage", inputs: { image: "导入工作流里的文件名.png" } },
    };
    const r = validateWorkflowWithInfo(wf, INFO, true);
    expect(r.invalidEnums).toHaveLength(0);
    expect(r.missingRequired).toHaveLength(0);
    expect(r.ok).toBe(true);
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
