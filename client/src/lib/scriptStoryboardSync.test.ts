import { describe, it, expect } from "vitest";
import { hashContent, hasDownstreamStoryboard, isStoryboardStale } from "./scriptStoryboardSync";

describe("hashContent", () => {
  it("同输入稳定", () => {
    expect(hashContent("hello world")).toBe(hashContent("hello world"));
  });
  it("不同输入不同 hash", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
    expect(hashContent("剧本第一版")).not.toBe(hashContent("剧本第二版"));
  });
  it("空串有稳定 hash", () => {
    expect(typeof hashContent("")).toBe("string");
  });
});

describe("hasDownstreamStoryboard", () => {
  const nodes = [
    { id: "s1", data: { nodeType: "script" } },
    { id: "sb1", data: { nodeType: "storyboard" } },
    { id: "ci1", data: { nodeType: "comfyui_image" } },
    { id: "n1", data: { nodeType: "note" } },
  ];
  it("有下游 storyboard → true", () => {
    expect(hasDownstreamStoryboard("s1", nodes, [{ source: "s1", target: "sb1" }])).toBe(true);
  });
  it("有下游 comfyui_image → true", () => {
    expect(hasDownstreamStoryboard("s1", nodes, [{ source: "s1", target: "ci1" }])).toBe(true);
  });
  it("只连到便签 → false", () => {
    expect(hasDownstreamStoryboard("s1", nodes, [{ source: "s1", target: "n1" }])).toBe(false);
  });
  it("无连线 → false", () => {
    expect(hasDownstreamStoryboard("s1", nodes, [])).toBe(false);
  });
  it("反向连线不算下游", () => {
    expect(hasDownstreamStoryboard("s1", nodes, [{ source: "sb1", target: "s1" }])).toBe(false);
  });
});

describe("isStoryboardStale", () => {
  it("无下游分镜 → false", () => {
    expect(isStoryboardStale({ content: "x", lastStoryboardContentHash: hashContent("y") }, false)).toBe(false);
  });
  it("从未记录基线 → false（不误报存量节点）", () => {
    expect(isStoryboardStale({ content: "x" }, true)).toBe(false);
  });
  it("内容未变 → false", () => {
    const c = "剧本内容";
    expect(isStoryboardStale({ content: c, lastStoryboardContentHash: hashContent(c) }, true)).toBe(false);
  });
  it("内容已变 → true", () => {
    expect(isStoryboardStale({ content: "新内容", lastStoryboardContentHash: hashContent("旧内容") }, true)).toBe(true);
  });
});
