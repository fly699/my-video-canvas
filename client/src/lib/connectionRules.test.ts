import { describe, it, expect } from "vitest";
import { isConnectionValid } from "./connectionRules";

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
});
