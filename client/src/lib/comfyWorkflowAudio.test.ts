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

import { listUpstreamVideoSources, listCanvasMediaSources, mentionedMediaUrls, stripMediaMentions } from "./comfyWorkflowParams";

const NV = (id: string, nodeType: string, payload: unknown, title?: string) => ({ id, data: { nodeType, payload, title } });

describe("listUpstreamVideoSources", () => {
  it("收集上游 video_task/comfyui_video/素材(视频) 的 url，忽略图像/音频源", () => {
    const nodes = [
      NV("vt", "video_task", { resultVideoUrl: "out.mp4" }, "成片"),
      NV("cv", "comfyui_video", { resultVideoUrl: "cv.mp4" }, "Comfy视频"),
      NV("as", "asset", { url: "clip.mov", type: "video", mimeType: "video/quicktime" }, "素材片段"),
      NV("img", "asset", { url: "p.png", type: "image", mimeType: "image/png" }, "图"),
      NV("aud", "asset", { url: "a.mp3", type: "audio", mimeType: "audio/mpeg" }, "音"),
    ];
    const edges = [
      { source: "vt", target: "t" }, { source: "cv", target: "t" }, { source: "as", target: "t" },
      { source: "img", target: "t" }, { source: "aud", target: "t" },
    ];
    expect(listUpstreamVideoSources("t", edges, nodes).map((v) => v.url)).toEqual(["out.mp4", "cv.mp4", "clip.mov"]);
  });
});

describe("@音频名 / @视频名（独立媒体节点）", () => {
  const nodes = [
    NV("a1", "audio", { url: "voice.mp3" }, "旁白"),
    NV("v1", "video_task", { resultVideoUrl: "dance.mp4" }, "舞蹈"),
    NV("v2", "asset", { url: "scene.mp4", type: "video", mimeType: "video/mp4" }, "外景"),
  ];

  it("listCanvasMediaSources 列出有标题的音/视频节点", () => {
    expect(listCanvasMediaSources(nodes).map((m) => [m.name, m.kind, m.url])).toEqual([
      ["旁白", "audio", "voice.mp3"], ["舞蹈", "video", "dance.mp4"], ["外景", "video", "scene.mp4"],
    ]);
  });

  it("mentionedMediaUrls 按 kind 解析 @名字", () => {
    expect(mentionedMediaUrls("配上 @旁白 旁白音", "audio", nodes)).toEqual(["voice.mp3"]);
    expect(mentionedMediaUrls("参考 @舞蹈 和 @外景 的动作", "video", nodes)).toEqual(["dance.mp4", "scene.mp4"]);
    expect(mentionedMediaUrls("无提及", "audio", nodes)).toEqual([]);
  });

  it("stripMediaMentions 去掉 @媒体名 字面量", () => {
    expect(stripMediaMentions("配上 @旁白 做 @舞蹈 动作", nodes)).toBe("配上 做 动作");
  });
});
