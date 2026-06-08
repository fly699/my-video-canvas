import { describe, it, expect } from "vitest";
import { listUpstreamAudioSources, resolveAudioParamsWithMap } from "./comfyWorkflowParams";
import type { WorkflowParamBinding } from "../../../shared/types";

const N = (id: string, nodeType: string, payload: unknown, title?: string) => ({ id, data: { nodeType, payload, title } });

describe("listUpstreamAudioSources", () => {
  it("收集上游 音频/素材(音频) 节点的 url，忽略图像素材与非音频源", () => {
    const nodes = [
      N("a1", "audio", { url: "voice.mp3" }, "配音"),
      N("as1", "asset", { url: "bgm.wav", type: "audio", mimeType: "audio/wav" }, "素材BGM"),
      N("img", "asset", { url: "pic.png", type: "image", mimeType: "image/png" }, "图片"),
      N("p", "prompt", {}, "提示词"),
      N("wf", "comfyui_workflow", {}, "工作流"),
    ];
    const edges = [
      { source: "a1", target: "wf" },
      { source: "as1", target: "wf" },
      { source: "img", target: "wf" },
      { source: "p", target: "wf" },
    ];
    const got = listUpstreamAudioSources("wf", edges, nodes).map((s) => s.url);
    expect(got).toEqual(["voice.mp3", "bgm.wav"]);
  });

  it("无音频上游时返回空", () => {
    const nodes = [N("img", "asset", { url: "pic.png", type: "image" }), N("wf", "comfyui_workflow", {})];
    expect(listUpstreamAudioSources("wf", [{ source: "img", target: "wf" }], nodes)).toEqual([]);
  });
});

describe("resolveAudioParamsWithMap", () => {
  const bindings: WorkflowParamBinding[] = [
    { nodeId: "449", fieldPath: "inputs.audio", label: "输入音频", type: "audio", defaultValue: "old.mp3" },
  ];
  const key = "449.inputs.audio";

  it("默认值的音频参数被上游来源自动填充，并登记到 audioParamKeys", () => {
    const r = resolveAudioParamsWithMap(bindings, { [key]: "old.mp3" }, [{ id: "a1", title: "配音", url: "voice.mp3" }]);
    expect(r.paramValues[key]).toBe("voice.mp3");
    expect(r.audioParamKeys).toEqual([key]);
  });

  it("显式来源映射优先于自动填充", () => {
    const sources = [{ id: "a1", title: "A", url: "a.mp3" }, { id: "a2", title: "B", url: "b.mp3" }];
    const r = resolveAudioParamsWithMap(bindings, { [key]: "old.mp3" }, sources, { [key]: "a2" });
    expect(r.paramValues[key]).toBe("b.mp3");
  });

  it("用户已填的非默认值不被覆盖", () => {
    const r = resolveAudioParamsWithMap(bindings, { [key]: "user-typed.mp3" }, [{ id: "a1", title: "A", url: "voice.mp3" }]);
    expect(r.paramValues[key]).toBe("user-typed.mp3");
  });
});
