import { describe, it, expect } from "vitest";
import { isConnectionValid, getCompatibleTargets, getCompatibleSources, defaultTargetHandle } from "./connectionRules";

describe("defaultTargetHandle", () => {
  it("剪辑(clip)无 input 桩：视频/素材源默认连 video-in", () => {
    expect(defaultTargetHandle("clip", "video_task")).toBe("video-in");
    expect(defaultTargetHandle("clip", "asset")).toBe("video-in");
    expect(defaultTargetHandle("clip", "comfyui_video")).toBe("video-in");
    expect(defaultTargetHandle("clip")).toBe("video-in"); // 源未知也走 video-in
  });
  it("剪辑(clip)：音频源连 audio-in", () => {
    expect(defaultTargetHandle("clip", "audio")).toBe("audio-in");
  });
  it("其它目标类型一律沿用 input", () => {
    expect(defaultTargetHandle("video_task", "image_gen")).toBe("input");
    expect(defaultTargetHandle("merge", "clip")).toBe("input");
    expect(defaultTargetHandle(undefined)).toBe("input");
  });
});

describe("isConnectionValid", () => {
  it("allows comfy nodes to chain with the SAME comfy type (串并联)", () => {
    expect(isConnectionValid("comfyui_image", "comfyui_image")).toBe(true);
    expect(isConnectionValid("comfyui_video", "comfyui_video")).toBe(true);
    expect(isConnectionValid("comfyui_workflow", "comfyui_workflow")).toBe(true);
  });

  it("allows comfy nodes to interconnect across types", () => {
    expect(isConnectionValid("comfyui_image", "comfyui_video")).toBe(true);
    expect(isConnectionValid("comfyui_image", "comfyui_workflow")).toBe(true);
    expect(isConnectionValid("comfyui_video", "comfyui_workflow")).toBe(true);
    expect(isConnectionValid("comfyui_workflow", "comfyui_image")).toBe(true);
  });

  it("still blocks same-type pairs the matrix does not list (e.g. prompt→prompt)", () => {
    expect(isConnectionValid("prompt", "prompt")).toBe(false);
    expect(isConnectionValid("storyboard", "storyboard")).toBe(false);
    expect(isConnectionValid("video_task", "video_task")).toBe(false);
  });

  it("respects matrix direction (rejects unlisted target)", () => {
    expect(isConnectionValid("clip", "comfyui_image")).toBe(false);
    expect(isConnectionValid("audio", "image_gen")).toBe(false);
  });

  it("treats null endpoints and note as always valid", () => {
    expect(isConnectionValid(null, "comfyui_image")).toBe(true);
    expect(isConnectionValid("note", "note")).toBe(true);
  });

  it("audio → merge（整片配乐）双向推导跟随矩阵：弹出菜单候选包含彼此", () => {
    expect(isConnectionValid("audio", "merge")).toBe(true);
    // 拖线落空白弹出的建节点菜单直接读这两个推导函数——矩阵更新即菜单更新
    expect(getCompatibleTargets("audio")).toContain("merge");
    expect(getCompatibleSources("merge")).toContain("audio");
  });

  it("subtitle / subtitle_motion → merge（已挂字幕视频入成片）跟随矩阵：配方 视频→字幕→合并 不再判失败", () => {
    expect(isConnectionValid("subtitle", "merge")).toBe(true);
    expect(isConnectionValid("subtitle_motion", "merge")).toBe(true);
    expect(getCompatibleTargets("subtitle")).toContain("merge");
    expect(getCompatibleSources("merge")).toContain("subtitle");
  });

  it("lets a merge (合并) video feed a clip (剪辑) node", () => {
    expect(isConnectionValid("merge", "clip")).toBe(true);
    expect(isConnectionValid("merge", "asset")).toBe(true); // still allowed
  });

  it("合并节点的「可连入」矩阵必须覆盖 MergeNode 实际消费的全部视频源类型（防再次漂移）", () => {
    // 与 MergeNode.tsx 的 VIDEO_SOURCE_TYPES 保持一致——任一类型缺失都会让该视频源
    // 无法拖线/被智能体建线连入合并节点（曾缺 overlay→merge、merge→merge）。
    const MERGE_VIDEO_SOURCES = [
      "video_task", "clip", "merge", "overlay", "asset",
      "subtitle", "subtitle_motion", "smart_cut", "comfyui_video", "comfyui_workflow",
    ] as const;
    for (const src of MERGE_VIDEO_SOURCES) {
      expect(isConnectionValid(src, "merge"), `${src}→merge 应允许`).toBe(true);
      expect(getCompatibleSources("merge"), `merge 可连入来源应含 ${src}`).toContain(src);
    }
    // 音频作整片配乐也必须能连入
    expect(isConnectionValid("audio", "merge")).toBe(true);
  });

  it("lets image producers feed a character (角色) node as a reference image", () => {
    expect(isConnectionValid("asset", "character")).toBe(true);
    expect(isConnectionValid("image_gen", "character")).toBe(true);
    expect(isConnectionValid("comfyui_image", "character")).toBe(true);
    expect(isConnectionValid("comfyui_workflow", "character")).toBe(true);
    // video producers must NOT feed a character image reference
    expect(isConnectionValid("video_task", "character")).toBe(false);
    expect(isConnectionValid("comfyui_video", "character")).toBe(false);
  });
});
