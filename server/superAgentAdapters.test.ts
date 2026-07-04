import { describe, it, expect } from "vitest";
import { formatValidationErrors, formatInputField, formatNodeSchemas, collectErrorNodeClasses } from "./_core/superAgent/comfyAdapters";
import type { WorkflowValidationResult } from "./_core/comfyui";

const base: WorkflowValidationResult = {
  objectInfoAvailable: true,
  nodeCount: 5,
  missingNodes: [],
  invalidEnums: [],
  missingRequired: [],
  danglingLinks: [],
  ok: true,
};

describe("formatValidationErrors", () => {
  it("全通过 → 空数组", () => {
    expect(formatValidationErrors(base)).toEqual([]);
  });

  it("object_info 取不到 → 提示仅结构检查", () => {
    const out = formatValidationErrors({ ...base, objectInfoAvailable: false });
    expect(out.length).toBe(1);
    expect(out[0]).toContain("仅做结构检查");
  });

  it("缺节点 / 非法枚举 / 必填缺失 / 悬空连线 都转成可读行", () => {
    const out = formatValidationErrors({
      ...base,
      ok: false,
      missingNodes: ["FooCustomNode"],
      invalidEnums: [{ nodeId: "4", classType: "CheckpointLoaderSimple", field: "ckpt_name", current: "nope.safetensors", options: ["sd_xl_base_1.0.safetensors"] }],
      missingRequired: [{ nodeId: "3", classType: "KSampler", field: "seed" }],
      danglingLinks: [{ nodeId: "9", classType: "SaveImage", field: "images" }],
    });
    expect(out.some((l) => l.includes("FooCustomNode"))).toBe(true);
    expect(out.some((l) => l.includes("取值非法") && l.includes("ckpt_name") && l.includes("nope.safetensors"))).toBe(true);
    expect(out.some((l) => l.includes("合法值示例") && l.includes("sd_xl_base_1.0.safetensors"))).toBe(true);
    expect(out.some((l) => l.includes("必填输入缺失") && l.includes("seed"))).toBe(true);
    expect(out.some((l) => l.includes("悬空连线") && l.includes("SaveImage"))).toBe(true);
  });
});

describe("collectErrorNodeClasses", () => {
  it("汇总缺节点名 + 各类问题的 classType（去重）", () => {
    const out = collectErrorNodeClasses({
      ...base,
      ok: false,
      missingNodes: ["FooCustomNode"],
      invalidEnums: [{ nodeId: "4", classType: "CheckpointLoaderSimple", field: "ckpt_name" }],
      missingRequired: [{ nodeId: "3", classType: "KSampler", field: "seed" }, { nodeId: "5", classType: "KSampler", field: "steps" }],
      danglingLinks: [{ nodeId: "9", classType: "SaveImage", field: "images" }],
    });
    expect(out).toContain("FooCustomNode");
    expect(out).toContain("CheckpointLoaderSimple");
    expect(out).toContain("SaveImage");
    expect(out.filter((c) => c === "KSampler").length).toBe(1); // 去重
  });
  it("全通过 → 空", () => {
    expect(collectErrorNodeClasses(base)).toEqual([]);
  });
});

describe("formatInputField", () => {
  it("连线型输入（MODEL/CONDITIONING/LATENT…）标注需连线", () => {
    expect(formatInputField("model", ["MODEL"])).toBe("model: <MODEL>(连线)");
    expect(formatInputField("latent_image", ["LATENT"])).toBe("latent_image: <LATENT>(连线)");
  });
  it("数值/字符串型输入带类型与默认值", () => {
    expect(formatInputField("steps", ["INT", { default: 20, min: 1, max: 10000 }])).toBe("steps: INT=20");
    expect(formatInputField("cfg", ["FLOAT", { default: 8 }])).toBe("cfg: FLOAT=8");
    expect(formatInputField("text", ["STRING", { multiline: true }])).toBe("text: STRING");
  });
  it("枚举型输入列出合法值（超 24 截断）+ 默认", () => {
    const out = formatInputField("sampler_name", [["euler", "euler_ancestral", "dpmpp_2m"], { default: "euler" }]);
    expect(out).toContain("枚举{euler,euler_ancestral,dpmpp_2m}");
    expect(out).toContain("默认\"euler\"");
    const many = formatInputField("x", [Array.from({ length: 30 }, (_, i) => `v${i}`)]);
    expect(many).toContain("…(+6)");
  });
});

describe("formatNodeSchemas", () => {
  const INFO = {
    KSampler: {
      input: {
        required: {
          model: ["MODEL"],
          seed: ["INT", { default: 0 }],
          sampler_name: [["euler", "dpmpp_2m"]],
        },
        optional: { denoise: ["FLOAT", { default: 1 }] },
      },
      output: ["LATENT"],
      output_name: ["LATENT"],
    },
  };
  it("按类名输出必填/可选/输出端口", () => {
    const out = formatNodeSchemas(INFO, ["KSampler"]);
    expect(out).toContain("【KSampler】");
    expect(out).toContain("输出: LATENT");
    expect(out).toContain("必填:");
    expect(out).toContain("model: <MODEL>(连线)");
    expect(out).toContain("seed: INT=0");
    expect(out).toContain("sampler_name: 枚举{euler,dpmpp_2m}");
    expect(out).toContain("可选:");
    expect(out).toContain("denoise: FLOAT=1");
  });
  it("不存在的节点类 → 明确标注未安装", () => {
    expect(formatNodeSchemas(INFO, ["FooBar"])).toContain("未安装/不存在");
  });
  it("object_info 取不到 → 兜底提示", () => {
    expect(formatNodeSchemas(null, ["KSampler"])).toContain("无法连接 /object_info");
  });
});
