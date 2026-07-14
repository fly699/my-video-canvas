import { describe, it, expect } from "vitest";
import { buildWorkflowExportJson, workflowExportFilename } from "./comfyWorkflowExport";
import type { WorkflowParamBinding } from "../../../shared/types";

const WF = JSON.stringify({
  "3": { class_type: "KSampler", inputs: { seed: 0, steps: 20, cfg: 7 } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "old prompt" } },
  "10": { class_type: "LoadImage", inputs: { image: "placeholder.png" } },
});
const B = (over: Partial<WorkflowParamBinding>): WorkflowParamBinding => ({ nodeId: "3", fieldPath: "inputs.seed", label: "seed", type: "number", ...over });

describe("buildWorkflowExportJson", () => {
  it("回写非图像/音频参数值到 inputs", () => {
    const bindings = [B({ nodeId: "6", fieldPath: "inputs.text", type: "text", label: "prompt" }), B({ nodeId: "3", fieldPath: "inputs.steps", type: "number" })];
    const values = { "6.inputs.text": "new prompt", "3.inputs.steps": 30 };
    const out = JSON.parse(buildWorkflowExportJson(WF, bindings, values)!);
    expect(out["6"].inputs.text).toBe("new prompt");
    expect(out["3"].inputs.steps).toBe(30);
    expect(out["3"].inputs.cfg).toBe(7); // 未改的保留
  });

  it("跳过 image / audio 类参数（运行期 URL，不可移植）", () => {
    const bindings = [B({ nodeId: "10", fieldPath: "inputs.image", type: "image", label: "img" })];
    const values = { "10.inputs.image": "https://x/a.png" };
    const out = JSON.parse(buildWorkflowExportJson(WF, bindings, values)!);
    expect(out["10"].inputs.image).toBe("placeholder.png"); // 保留占位，不写入 URL
  });

  it("fieldPath 不带 inputs 前缀也能写入", () => {
    const bindings = [B({ nodeId: "3", fieldPath: "seed", type: "number" })];
    const out = JSON.parse(buildWorkflowExportJson(WF, bindings, { "3.seed": 42 })!);
    expect(out["3"].inputs.seed).toBe(42);
  });

  it("空值 / 未设值不覆盖原值", () => {
    const bindings = [B({ nodeId: "6", fieldPath: "inputs.text", type: "text" }), B({ nodeId: "3", fieldPath: "inputs.seed", type: "number" })];
    const out = JSON.parse(buildWorkflowExportJson(WF, bindings, { "6.inputs.text": "" })!);
    expect(out["6"].inputs.text).toBe("old prompt"); // 空字符串不覆盖
    expect(out["3"].inputs.seed).toBe(0);            // 未提供值不动
  });

  it("无绑定 → 原样导出", () => {
    const out = JSON.parse(buildWorkflowExportJson(WF, undefined, undefined)!);
    expect(out["6"].inputs.text).toBe("old prompt");
  });

  it("空 / 非法 JSON → null", () => {
    expect(buildWorkflowExportJson("", [], {})).toBeNull();
    expect(buildWorkflowExportJson("   ", [], {})).toBeNull();
    expect(buildWorkflowExportJson("not json", [], {})).toBeNull();
    expect(buildWorkflowExportJson("[1,2,3]", [], {})).toBeNull(); // 数组非工作流
    expect(buildWorkflowExportJson(undefined, [], {})).toBeNull();
  });

  it("绑定指向不存在的节点 → 安全跳过，不崩", () => {
    const bindings = [B({ nodeId: "999", fieldPath: "inputs.x", type: "number" })];
    const out = JSON.parse(buildWorkflowExportJson(WF, bindings, { "999.inputs.x": 1 })!);
    expect(out["999"]).toBeUndefined();
    expect(out["3"].inputs.seed).toBe(0);
  });

  it("输出为美化缩进（2 空格）", () => {
    const s = buildWorkflowExportJson(WF, [], {})!;
    expect(s).toContain("\n  ");
  });
});

describe("workflowExportFilename", () => {
  it("正常名 → name.json", () => {
    expect(workflowExportFilename("我的工作流")).toBe("我的工作流.json");
  });
  it("去非法字符 + 空格转下划线", () => {
    expect(workflowExportFilename("a/b:c d")).toBe("a_b_c_d.json");
  });
  it("空名 → workflow.json", () => {
    expect(workflowExportFilename("")).toBe("workflow.json");
    expect(workflowExportFilename(undefined)).toBe("workflow.json");
    expect(workflowExportFilename("   ")).toBe("workflow.json");
  });
  it("超长截断到 60", () => {
    const name = "x".repeat(100);
    expect(workflowExportFilename(name)).toBe("x".repeat(60) + ".json");
  });
});
