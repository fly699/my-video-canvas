import { describe, it, expect } from "vitest";
import { buildWorkflowRunInput } from "./workflowRunInput";

// 逐节点与「运行全部/框选」共用 buildWorkflowRunInput —— 验证批量路径不再丢上游提示词/图（Gap A）。
const wfNode = (id: string, payload: unknown) => ({ id, data: { nodeType: "comfyui_workflow", payload }, position: { x: 0, y: 0 } });
const promptNode = (id: string, positive: string) => ({ id, data: { nodeType: "prompt", payload: { positivePrompt: positive } }, position: { x: 0, y: 0 } });

const basePayload = {
  workflowJson: '{"6":{"class_type":"CLIPTextEncode","inputs":{"text":""}}}',
  paramBindings: [{ nodeId: "6", fieldPath: "inputs.text", label: "提示词", type: "text", role: "positive", defaultValue: "" }],
  paramValues: {},
  preferUpstreamPrompt: true,
};

describe("buildWorkflowRunInput（逐节点与批量共用，Gap A）", () => {
  it("上游 prompt 节点的正向词被注入工作流的正向文本参数", () => {
    const nodes = [promptNode("p", "cyberpunk city at night"), wfNode("w", basePayload)];
    const edges = [{ source: "p", target: "w" }];
    const out = buildWorkflowRunInput("w", basePayload as never, nodes as never, edges as never);
    expect(out.paramValues["6.inputs.text"]).toBe("cyberpunk city at night");
  });

  it("上游图像源被填进空的 image 参数", () => {
    const payload = {
      ...basePayload,
      paramBindings: [{ nodeId: "10", fieldPath: "inputs.image", label: "image", type: "image", defaultValue: "" }],
    };
    const imgNode = { id: "i", data: { nodeType: "image_gen", payload: { imageUrl: "http://x/a.png" } }, position: { x: 0, y: 0 } };
    const nodes = [imgNode, wfNode("w", payload)];
    const edges = [{ source: "i", target: "w" }];
    const out = buildWorkflowRunInput("w", payload as never, nodes as never, edges as never);
    expect(out.paramValues["10.inputs.image"]).toBe("http://x/a.png");
    expect(out.imageParamKeys).toContain("10.inputs.image");
  });

  it("无上游 → 正向文本保持工作流默认（不乱填）", () => {
    const out = buildWorkflowRunInput("w", basePayload as never, [wfNode("w", basePayload)] as never, [] as never);
    expect(out.paramValues["6.inputs.text"]).toBeUndefined(); // 空默认、无上游 → 不写
  });
});
