import { describe, it, expect } from "vitest";
import { computeControlMapUpdates, resolveNodeOutputImageUrl } from "./refImagePropagation";
import type { CanvasNode, CanvasEdge } from "../hooks/useCanvasStore";

const node = (id: string, nodeType: string, payload: Record<string, unknown> = {}): CanvasNode =>
  ({ id, type: "x", position: { x: 0, y: 0 }, data: { nodeType, title: id, projectId: 1, payload } } as unknown as CanvasNode);
const edge = (source: string, target: string): CanvasEdge => ({ id: `${source}-${target}`, source, target } as unknown as CanvasEdge);

describe("resolveNodeOutputImageUrl — asset reference source", () => {
  it("an IMAGE asset feeds its url as a reference", () => {
    expect(resolveNodeOutputImageUrl(node("a", "asset", { type: "image", url: "/manus-storage/x.png" }))).toBe("/manus-storage/x.png");
  });
  it("a VIDEO/AUDIO asset never feeds its url as an image reference", () => {
    expect(resolveNodeOutputImageUrl(node("a", "asset", { type: "video", url: "/v.mp4" }))).toBeUndefined();
    expect(resolveNodeOutputImageUrl(node("a", "asset", { type: "audio", url: "/a.mp3" }))).toBeUndefined();
  });
  it("comfyui_workflow that produced a video is not an image reference", () => {
    expect(resolveNodeOutputImageUrl(node("a", "comfyui_workflow", { outputType: "video", outputUrl: "/v.mp4" }))).toBeUndefined();
  });
});

describe("computeControlMapUpdates", () => {
  it("writes the map into downstream comfyui_image ControlNet, preserving model and clearing preprocessor", () => {
    const nodes = [
      node("a", "comfyui_image"),
      node("b", "comfyui_image", { controlnet: { model: "control_depth.safetensors", strength: 0.8, preprocessor: "DWPreprocessor" } }),
      node("c", "comfyui_video"), // not a target
    ];
    const edges = [edge("a", "b"), edge("a", "c")];
    const out = computeControlMapUpdates("a", "map.png", nodes, edges);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("b");
    expect(out[0].payload.controlnet).toMatchObject({ model: "control_depth.safetensors", strength: 0.8, imageUrl: "map.png", preprocessor: "" });
  });

  it("defaults model to empty when the downstream node had no ControlNet yet", () => {
    const nodes = [node("a", "comfyui_image"), node("b", "comfyui_image")];
    const out = computeControlMapUpdates("a", "map.png", nodes, [edge("a", "b")]);
    expect(out[0].payload.controlnet).toEqual({ model: "", imageUrl: "map.png", preprocessor: "" });
  });

  it("returns nothing when there are no downstream comfyui_image nodes", () => {
    const nodes = [node("a", "comfyui_image"), node("b", "video_task")];
    expect(computeControlMapUpdates("a", "map.png", nodes, [edge("a", "b")])).toEqual([]);
  });
});
