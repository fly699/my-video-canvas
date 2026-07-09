import { describe, it, expect } from "vitest";
import { computeControlMapUpdates, resolveNodeOutputImageUrl, storedControlMap, controlnetForStoredMap } from "./refImagePropagation";
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

  it("writes structure-lock strength when provided, else preserves the downstream's own", () => {
    const nodes = [node("a", "director"), node("b", "comfyui_image", { controlnet: { model: "cn", strength: 0.5 } })];
    const withStrength = computeControlMapUpdates("a", "map.png", nodes, [edge("a", "b")], 0.9);
    expect(withStrength[0].payload.controlnet.strength).toBe(0.9);
    const without = computeControlMapUpdates("a", "map.png", nodes, [edge("a", "b")]);
    expect(without[0].payload.controlnet.strength).toBe(0.5); // 未指定时保留下游原值
  });
});

describe("storedControlMap / controlnetForStoredMap (③ 连线即注入)", () => {
  it("reads a director's persisted control map, defaulting strength to 0.85", () => {
    expect(storedControlMap(node("d", "director", { controlMap: { url: "u.png", kind: "pose", strength: 0.7 } })))
      .toEqual({ url: "u.png", strength: 0.7 });
    expect(storedControlMap(node("d", "director", { controlMap: { url: "u.png", kind: "pose" } })))
      .toEqual({ url: "u.png", strength: 0.85 });
  });
  it("ignores non-director sources and empty/absent maps", () => {
    expect(storedControlMap(node("d", "image_gen", { controlMap: { url: "u.png", kind: "pose", strength: 1 } }))).toBeUndefined();
    expect(storedControlMap(node("d", "director", { controlMap: { url: "", kind: "pose", strength: 1 } }))).toBeUndefined();
    expect(storedControlMap(node("d", "director", {}))).toBeUndefined();
    expect(storedControlMap(undefined)).toBeUndefined();
  });
  it("builds a controlnet merging the target's model, overriding image/preprocessor/strength", () => {
    const target = node("b", "comfyui_image", { controlnet: { model: "control_openpose", strength: 0.3, startPercent: 0.1 } });
    expect(controlnetForStoredMap(target, { url: "pose.png", strength: 0.85 }))
      .toMatchObject({ model: "control_openpose", startPercent: 0.1, imageUrl: "pose.png", preprocessor: "", strength: 0.85 });
  });
});
