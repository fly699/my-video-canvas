import { describe, it, expect } from "vitest";
import { isConnectionValid, getCompatibleTargets, getCompatibleSources } from "./connectionRules";

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

  it("lets a merge (合并) video feed a clip (剪辑) node", () => {
    expect(isConnectionValid("merge", "clip")).toBe(true);
    expect(isConnectionValid("merge", "asset")).toBe(true); // still allowed
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
