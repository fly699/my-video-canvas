import { describe, expect, it } from "vitest";
import {
  detectUpstreamImages, detectUpstreamPrompt,
  resolveWorkflowImageParams, fillWorkflowPromptParams,
} from "../client/src/lib/comfyWorkflowParams";
import type { WorkflowParamBinding } from "../shared/types";

type N = { id: string; data: { nodeType: string; payload?: unknown } };
type E = { source: string; target: string };

const img = (key: string) => ({ nodeId: key, fieldPath: "inputs.image", label: "输入图像", type: "image" } as WorkflowParamBinding);
const txt = (key: string, label: string) => ({ nodeId: key, fieldPath: "inputs.text", label, type: "text" } as WorkflowParamBinding);

describe("detectUpstreamImages (multi-reference)", () => {
  it("collects all upstream image URLs in edge order, de-duplicated", () => {
    const nodes: N[] = [
      { id: "a", data: { nodeType: "image_gen", payload: { imageUrl: "/a.png" } } },
      { id: "b", data: { nodeType: "comfyui_image", payload: { imageUrl: "/b.png" } } },
      { id: "c", data: { nodeType: "asset", payload: { url: "/c.png", mimeType: "image/png" } } },
      { id: "w", data: { nodeType: "comfyui_workflow", payload: {} } },
    ];
    const edges: E[] = [{ source: "a", target: "w" }, { source: "b", target: "w" }, { source: "c", target: "w" }];
    expect(detectUpstreamImages("w", edges, nodes)).toEqual(["/a.png", "/b.png", "/c.png"]);
  });
});

describe("resolveWorkflowImageParams fills multiple blanks in order", () => {
  it("distributes upstream images across blank image params, preserving user-set ones", () => {
    const bindings = [img("10"), img("11"), img("12")];
    const paramValues = { "11.inputs.image": "/user.png" }; // user already set #11
    const { paramValues: out } = resolveWorkflowImageParams(bindings, paramValues, ["/up1.png", "/up2.png"]);
    expect(out["10.inputs.image"]).toBe("/up1.png"); // first blank
    expect(out["11.inputs.image"]).toBe("/user.png"); // untouched
    expect(out["12.inputs.image"]).toBe("/up2.png"); // next blank
  });
  it("a single string still fills only the first blank (backward compatible)", () => {
    const { paramValues: out } = resolveWorkflowImageParams([img("1"), img("2")], {}, "/one.png");
    expect(out["1.inputs.image"]).toBe("/one.png");
    expect(out["2.inputs.image"]).toBeUndefined();
  });
});

describe("detectUpstreamPrompt", () => {
  it("reads positive/negative from a prompt node", () => {
    const nodes: N[] = [{ id: "p", data: { nodeType: "prompt", payload: { positivePrompt: "a cat", negativePrompt: "blurry" } } }];
    expect(detectUpstreamPrompt("w", [{ source: "p", target: "w" }], nodes)).toEqual({ positive: "a cat", negative: "blurry" });
  });
  it("reads script content and ai_chat last assistant message as positive", () => {
    const nodes: N[] = [
      { id: "s", data: { nodeType: "script", payload: { content: "scene text" } } },
      { id: "ai", data: { nodeType: "ai_chat", payload: { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "final prompt" }] } } },
    ];
    expect(detectUpstreamPrompt("w", [{ source: "s", target: "w" }], nodes).positive).toBe("scene text");
    expect(detectUpstreamPrompt("w", [{ source: "ai", target: "w" }], nodes).positive).toBe("final prompt");
  });
});

describe("fillWorkflowPromptParams", () => {
  it("fills blank positive/negative text params, leaving user-set ones", () => {
    const bindings = [txt("6", "提示词"), txt("7", "负向提示词")];
    const out = fillWorkflowPromptParams(bindings, { "6.inputs.text": "mine" }, { positive: "up-pos", negative: "up-neg" });
    expect(out["6.inputs.text"]).toBe("mine");   // user kept
    expect(out["7.inputs.text"]).toBe("up-neg"); // blank filled
  });

  it("uses explicit roles over label heuristics", () => {
    // labels don't say 提示词, but roles do the targeting
    const bindings: WorkflowParamBinding[] = [
      { nodeId: "a", fieldPath: "inputs.text", label: "文本A", type: "text", role: "positive" },
      { nodeId: "b", fieldPath: "inputs.text", label: "文本B", type: "text", role: "negative" },
    ];
    const out = fillWorkflowPromptParams(bindings, {}, { positive: "P", negative: "N" });
    expect(out["a.inputs.text"]).toBe("P");
    expect(out["b.inputs.text"]).toBe("N");
  });
});
