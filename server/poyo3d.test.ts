import { describe, it, expect } from "vitest";
import { pickGlb, parse3DStatus } from "./_core/poyo3d";

describe("pickGlb — 从 Poyo files[] 挑 glb / 缩略图", () => {
  it("按 label=model_glb 命中 glb，label=thumbnail 命中缩略图", () => {
    const files = [
      { label: "thumbnail", file_url: "https://s.poyo.ai/t.png", file_type: "image" },
      { label: "model_glb", file_url: "https://s.poyo.ai/m.glb", format: "glb" },
    ];
    expect(pickGlb(files)).toEqual({ glbUrl: "https://s.poyo.ai/m.glb", thumbnailUrl: "https://s.poyo.ai/t.png" });
  });
  it("退化到 format=glb / .glb 后缀", () => {
    expect(pickGlb([{ file_url: "https://s/x.glb?sig=1" }]).glbUrl).toBe("https://s/x.glb?sig=1");
    expect(pickGlb([{ file_url: "https://s/x.bin", format: "GLB" }]).glbUrl).toBe("https://s/x.bin");
  });
  it("无 glb 时 glbUrl 为空", () => {
    expect(pickGlb([{ file_url: "https://s/x.png", file_type: "image" }]).glbUrl).toBeUndefined();
    expect(pickGlb(undefined).glbUrl).toBeUndefined();
  });
});

describe("parse3DStatus — 状态归一化", () => {
  it("finished + model_glb → finished 带 glbUrl", () => {
    const r = parse3DStatus({ code: 200, data: { status: "finished", progress: 100, files: [{ label: "model_glb", file_url: "u.glb" }] } });
    expect(r).toMatchObject({ status: "finished", progress: 100, glbUrl: "u.glb" });
  });
  it("在途状态(running/processing/not_started) → running", () => {
    for (const s of ["running", "processing", "not_started", "queued"]) {
      expect(parse3DStatus({ code: 200, data: { status: s } }).status).toBe("running");
    }
  });
  it("failed 及任何未知状态 → failed（不永久轮询）", () => {
    expect(parse3DStatus({ code: 200, data: { status: "failed", error_message: "boom" } })).toMatchObject({ status: "failed", errorMessage: "boom" });
    expect(parse3DStatus({ code: 200, data: { status: "cancelled" } }).status).toBe("failed");
    expect(parse3DStatus({ code: 200, data: { status: "some_new_state" } }).status).toBe("failed");
  });
  it("非 0/200 的 code 抛错", () => {
    expect(() => parse3DStatus({ code: 401, message: "unauthorized", data: {} })).toThrow(/code 401/);
  });
  it("code 为 0 或 undefined 也算成功", () => {
    expect(parse3DStatus({ code: 0, data: { status: "running" } }).status).toBe("running");
    expect(parse3DStatus({ data: { status: "running" } }).status).toBe("running");
  });
});
