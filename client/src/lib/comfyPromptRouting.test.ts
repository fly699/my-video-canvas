import { describe, it, expect } from "vitest";
import { positivePromptParamKey, fillWorkflowPromptParams, resolveImageParamsWithMap } from "./comfyWorkflowParams";

type B = { nodeId: string; fieldPath: string; label: string; type: "text" | "image"; role?: "positive" | "negative"; defaultValue?: unknown };
const t = (nodeId: string, fieldPath: string, label: string, extra: Partial<B> = {}): B => ({ nodeId, fieldPath, label, type: "text", ...extra });

describe("提示词路由：绝不把正向词灌进采样器/模型选择字段（严重1）", () => {
  // 无 object_info 分析时 sampler_name/scheduler/ckpt_name 会被误判为 text 类型。
  it("有真正的文本字段时，正向词槽选 inputs.text，而非 sampler_name", () => {
    const b = [t("3", "inputs.sampler_name", "sampler_name"), t("6", "inputs.text", "text")];
    expect(positivePromptParamKey(b as never)).toBe("6.inputs.text");
  });
  it("只有采样器/模型选择字段（无真文本字段）→ 返回 null，不误选", () => {
    const b = [t("3", "inputs.sampler_name", "sampler_name"), t("4", "inputs.scheduler", "scheduler"), t("5", "inputs.ckpt_name", "ckpt_name")];
    expect(positivePromptParamKey(b as never)).toBeNull();
  });
  it("fillWorkflowPromptParams 把正向词写进 text、绝不写进 sampler_name", () => {
    const b = [t("3", "inputs.sampler_name", "sampler_name", { defaultValue: "euler" }), t("6", "inputs.text", "text", { defaultValue: "" })];
    const out = fillWorkflowPromptParams(b as never, {}, { positive: "a red car" }, { force: true });
    expect(out["6.inputs.text"]).toBe("a red car");
    expect(out["3.inputs.sampler_name"]).toBeUndefined(); // 采样器名没被污染
  });
  it("显式 role=positive 仍优先，即便字段名怪", () => {
    const b = [t("6", "inputs.text", "文本", { role: "positive" })];
    expect(positivePromptParamKey(b as never)).toBe("6.inputs.text");
  });
});

describe("imageSourceMap 悬空映射：来源断连时留空、不填错图（finding 7）", () => {
  it("映射到已断连的来源 → 该参数留空（不退回自动填另一张图）", () => {
    const bindings = [{ nodeId: "10", fieldPath: "inputs.image", label: "image", type: "image", defaultValue: "" }];
    const sources = [{ id: "S2", url: "http://x/other.png" }] as never;
    const out = resolveImageParamsWithMap(bindings as never, {}, sources, { "10.inputs.image": "S1" });
    expect(out.paramValues["10.inputs.image"]).toBeUndefined();
  });
  it("映射到存在的来源 → 正常填该来源", () => {
    const bindings = [{ nodeId: "10", fieldPath: "inputs.image", label: "image", type: "image", defaultValue: "" }];
    const sources = [{ id: "S1", url: "http://x/right.png" }] as never;
    const out = resolveImageParamsWithMap(bindings as never, {}, sources, { "10.inputs.image": "S1" });
    expect(out.paramValues["10.inputs.image"]).toBe("http://x/right.png");
  });
});
