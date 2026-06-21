import { describe, it, expect } from "vitest";
import {
  effectiveTargetHandle, isRefImageSource, isRefImageTarget, resolveNodeOutputImageUrl,
} from "./refImagePropagation";
import type { CanvasNode } from "../hooks/useCanvasStore";

// Minimal CanvasNode mock — effectiveTargetHandle only reads data.nodeType + data.payload.
const node = (nodeType: string, payload: Record<string, unknown> = {}): CanvasNode =>
  ({ id: "n", type: "custom", position: { x: 0, y: 0 }, data: { nodeType, title: "", payload } } as unknown as CanvasNode);

describe("effectiveTargetHandle — 参考图连线落点规正（bug：连到下方 input 句柄不载入参考图）", () => {
  it("图像源(已出图) → 视频：落在 input 也规正到 ref-image-in", () => {
    expect(effectiveTargetHandle("input", node("image_gen", { imageUrl: "http://x/i.png" }), node("video_task"))).toBe("ref-image-in");
  });

  it("分镜源(connect-first，尚未出图) → 视频：按类型规正到 ref-image-in", () => {
    expect(effectiveTargetHandle("input", node("storyboard"), node("video_task"))).toBe("ref-image-in");
  });

  it("提示词(无图源) → 视频：保持原句柄 input（不误判为参考图，提示词另走 input）", () => {
    expect(effectiveTargetHandle("input", node("prompt", { prompt: "hi" }), node("video_task"))).toBe("input");
  });

  it("已落在 ref-image-in：原样返回", () => {
    expect(effectiveTargetHandle("ref-image-in", node("image_gen", { imageUrl: "u" }), node("comfyui_video"))).toBe("ref-image-in");
  });

  it("目标不接受参考图（clip）：保持原句柄 video-in", () => {
    expect(effectiveTargetHandle("video-in", node("image_gen", { imageUrl: "u" }), node("clip"))).toBe("video-in");
  });

  it("图像 asset → 视频：当前已是图像 URL，规正到 ref-image-in", () => {
    expect(effectiveTargetHandle("input", node("asset", { type: "image", url: "i.png" }), node("video_task"))).toBe("ref-image-in");
  });

  it("图像编辑(image_edit) → 视频：落在 input 也规正到 ref-image-in（连线参考图生效）", () => {
    // image_edit 是合法图源(CONNECTION_MATRIX.image_edit 含 video_task)，结果图在 p.outputUrl
    expect(effectiveTargetHandle("input", node("image_edit", { outputUrl: "http://x/e.png" }), node("video_task"))).toBe("ref-image-in");
    // connect-first(尚未出图)也应按类型规正
    expect(effectiveTargetHandle("input", node("image_edit"), node("comfyui_video"))).toBe("ref-image-in");
  });

  it("视频 asset(无图) → 视频：不按类型规正，保持 input（避免把视频误当参考图）", () => {
    // asset 不在 REF_SOURCE_TYPES，且视频 asset 的 resolveNodeOutputImageUrl 为 undefined → 不规正
    expect(resolveNodeOutputImageUrl(node("asset", { type: "video", url: "v.mp4" }))).toBeUndefined();
    expect(effectiveTargetHandle("input", node("asset", { type: "video", url: "v.mp4" }), node("video_task"))).toBe("input");
  });

  it("null 句柄（默认落点）+ 图像源 → 视频：规正到 ref-image-in", () => {
    expect(effectiveTargetHandle(null, node("image_gen", { imageUrl: "u" }), node("comfyui_image"))).toBe("ref-image-in");
  });
});

describe("isRefImageSource / isRefImageTarget 覆盖", () => {
  it("始终产图的源类型（用于 connect-first 按类型规正）", () => {
    for (const t of ["image_gen", "comfyui_image", "storyboard", "pose_control", "post_process", "image_edit"]) expect(isRefImageSource(t)).toBe(true);
    // image_edit 结果图取自 p.outputUrl（与 BaseNode.resultImageUrl 同口径）
    expect(resolveNodeOutputImageUrl(node("image_edit", { outputUrl: "e.png" }))).toBe("e.png");
    // 含视频可能性的 asset / comfyui_workflow 不按类型规正（仅当前有图 URL 时规正）
    expect(isRefImageSource("asset")).toBe(false);
    expect(isRefImageSource("comfyui_workflow")).toBe(false);
    expect(isRefImageSource("prompt")).toBe(false);
  });
  it("接受参考图的目标类型", () => {
    for (const t of ["video_task", "comfyui_video", "comfyui_image"]) expect(isRefImageTarget(t)).toBe(true);
    expect(isRefImageTarget("clip")).toBe(false);
    expect(isRefImageTarget("prompt")).toBe(false);
  });
});
