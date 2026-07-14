import { describe, it, expect } from "vitest";
import {
  characterLine, collectAgentUpstream, hasAgentUpstream, agentUpstreamSummary,
  buildAgentTaskContext, composeAgentTask,
} from "./superAgentUpstream";

const N = (id: string, nodeType: string, payload: Record<string, unknown> = {}, title?: string) => ({ id, data: { nodeType, payload, title } });
const E = (source: string, target: string) => ({ source, target });

describe("characterLine", () => {
  it("人物：名称 + 各设定字段拼接", () => {
    const line = characterLine(N("c", "character", { name: "苏晴", role: "女主", appearance: "黑长直", outfit: "白裙", signature: "银吊坠" }));
    expect(line).toContain("角色「苏晴」");
    expect(line).toContain("女主");
    expect(line).toContain("黑长直");
    expect(line).toContain("银吊坠");
  });
  it("场景：characterKind=scene 或有场景字段", () => {
    const line = characterLine(N("s", "character", { characterKind: "scene", sceneName: "雨夜街道", sceneDescription: "霓虹反光", atmosphere: "冷冽" }));
    expect(line).toContain("场景「雨夜街道」");
    expect(line).toContain("霓虹反光");
  });
  it("无字段回落到标题", () => {
    expect(characterLine(N("c", "character", {}, "路人甲"))).toBe("角色「路人甲」");
  });
});

describe("collectAgentUpstream", () => {
  const nodes = [
    N("sa", "super_agent", {}),
    N("p", "prompt", { positivePrompt: "赛博朋克城市", negativePrompt: "模糊" }),
    N("c1", "character", { name: "苏晴", appearance: "黑长直" }),
    N("c2", "character", { name: "阿彪", appearance: "光头" }),
    N("img", "image_gen", { imageUrl: "http://x/a.png" }),
    N("far", "prompt", { positivePrompt: "不该被收" }), // 未连入
  ];
  const edges = [E("p", "sa"), E("c1", "sa"), E("c2", "sa"), E("img", "sa")];
  it("收集上游提示词/负向/角色/参考图", () => {
    const ctx = collectAgentUpstream("sa", edges, nodes);
    expect(ctx.prompt).toBe("赛博朋克城市");
    expect(ctx.negative).toBe("模糊");
    expect(ctx.characters).toHaveLength(2);
    expect(ctx.characters[0]).toContain("苏晴");
    expect(ctx.imageUrls).toEqual(["http://x/a.png"]);
  });
  it("未连入的节点不收", () => {
    const ctx = collectAgentUpstream("sa", edges, nodes);
    expect(JSON.stringify(ctx)).not.toContain("不该被收");
  });
  it("空上游 → 全空", () => {
    const ctx = collectAgentUpstream("sa", [], nodes);
    expect(ctx.prompt).toBeUndefined();
    expect(ctx.characters).toEqual([]);
    expect(ctx.imageUrls).toEqual([]);
    expect(hasAgentUpstream(ctx)).toBe(false);
  });
});

describe("agentUpstreamSummary / hasAgentUpstream", () => {
  it("摘要列出各类上下文", () => {
    const ctx = { prompt: "x", characters: ["a", "b"], imageUrls: ["u"] };
    expect(hasAgentUpstream(ctx)).toBe(true);
    expect(agentUpstreamSummary(ctx)).toBe("提示词 · 2 个角色/场景 · 1 张参考图");
  });
});

describe("buildAgentTaskContext / composeAgentTask", () => {
  it("拼成带标签的文本块", () => {
    const block = buildAgentTaskContext({ prompt: "赛博城市", negative: "模糊", characters: ["角色「苏晴」"], imageUrls: ["http://x/a.png"] });
    expect(block).toContain("【参考提示词】赛博城市");
    expect(block).toContain("【负向提示词】模糊");
    expect(block).toContain("【角色/场景设定】");
    expect(block).toContain("【参考图】");
  });
  it("无上游 → 原样返回指令", () => {
    const ctx = { characters: [], imageUrls: [] };
    expect(composeAgentTask("搭个文生图工作流", ctx)).toBe("搭个文生图工作流");
  });
  it("有上游 → 指令后追加参考块", () => {
    const out = composeAgentTask("搭个文生图工作流", { prompt: "赛博城市", characters: [], imageUrls: [] });
    expect(out.startsWith("搭个文生图工作流")).toBe(true);
    expect(out).toContain("【参考提示词】赛博城市");
  });
});
