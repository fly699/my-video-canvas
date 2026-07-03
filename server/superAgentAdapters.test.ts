import { describe, it, expect } from "vitest";
import { formatValidationErrors } from "./_core/superAgent/comfyAdapters";
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
