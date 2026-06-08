import { describe, it, expect } from "vitest";
import { detectUpstreamImagesExpanded } from "./comfyWorkflowParams";

type N = { id: string; data: { nodeType: string; payload?: unknown; title?: string }; position?: { y?: number } };
const node = (id: string, nodeType: string, payload: Record<string, unknown> = {}, title?: string, y = 0): N =>
  ({ id, data: { nodeType, payload, title }, position: { y } });
const edge = (source: string, target = "char") => ({ source, target });

describe("detectUpstreamImagesExpanded", () => {
  it("batch-expands image_gen.imageUrls (all images, array order)", () => {
    const nodes = [node("g", "image_gen", { imageUrl: "a.png", imageUrls: ["a.png", "b.png", "c.png"] })];
    expect(detectUpstreamImagesExpanded("char", [edge("g")], nodes)).toEqual(["a.png", "b.png", "c.png"]);
  });

  it("batch-expands comfyui_workflow.outputUrls when not a video", () => {
    const nodes = [node("w", "comfyui_workflow", { outputType: "image", outputUrl: "x.png", outputUrls: ["x.png", "y.png"] })];
    expect(detectUpstreamImagesExpanded("char", [edge("w")], nodes)).toEqual(["x.png", "y.png"]);
  });

  it("skips a comfyui_workflow that produced a video", () => {
    const nodes = [node("w", "comfyui_workflow", { outputType: "video", outputUrl: "v.mp4", outputUrls: ["v.mp4"] })];
    expect(detectUpstreamImagesExpanded("char", [edge("w")], nodes)).toEqual([]);
  });

  it("asset: image only (video/audio asset excluded)", () => {
    const nodes = [
      node("img", "asset", { mimeType: "image/png", url: "i.png" }),
      node("vid", "asset", { mimeType: "video/mp4", url: "v.mp4" }),
    ];
    expect(detectUpstreamImagesExpanded("char", [edge("img"), edge("vid")], nodes)).toEqual(["i.png"]);
  });

  it("falls back to single output when there is no batch (storyboard / single image_gen)", () => {
    const nodes = [
      node("s", "storyboard", { outputUrl: "shot.png" }),
      node("g", "image_gen", { imageUrl: "one.png" }),
    ];
    expect(detectUpstreamImagesExpanded("char", [edge("s"), edge("g")], nodes).sort()).toEqual(["one.png", "shot.png"]);
  });

  it("orders by trailing number in source title, then de-dupes", () => {
    const nodes = [
      node("b", "image_gen", { imageUrl: "b.png" }, "图像2", 0),
      node("a", "image_gen", { imageUrls: ["a1.png", "a2.png", "b.png"] }, "图像1", 0),
    ];
    // 图像1 first (trailing 1 < 2); b.png appears in both → de-duped to first occurrence.
    expect(detectUpstreamImagesExpanded("char", [edge("b"), edge("a")], nodes)).toEqual(["a1.png", "a2.png", "b.png"]);
  });

  it("ignores non-image-producing upstream (e.g. video_task)", () => {
    const nodes = [node("vt", "video_task", { resultVideoUrl: "v.mp4" })];
    expect(detectUpstreamImagesExpanded("char", [edge("vt")], nodes)).toEqual([]);
  });
});
