import { describe, it, expect } from "vitest";
import { listUpstreamVideoSources, listUpstreamAudioSources, detectUpstreamImages } from "./comfyWorkflowParams";

// 节点/边构造（与 detectUpstreamImagesExpanded.test 同形）。
type N = { id: string; data: { nodeType: string; payload?: unknown; title?: string }; position?: { y?: number } };
const node = (id: string, nodeType: string, payload: Record<string, unknown> = {}, y = 0): N =>
  ({ id, data: { nodeType, payload, title: id }, position: { y } });
const edge = (source: string, target = "t") => ({ source, target });

// 回归：comfyWorkflowParams 的源类型集合必须与 runner/MergeNode 对齐，否则参考视频/参考图
// 在收集处被静默漏掉（多模态参考丢失）。
describe("listUpstreamVideoSources — 含合成类视频源（与 runner VIDEO_SOURCE_TYPES 对齐）", () => {
  it("识别 clip/merge/overlay/subtitle/smart_cut 的 outputUrl 作参考视频源", () => {
    const nodes = [
      node("c", "clip", { outputUrl: "clip.mp4" }),
      node("m", "merge", { outputUrl: "merge.mp4" }),
      node("o", "overlay", { outputUrl: "ov.mp4" }),
      node("s", "smart_cut", { outputUrl: "sc.mp4" }),
    ];
    const urls = listUpstreamVideoSources("t", [edge("c"), edge("m"), edge("o"), edge("s")], nodes).map((v) => v.url);
    expect(urls).toEqual(["clip.mp4", "merge.mp4", "ov.mp4", "sc.mp4"]);
  });
  it("comfyui_workflow 仅在产出视频时算视频源", () => {
    const vid = listUpstreamVideoSources("t", [edge("w")], [node("w", "comfyui_workflow", { outputType: "video", outputUrl: "w.mp4" })]);
    const img = listUpstreamVideoSources("t", [edge("w")], [node("w", "comfyui_workflow", { outputType: "image", outputUrl: "w.png" })]);
    expect(vid.map((v) => v.url)).toEqual(["w.mp4"]);
    expect(img).toEqual([]);
  });
  it("video_task 仍优先 resultVideoUrl", () => {
    expect(listUpstreamVideoSources("t", [edge("v")], [node("v", "video_task", { resultVideoUrl: "r.mp4", outputUrl: "o.mp4" })])[0].url).toBe("r.mp4");
  });
});

describe("detectUpstreamImages — 含 image_edit / pose_control / director（与推送式源集合对齐）", () => {
  it("识别 image_edit / pose_control 的 outputUrl/outputImageUrl 作图源", () => {
    const nodes = [
      node("e", "image_edit", { outputUrl: "edit.png" }),
      node("p", "pose_control", { outputImageUrl: "pose.png" }),
    ];
    expect(detectUpstreamImages("t", [edge("e"), edge("p")], nodes)).toEqual(["edit.png", "pose.png"]);
  });
  it("识别 director 的 3D 截图(imageUrl)作图源（连接矩阵允许 director → ComfyUI/角色，收集处须认它）", () => {
    expect(detectUpstreamImages("t", [edge("d")], [node("d", "director", { imageUrl: "3d.png" })])).toEqual(["3d.png"]);
  });
});
