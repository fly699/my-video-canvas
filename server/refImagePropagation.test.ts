import { describe, expect, it, vi } from "vitest";

// The util value-imports the client store (for propagateRefImage). Stub it so we
// can unit-test the pure functions in a node env without pulling client deps.
vi.mock("../client/src/hooks/useCanvasStore", () => ({
  useCanvasStore: { getState: () => ({ nodes: [], edges: [], batchUpdateNodeData: () => {} }) },
}));

import {
  resolveNodeOutputImageUrl,
  computeRefImageUpdates,
  isRefImageTarget,
} from "../client/src/lib/refImagePropagation";

// Minimal CanvasNode-ish factory.
function node(nodeType: string, payload: Record<string, unknown>) {
  return { id: "n", data: { nodeType, title: "", payload, projectId: 1 } } as never;
}
function edge(source: string, target: string, sourceHandle: string | null, targetHandle: string | null) {
  return { id: `${source}-${target}`, source, target, sourceHandle, targetHandle } as never;
}

describe("resolveNodeOutputImageUrl", () => {
  it("reads imageUrl for image-ish source types", () => {
    for (const t of ["image_gen", "comfyui_image", "storyboard"]) {
      expect(resolveNodeOutputImageUrl(node(t, { imageUrl: "http://x/a.png" }))).toBe("http://x/a.png");
    }
  });

  it("does NOT treat the prompt node as an image source (text-only producer)", () => {
    expect(resolveNodeOutputImageUrl(node("prompt", { imageUrl: "http://x/a.png" }))).toBeUndefined();
  });

  it("reads outputImageUrl (then outputUrl) for pose_control", () => {
    expect(resolveNodeOutputImageUrl(node("pose_control", { outputImageUrl: "http://x/p.png" }))).toBe("http://x/p.png");
    expect(resolveNodeOutputImageUrl(node("pose_control", { outputUrl: "http://x/p2.png" }))).toBe("http://x/p2.png");
  });

  it("reads comfyui_workflow image output but never a video output", () => {
    expect(resolveNodeOutputImageUrl(node("comfyui_workflow", { outputUrl: "http://x/w.png", outputType: "image" }))).toBe("http://x/w.png");
    expect(resolveNodeOutputImageUrl(node("comfyui_workflow", { outputUrls: ["http://x/w0.png"], outputType: "auto" }))).toBe("http://x/w0.png");
    expect(resolveNodeOutputImageUrl(node("comfyui_workflow", { outputUrl: "http://x/clip.mp4", outputType: "video" }))).toBeUndefined();
  });

  it("returns undefined for unknown / empty", () => {
    expect(resolveNodeOutputImageUrl(node("note", { imageUrl: "x" }))).toBeUndefined();
    expect(resolveNodeOutputImageUrl(node("storyboard", { imageUrl: "" }))).toBeUndefined();
    expect(resolveNodeOutputImageUrl(undefined)).toBeUndefined();
  });
});

describe("isRefImageTarget", () => {
  it("accepts the three ref-consuming types only", () => {
    expect(isRefImageTarget("video_task")).toBe(true);
    expect(isRefImageTarget("comfyui_video")).toBe(true);
    expect(isRefImageTarget("comfyui_image")).toBe(true);
    expect(isRefImageTarget("storyboard")).toBe(false);
    expect(isRefImageTarget("note")).toBe(false);
  });
});

describe("computeRefImageUpdates", () => {
  const url = "http://x/ref.png";
  const nodes = [
    node("storyboard", {}), // placeholder; ids set below
  ];
  // Build a small graph: source S → various targets via various handles.
  const graphNodes = [
    { id: "S", data: { nodeType: "storyboard", title: "", payload: {}, projectId: 1 } },
    { id: "V", data: { nodeType: "video_task", title: "", payload: {}, projectId: 1 } },
    { id: "CV", data: { nodeType: "comfyui_video", title: "", payload: {}, projectId: 1 } },
    { id: "N", data: { nodeType: "note", title: "", payload: {}, projectId: 1 } },
  ] as never[];
  void nodes;

  it("updates ref-accepting targets wired into ref-image-in, regardless of source handle", () => {
    const edges = [
      edge("S", "V", "image-out", "ref-image-in"),
      edge("S", "CV", "output", "ref-image-in"),
      // legacy-vertical source handle ("bottom") must still propagate
      edge("S", "CV", "bottom", "ref-image-in"),
    ];
    const updates = computeRefImageUpdates("S", url, graphNodes, edges);
    expect(updates.every((u) => u.payload.referenceImageUrl === url)).toBe(true);
    expect(new Set(updates.map((u) => u.id))).toEqual(new Set(["V", "CV"]));
  });

  it("skips wrong target handle and non-ref targets", () => {
    const edges = [
      edge("S", "V", "image-out", "prompt-in"),    // wrong target handle
      edge("S", "N", "image-out", "ref-image-in"), // target doesn't accept ref image
    ];
    expect(computeRefImageUpdates("S", url, graphNodes, edges)).toHaveLength(0);
  });
});
