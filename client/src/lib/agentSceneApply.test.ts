import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasStore } from "../hooks/useCanvasStore";
import { applyAgentOperations, buildGraphSummary } from "./agentApply";
import type { AgentOperation } from "../../../shared/types";

// Phase A: when create ops carry sceneGroup, the apply layer lays each scene out
// as its own column and wraps it in an auto-created `group`「场景」container.
beforeEach(() => {
  useCanvasStore.getState().resetCanvas();
  useCanvasStore.getState().setProjectId(1);
});

describe("applyAgentOperations scene grouping", () => {
  it("creates a group box per scene and columns the shots", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "script", tempId: "sc" },
      { op: "create", nodeType: "storyboard", tempId: "s1a", sceneGroup: "s1" },
      { op: "create", nodeType: "storyboard", tempId: "s1b", sceneGroup: "s1" },
      { op: "create", nodeType: "storyboard", tempId: "s2a", sceneGroup: "s2" },
      { op: "create", nodeType: "merge", tempId: "mg" },
    ];
    const res = applyAgentOperations(ops, { x: 0, y: 0 });
    expect(res.created).toBe(5);

    const nodes = useCanvasStore.getState().nodes;
    const groups = nodes.filter((n) => n.data.nodeType === "group");
    expect(groups.length).toBe(2); // 场景1 + 场景2
    expect(groups.map((g) => g.data.title).sort()).toEqual(["场景1", "场景2"]);
    // Group boxes are sized and render behind shots.
    for (const g of groups) {
      expect((g.style as { width?: number })?.width).toBeGreaterThan(0);
      expect((g.style as { height?: number })?.height).toBeGreaterThan(0);
      expect(g.zIndex).toBe(-1);
    }

    // Scene 1's two shots share one column (same x), distinct from scene 2's column.
    const sb = nodes.filter((n) => n.data.nodeType === "storyboard");
    const xs = new Set(sb.map((n) => n.position.x));
    expect(xs.size).toBe(2); // two scene columns
  });

  it("leaves layout unchanged (no group boxes) when ops have no sceneGroup", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "storyboard", tempId: "a" },
      { op: "create", nodeType: "video_task", tempId: "b" },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 });
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes.filter((n) => n.data.nodeType === "group").length).toBe(0);
  });
});

describe("applyAgentOperations storyboard promptText backstop", () => {
  it("fills blank promptText from description on create (实测 bug：提示词框空置)", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "storyboard", tempId: "a", payload: { sceneNumber: 1, description: "雨夜街头，霓虹倒影" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 });
    const sb = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "storyboard")!;
    expect((sb.data.payload as { promptText?: string }).promptText).toBe("雨夜街头，霓虹倒影");
  });

  it("never overwrites an explicit promptText", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "storyboard", tempId: "a", payload: { description: "中文描述", promptText: "neon-lit rainy street, cinematic" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 });
    const sb = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "storyboard")!;
    expect((sb.data.payload as { promptText?: string }).promptText).toBe("neon-lit rainy street, cinematic");
  });
});

describe("buildGraphSummary failure context", () => {
  it("includes errorMessage (clipped) for failed nodes so self-heal can target the root cause", () => {
    const store = useCanvasStore.getState();
    const n = store.addNode("comfyui_image", { x: 0, y: 0 });
    store.updateNodeData(n.id, { status: "failed", errorMessage: "未配置 ComfyUI 服务器地址，请在节点中填写 customBaseUrl" });
    const long = store.addNode("video_task", { x: 0, y: 100 });
    store.updateNodeData(long.id, { status: "failed", errorMessage: "x".repeat(200) });
    const ok = store.addNode("image_gen", { x: 0, y: 200 });
    store.updateNodeData(ok.id, { status: "success", errorMessage: "陈旧的上次错误" });

    const parsed = JSON.parse(buildGraphSummary("none")) as { nodes: Array<{ id: string; status?: string; error?: string }> };
    const byId = new Map(parsed.nodes.map((x) => [x.id, x]));
    expect(byId.get(n.id)?.error).toContain("未配置 ComfyUI 服务器地址");
    expect(byId.get(long.id)?.error!.length).toBeLessThanOrEqual(161); // 160 + 省略号
    expect(byId.get(ok.id)?.error).toBeUndefined(); // 仅 failed 才带，避免陈旧错误误导
  });
});

describe("applyAgentOperations touchedIds（自愈收窄重跑范围）", () => {
  it("收集 create 新节点、update 目标与 connect 下游，并去重", () => {
    const store = useCanvasStore.getState();
    const existing = store.addNode("video_task", { x: 0, y: 0 });
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "prompt", tempId: "p1", payload: { positivePrompt: "x" } },
      { op: "update", targetRef: existing.id, payload: { prompt: "fixed" } },
      { op: "connect", sourceRef: "p1", targetRef: existing.id }, // 与 update 同目标 → 去重
    ];
    const r = applyAgentOperations(ops, { x: 0, y: 0 });
    expect(r.failures).toEqual([]);
    const created = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "prompt")!;
    expect(new Set(r.touchedIds)).toEqual(new Set([created.id, existing.id]));
    expect(r.touchedIds.length).toBe(2); // existing.id 不重复
  });
});

describe("精准增量编辑防护", () => {
  it("分级截断：小范围摘要放宽到 400 字（增量编辑可见原文全貌）", () => {
    const store = useCanvasStore.getState();
    const n = store.addNode("storyboard", { x: 0, y: 0 });
    store.updateNodeData(n.id, { promptText: "甲".repeat(200) });
    const parsed = JSON.parse(buildGraphSummary("none")) as { nodes: Array<{ id: string; promptText?: string }> };
    expect(parsed.nodes.find((x) => x.id === n.id)?.promptText).toBe("甲".repeat(200)); // 小画布不截断
  });

  it("截断回写守卫：LLM 抄回「前缀+…」时丢弃该字段保住原文", () => {
    const store = useCanvasStore.getState();
    const full = "雨夜街头" + "霓".repeat(120);
    const n = store.addNode("storyboard", { x: 0, y: 0 });
    store.updateNodeData(n.id, { promptText: full, description: "旧描述" });
    const ops: AgentOperation[] = [
      { op: "update", targetRef: n.id, payload: { promptText: full.slice(0, 60) + "…", description: "新描述" } },
    ];
    const r = applyAgentOperations(ops, { x: 0, y: 0 });
    expect(r.failures).toEqual([]);
    const p = useCanvasStore.getState().nodes.find((x) => x.id === n.id)!.data.payload as { promptText?: string; description?: string };
    expect(p.promptText).toBe(full);      // 截断回写被拦截，原文完好
    expect(p.description).toBe("新描述"); // 真实修改正常生效
  });

  it("真正以…结尾的新文本（非原文前缀）不被误拦", () => {
    const store = useCanvasStore.getState();
    const n = store.addNode("storyboard", { x: 0, y: 0 });
    store.updateNodeData(n.id, { promptText: "完全不同的旧文本" });
    const ops: AgentOperation[] = [
      { op: "update", targetRef: n.id, payload: { promptText: "崭新的提示词，意境悠远…" } },
    ];
    applyAgentOperations(ops, { x: 0, y: 0 });
    const p = useCanvasStore.getState().nodes.find((x) => x.id === n.id)!.data.payload as { promptText?: string };
    expect(p.promptText).toBe("崭新的提示词，意境悠远…");
  });
});
