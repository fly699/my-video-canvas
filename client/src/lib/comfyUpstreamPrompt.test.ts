import { describe, it, expect } from "vitest";
import { fillWorkflowPromptParams, resolveWorkflowImageParams, resolveImageParamsWithMap } from "./comfyWorkflowParams";
import type { WorkflowParamBinding } from "../../../shared/types";

// Mirrors the z_image_turbo workflow: node 6 = positive (literal default text),
// node 7 = negative. Connecting an upstream prompt node must drive these.
const bindings: WorkflowParamBinding[] = [
  { nodeId: "6", fieldPath: "inputs.text", type: "text", role: "positive", label: "提示词", defaultValue: "一个女孩在学校的操场上" },
  { nodeId: "7", fieldPath: "inputs.text", type: "text", role: "negative", label: "负向提示词", defaultValue: "多人" },
  { nodeId: "3", fieldPath: "inputs.seed", type: "number", label: "随机种子", defaultValue: 1 },
];

describe("fillWorkflowPromptParams — upstream overrides workflow defaults", () => {
  it("overrides an existing positive value (built-in default) with the upstream prompt", () => {
    const out = fillWorkflowPromptParams(bindings, { "6.inputs.text": "一个女孩在学校的操场上" }, { positive: "赛博朋克城市夜景" });
    expect(out["6.inputs.text"]).toBe("赛博朋克城市夜景");
  });

  it("fills positive AND negative by role", () => {
    const out = fillWorkflowPromptParams(bindings, {}, { positive: "正向X", negative: "负向Y" });
    expect(out["6.inputs.text"]).toBe("正向X");
    expect(out["7.inputs.text"]).toBe("负向Y");
  });

  it("only overrides the side the upstream provides", () => {
    // node 6 still at its built-in default → overridden; node 7 has no upstream → kept.
    const out = fillWorkflowPromptParams(bindings, { "6.inputs.text": "一个女孩在学校的操场上", "7.inputs.text": "多人" }, { positive: "新正向" });
    expect(out["6.inputs.text"]).toBe("新正向");
    expect(out["7.inputs.text"]).toBe("多人"); // untouched — no upstream negative
  });

  it("preserves a prompt the user deliberately typed (differs from default)", () => {
    const out = fillWorkflowPromptParams(bindings, { "6.inputs.text": "我自己写的提示词" }, { positive: "上游提示" });
    expect(out["6.inputs.text"]).toBe("我自己写的提示词"); // user edit wins over upstream-fill
  });

  it("never touches non-text params (e.g. seed)", () => {
    const out = fillWorkflowPromptParams(bindings, { "3.inputs.seed": 42 }, { positive: "x" });
    expect(out["3.inputs.seed"]).toBe(42);
  });

  it("no upstream prompt → paramValues unchanged", () => {
    const pv = { "6.inputs.text": "原样" };
    expect(fillWorkflowPromptParams(bindings, pv, {})).toEqual(pv);
  });

  it("image params: upstream image overrides a built-in default filename", () => {
    const imgB: WorkflowParamBinding[] = [
      { nodeId: "11", fieldPath: "inputs.image", type: "image", role: "reference", label: "输入图像", defaultValue: "example.png" },
    ];
    // param still holds the workflow's built-in default filename → upstream overrides
    const out = resolveWorkflowImageParams(imgB, { "11.inputs.image": "example.png" }, ["/up.png"]);
    expect(out.paramValues["11.inputs.image"]).toBe("/up.png");
  });

  it("image params: a user-set image (differs from default) is preserved", () => {
    const imgB: WorkflowParamBinding[] = [
      { nodeId: "11", fieldPath: "inputs.image", type: "image", role: "reference", label: "输入图像", defaultValue: "example.png" },
    ];
    const out = resolveWorkflowImageParams(imgB, { "11.inputs.image": "/mine.png" }, ["/up.png"]);
    expect(out.paramValues["11.inputs.image"]).toBe("/mine.png");
  });

  it("resolveImageParamsWithMap: upstream overrides default, keeps user edits", () => {
    const imgB: WorkflowParamBinding[] = [
      { nodeId: "10", fieldPath: "inputs.image", type: "image", label: "图A", defaultValue: "a_default.png" },
      { nodeId: "11", fieldPath: "inputs.image", type: "image", label: "图B" }, // no default, user set
    ];
    const out = resolveImageParamsWithMap(
      imgB,
      { "10.inputs.image": "a_default.png", "11.inputs.image": "/userB.png" },
      [{ id: "s1", url: "/auto1.png", label: "上游1" }],
    );
    expect(out.paramValues["10.inputs.image"]).toBe("/auto1.png"); // default overridden
    expect(out.paramValues["11.inputs.image"]).toBe("/userB.png"); // user edit kept
  });

  it("falls back to label heuristic when bindings have no explicit role", () => {
    const noRole: WorkflowParamBinding[] = [
      { nodeId: "6", fieldPath: "inputs.text", type: "text", label: "正向提示词" },
      { nodeId: "7", fieldPath: "inputs.text", type: "text", label: "负向提示词" },
    ];
    const out = fillWorkflowPromptParams(noRole, {}, { positive: "P", negative: "N" });
    expect(out["6.inputs.text"]).toBe("P"); // 正向 label → positive
    expect(out["7.inputs.text"]).toBe("N"); // 负向 label → negative
  });
});
