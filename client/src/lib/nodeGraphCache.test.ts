// #323 性能批①：按数组引用缓存的画布索引——与原直写等价（同输入同输出、引用透传），
// 数组引用不变时命中缓存（zustand 从不原地突变，这是缓存正确性的前提，单测锁死契约）。
import { describe, it, expect } from "vitest";
import {
  nodeById, anyMultiSelected, hasDualTargetInputs, hasOutgoingEdge,
  ownerAgentBadgeKey, upstreamPromptCached, effectiveCharactersCached,
} from "./nodeGraphCache";
import { detectUpstreamPrompt } from "./comfyWorkflowParams";
import { effectiveCharacters } from "./characterConditioning";
import { agentBadge } from "./agentOwnership";

const N = (id: string, nodeType = "note", payload: Record<string, unknown> = {}, selected = false) =>
  ({ id, selected, position: { x: 0, y: 0 }, data: { nodeType, payload } });

describe("#323 nodeById", () => {
  it("与 nodes.find 等价，且返回原对象引用", () => {
    const nodes = [N("a"), N("b"), N("c")];
    expect(nodeById(nodes, "b")).toBe(nodes[1]);
    expect(nodeById(nodes, "x")).toBeUndefined();
  });
  it("按引用缓存：同数组重复查询命中缓存（原地突变不刷新——store 铁律不突变）", () => {
    const nodes = [N("a")];
    expect(nodeById(nodes, "a")).toBe(nodes[0]);
    nodes.push(N("late")); // 原地突变（违反 store 契约的写法）——缓存按引用命中，不看见新元素
    expect(nodeById(nodes, "late")).toBeUndefined();
    const fresh = [...nodes]; // 新引用 → 重建索引
    expect(nodeById(fresh, "late")).toBe(fresh[1]);
  });
});

describe("#323 anyMultiSelected", () => {
  it("0/1 选中为 false，≥2 为 true", () => {
    expect(anyMultiSelected([N("a"), N("b")])).toBe(false);
    expect(anyMultiSelected([N("a", "note", {}, true), N("b")])).toBe(false);
    expect(anyMultiSelected([N("a", "note", {}, true), N("b", "note", {}, true), N("c")])).toBe(true);
  });
});

describe("#323 边索引", () => {
  const edges = [
    { source: "s1", target: "t1", targetHandle: "input" },
    { source: "s2", target: "t1", targetHandle: "top" },
    { source: "s3", target: "t2", targetHandle: "input" },
    { source: "t1", target: "t3" },
  ];
  it("hasDualTargetInputs：input+top 双入边才 true", () => {
    expect(hasDualTargetInputs(edges, "t1")).toBe(true);
    expect(hasDualTargetInputs(edges, "t2")).toBe(false);
    expect(hasDualTargetInputs(edges, "t3")).toBe(false);
  });
  it("hasOutgoingEdge：有任意出边为 true", () => {
    expect(hasOutgoingEdge(edges, "s1")).toBe(true);
    expect(hasOutgoingEdge(edges, "t1")).toBe(true);
    expect(hasOutgoingEdge(edges, "t3")).toBe(false);
  });
});

describe("#323 ownerAgentBadgeKey", () => {
  const nodes = [N("ag1", "agent"), N("ag2", "agent"), N("v1", "video_task")];
  it("与 agentBadge 直调组合等价", () => {
    const b = agentBadge("ag2", nodes);
    expect(ownerAgentBadgeKey(nodes, "ag2")).toBe(`${b.color}|${b.index}`);
  });
  it("非 agent / 不存在 / 非字符串 → null", () => {
    expect(ownerAgentBadgeKey(nodes, "v1")).toBeNull();
    expect(ownerAgentBadgeKey(nodes, "ghost")).toBeNull();
    expect(ownerAgentBadgeKey(nodes, undefined)).toBeNull();
    expect(ownerAgentBadgeKey(nodes, 42)).toBeNull();
  });
});

describe("#323 upstreamPromptCached / effectiveCharactersCached", () => {
  const nodes = [
    N("p1", "prompt", { positivePrompt: "sunrise cat", negativePrompt: "blurry" }),
    N("v1", "video_task", {}),
    N("c1", "character", { name: "小明", appearance: "红衣" }),
  ];
  const edges = [
    { source: "p1", target: "v1", targetHandle: "input" },
    { source: "c1", target: "v1", targetHandle: "input" },
  ];
  it("结果与直调逐字段一致", () => {
    const direct = detectUpstreamPrompt("v1", edges, nodes as never);
    const cached = upstreamPromptCached("v1", edges, nodes as never);
    expect(cached).toEqual(direct);
    expect(cached.positive).toBe("sunrise cat");
    const dc = effectiveCharacters("v1", "", edges, nodes as never);
    const cc = effectiveCharactersCached("v1", "", edges, nodes as never);
    expect(cc).toEqual(dc);
    expect(cc.length).toBe(1);
  });
  it("同 (nodes, edges) 引用下命中缓存（返回同一对象）；换引用后重算", () => {
    const r1 = upstreamPromptCached("v1", edges, nodes as never);
    const r2 = upstreamPromptCached("v1", edges, nodes as never);
    expect(r2).toBe(r1); // 直调每次都是新对象，缓存命中才会同引用
    const nodes2 = [...nodes];
    const r3 = upstreamPromptCached("v1", edges, nodes2 as never);
    expect(r3).not.toBe(r1);
    expect(r3).toEqual(r1);
  });
  it("effectiveCharactersCached 的缓存键含 prompt：@提及不同不串台", () => {
    const a = effectiveCharactersCached("v1", "", edges, nodes as never);
    const b = effectiveCharactersCached("v1", "@小明", edges, nodes as never);
    expect(effectiveCharactersCached("v1", "", edges, nodes as never)).toBe(a);
    expect(b).not.toBe(a);
  });
});
