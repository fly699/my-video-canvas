import { describe, it, expect } from "vitest";
import { buildNodeContextContent, extractNodeText, isReferableNode, nodeContextLabel, planMessageDrop } from "./aiClientContext";
import type { NodeType } from "../../../shared/types";

const N = (id: string, nodeType: NodeType, payload: Record<string, unknown> = {}, title?: string) => ({ id, data: { nodeType, title, payload } });

describe("extractNodeText", () => {
  it("按优先级抽文本：content→description→positivePrompt→prompt→synopsis", () => {
    expect(extractNodeText({ content: "便签内容" })).toBe("便签内容");
    expect(extractNodeText({ description: "分镜描述" })).toBe("分镜描述");
    expect(extractNodeText({ positivePrompt: "正向词" })).toBe("正向词");
    expect(extractNodeText({ prompt: "提示词" })).toBe("提示词");
    expect(extractNodeText({ synopsis: "剧情梗概" })).toBe("剧情梗概");
    expect(extractNodeText({})).toBe("");
  });
  it("角色节点：抽 name/appearance/personality（此前读成空 → 引用角色无上下文）", () => {
    expect(extractNodeText({ name: "沈砚", appearance: "黑衣剑客", personality: "沉默寡言" }, "character"))
      .toBe("角色名：沈砚；外貌：黑衣剑客；性格：沉默寡言");
    // 仅有名字也够用
    expect(extractNodeText({ name: "沈砚" }, "character")).toBe("角色名：沈砚");
    // 不带 nodeType 时按老逻辑（character 字段不识别 → 空），确保没有回归其它类型
    expect(extractNodeText({ name: "沈砚" })).toBe("");
  });
});

describe("buildNodeContextContent", () => {
  const nodes = [
    N("s", "script", { synopsis: "一个赛博朋克故事" }, "剧本"),
    N("sb", "storyboard", { description: "雨夜霓虹街道" }, "镜1"),
    N("img", "image_gen", {}, "空图"),
  ];
  it("拼成 [标题]: 内容，跳过无文本节点", () => {
    const r = buildNodeContextContent(nodes, ["s", "sb", "img"]);
    expect(r).toContain("[剧本]: 一个赛博朋克故事");
    expect(r).toContain("[镜1]: 雨夜霓虹街道");
    expect(r).not.toContain("空图"); // 无文本 → 跳过
  });
  it("空引用 / 全无文本 → undefined", () => {
    expect(buildNodeContextContent(nodes, [])).toBeUndefined();
    expect(buildNodeContextContent(nodes, ["img"])).toBeUndefined();
    expect(buildNodeContextContent(nodes, undefined)).toBeUndefined();
  });
  it("去重 + 忽略不存在的 id", () => {
    const r = buildNodeContextContent(nodes, ["s", "s", "zzz"]);
    expect(r).toBe("[剧本]: 一个赛博朋克故事");
  });
  it("超 8000 截断", () => {
    const big = [N("b", "note", { content: "字".repeat(9000) }, "长便签")];
    expect(buildNodeContextContent(big, ["b"])!.length).toBeLessThanOrEqual(8000);
  });
});

describe("isReferableNode / nodeContextLabel", () => {
  it("可引用类型判定", () => {
    expect(isReferableNode(N("a", "script"))).toBe(true);
    expect(isReferableNode(N("a", "note"))).toBe(true);
    expect(isReferableNode(N("a", "group"))).toBe(false);
  });
  it("标签优先 title，否则类型", () => {
    expect(nodeContextLabel(N("a", "script", {}, "我的剧本"))).toBe("我的剧本");
    expect(nodeContextLabel(N("a", "script", {}, "  "))).toBe("script");
    expect(nodeContextLabel(N("a", "script"))).toBe("script");
  });
});

describe("planMessageDrop（回答落成画布节点）", () => {
  it("纯文本 → 便签(note)", () => {
    const p = planMessageDrop("这是一段回答");
    expect(p).toEqual([{ nodeType: "note", payload: { content: "这是一段回答" }, label: "便签" }]);
  });
  it("图片附件 → asset 图像节点（在文本之前）", () => {
    const p = planMessageDrop("看这张图", [{ type: "image", url: "http://x/a.png", name: "图A", mimeType: "image/png" }]);
    expect(p[0]).toEqual({ nodeType: "asset", payload: { type: "image", url: "http://x/a.png", name: "图A", mimeType: "image/png" }, label: "图片" });
    expect(p[1].nodeType).toBe("note");
  });
  it("file 类附件不落成；空内容 → 空计划", () => {
    expect(planMessageDrop("", [{ type: "file", url: "http://x/a.pdf" }])).toEqual([]);
    expect(planMessageDrop("   ")).toEqual([]);
  });
});
