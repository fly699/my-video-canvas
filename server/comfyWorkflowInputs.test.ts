import { describe, expect, it } from "vitest";
import {
  detectUpstreamImages, detectUpstreamPrompt,
  resolveWorkflowImageParams, fillWorkflowPromptParams,
  resolveImageParamsWithMap, type UpstreamImageSource,
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

describe("resolveImageParamsWithMap", () => {
  const sources: UpstreamImageSource[] = [
    { id: "n1", title: "素材1", url: "/1.png" },
    { id: "n2", title: "素材2", url: "/2.png" },
    { id: "n3", title: "分镜1", url: "/3.png" },
  ];
  const bindings = [img("10"), img("11"), img("12")];

  it("honors explicit mapping first, then auto-fills the rest from unused sources", () => {
    // map param 10 → n3 explicitly; 11/12 auto from remaining (n1, n2) in order
    const map = { "10.inputs.image": "n3" };
    const { paramValues: out } = resolveImageParamsWithMap(bindings, {}, sources, map);
    expect(out["10.inputs.image"]).toBe("/3.png"); // explicit
    expect(out["11.inputs.image"]).toBe("/1.png"); // auto (n1, n3 excluded as mapped)
    expect(out["12.inputs.image"]).toBe("/2.png"); // auto (n2)
  });

  it("never overwrites a user-set value", () => {
    const { paramValues: out } = resolveImageParamsWithMap(bindings, { "10.inputs.image": "/user.png" }, sources, {});
    expect(out["10.inputs.image"]).toBe("/user.png");
    expect(out["11.inputs.image"]).toBe("/1.png");
  });
});

describe("detectUpstreamPrompt", () => {
  it("reads positive/negative from a prompt node", () => {
    const nodes: N[] = [{ id: "p", data: { nodeType: "prompt", payload: { positivePrompt: "a cat", negativePrompt: "blurry" } } }];
    expect(detectUpstreamPrompt("w", [{ source: "p", target: "w" }], nodes)).toEqual({ positive: "a cat", negative: "blurry" });
  });
  it("appends style/ratio to the positive prompt only when the pass flags are on", () => {
    const base = { positivePrompt: "a cat", style: "cinematic", aspectRatio: "16:9" };
    const at = (payload: Record<string, unknown>) =>
      detectUpstreamPrompt("w", [{ source: "p", target: "w" }], [{ id: "p", data: { nodeType: "prompt", payload } }]).positive;
    expect(at(base)).toBe("a cat");                                   // flags off → no extras
    expect(at({ ...base, passStyle: true })).toBe("a cat, cinematic");
    expect(at({ ...base, passRatio: true })).toBe("a cat, 16:9");
    expect(at({ ...base, passStyle: true, passRatio: true })).toBe("a cat, cinematic, 16:9");
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
