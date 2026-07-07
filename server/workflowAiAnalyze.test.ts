import { describe, it, expect } from "vitest";
import { bindingPriority, withPriorities, mergeAiBindings, parseAiBindings, nodeClassMap } from "./_core/workflowAiAnalyze";
import type { WorkflowParamBinding } from "../shared/types";

const b = (nodeId: string, fieldPath: string, label: string, extra: Partial<WorkflowParamBinding> = {}): WorkflowParamBinding =>
  ({ nodeId, fieldPath, label, type: "text", ...extra });

describe("bindingPriority（主次判定）", () => {
  it("正/负提示词 role → 1（主）", () => {
    expect(bindingPriority(b("6", "inputs.text", "文本", { role: "positive" }))).toBe(1);
    expect(bindingPriority(b("7", "inputs.text", "文本", { role: "negative" }))).toBe(1);
  });
  it("尺寸/主模型/步数/CFG/种子字段 → 1", () => {
    for (const fp of ["inputs.width", "inputs.height", "inputs.ckpt_name", "inputs.steps", "inputs.cfg", "inputs.seed", "inputs.noise_seed"]) {
      expect(bindingPriority(b("n", fp, "x"))).toBe(1);
    }
  });
  it("次要参数（vae/scheduler/clip）→ 2", () => {
    expect(bindingPriority(b("n", "inputs.vae_name", "VAE"))).toBe(2);
    expect(bindingPriority(b("n", "inputs.scheduler", "调度器"))).toBe(2);
  });
  it("withPriorities 给未赋值的补 priority、已有的不动", () => {
    const out = withPriorities([b("6", "inputs.text", "x", { role: "positive" }), b("n", "inputs.vae_name", "VAE", { priority: 1 })]);
    expect(out[0].priority).toBe(1);
    expect(out[1].priority).toBe(1); // 已有的保留
  });
});

describe("mergeAiBindings（AI 纠正只覆盖 type/role/priority/label）", () => {
  const base = [b("3", "inputs.sampler_name", "sampler_name"), b("6", "inputs.text", "文本")];
  it("把误判为 text 的 sampler_name 纠正成 select，并排主次", () => {
    const ai = [{ nodeId: "3", fieldPath: "inputs.sampler_name", type: "select", priority: 2 }, { nodeId: "6", fieldPath: "inputs.text", role: "positive", priority: 1 }];
    const out = mergeAiBindings(base, ai as never);
    expect(out[0].type).toBe("select");
    expect(out[0].priority).toBe(2);
    expect(out[1].role).toBe("positive");
    expect(out[1].priority).toBe(1);
  });
  it("非法 type/role 被忽略；未命中的绑定原样保留", () => {
    const ai = [{ nodeId: "3", fieldPath: "inputs.sampler_name", type: "bogus", role: "nonsense" }];
    const out = mergeAiBindings(base, ai as never);
    expect(out[0].type).toBe("text");    // 非法 type 不生效
    expect(out[0].role).toBeUndefined(); // 非法 role 不生效
    expect(out[1]).toEqual(base[1]);     // 未命中保留
  });
});

describe("parseAiBindings / nodeClassMap", () => {
  it("从含 Markdown 围栏的文本抠出 bindings", () => {
    const txt = '好的：\n```json\n{"bindings":[{"nodeId":"6","fieldPath":"inputs.text","type":"text"}]}\n```';
    expect(parseAiBindings(txt)).toEqual([{ nodeId: "6", fieldPath: "inputs.text", type: "text" }]);
  });
  it("无 bindings / 坏 JSON → []", () => {
    expect(parseAiBindings("no json")).toEqual([]);
    expect(parseAiBindings('{"foo":1}')).toEqual([]);
  });
  it("nodeClassMap 抽 nodeId→class_type", () => {
    expect(nodeClassMap('{"3":{"class_type":"KSampler","inputs":{}},"6":{"class_type":"CLIPTextEncode"}}')).toEqual({ "3": "KSampler", "6": "CLIPTextEncode" });
    expect(nodeClassMap("bad")).toEqual({});
  });
});
