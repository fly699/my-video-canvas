import { describe, it, expect } from "vitest";
import { parseTagResult, readAssetAiMeta, assetMatchesQuery } from "./assetMeta";

describe("parseTagResult", () => {
  it("解析裸 JSON 与 ```json 围栏", () => {
    expect(parseTagResult('{"tags":["赛博朋克","夜景"],"desc":"雨夜霓虹街道"}')).toEqual({ tags: ["赛博朋克", "夜景"], desc: "雨夜霓虹街道" });
    expect(parseTagResult('```json\n{"tags":["cat"],"desc":"a cat"}\n```')).toEqual({ tags: ["cat"], desc: "a cat" });
  });
  it("容忍前后解释文字；tags 去重限量限长", () => {
    const r = parseTagResult('好的，结果如下：{"tags":["a","a","' + "很长的标签超过十六个字符要被截断啦".repeat(2) + '","b"],"desc":"d"} 完毕');
    expect(r?.tags[0]).toBe("a");
    expect(r?.tags.length).toBe(3);
    expect(r?.tags.every((t) => t.length <= 16)).toBe(true);
  });
  it("全空 / 非 JSON → null", () => {
    expect(parseTagResult('{"tags":[],"desc":""}')).toBeNull();
    expect(parseTagResult("这不是 JSON")).toBeNull();
  });
});

describe("readAssetAiMeta", () => {
  it("未知形状安全读取", () => {
    expect(readAssetAiMeta(null)).toEqual({});
    expect(readAssetAiMeta({ aiTags: ["x", 1], aiDesc: "d", taggedAt: 5 })).toEqual({ aiTags: ["x", "1"], aiDesc: "d", aiModel: undefined, taggedAt: 5 });
  });
});

describe("assetMatchesQuery", () => {
  const a = { name: "IMG_0042.png", meta: { aiTags: ["赛博朋克", "夜景城市"], aiDesc: "雨夜霓虹街道上的机车骑手" } };
  it("命中文件名 / AI 标签 / 描述（忽略大小写）", () => {
    expect(assetMatchesQuery(a, "img_0042")).toBe(true);
    expect(assetMatchesQuery(a, "赛博朋克")).toBe(true);
    expect(assetMatchesQuery(a, "机车")).toBe(true);
  });
  it("多词 AND 语义；未命中为 false；空查询恒 true", () => {
    expect(assetMatchesQuery(a, "夜景 机车")).toBe(true);
    expect(assetMatchesQuery(a, "夜景 恐龙")).toBe(false);
    expect(assetMatchesQuery(a, "  ")).toBe(true);
  });
  it("无 meta 时退化为纯文件名匹配", () => {
    expect(assetMatchesQuery({ name: "demo.mp4" }, "demo")).toBe(true);
    expect(assetMatchesQuery({ name: "demo.mp4" }, "夜景")).toBe(false);
  });
});
