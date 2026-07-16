import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasStore } from "../hooks/useCanvasStore";
import { applyAgentOperations } from "./agentApply";
import type { AgentOperation } from "../../../shared/types";

// bug-hunt 批②·Finding 2：imageFirst（生图→生视频）在服务端确定性插入的 image_gen（tempId 前缀
// imgfirst_）是「结构性管线注入」。当用户把 imageFirst 打开、却又在快速设置「允许的生成节点」里没勾
// image_gen（自相矛盾但 UI 可达）时，若该注入节点被 allowedGenNodes 硬约束拦掉，其上下游两条 connect
// 会 liveIds 落空、视频节点最终零入边被孤立、用户本意的 文本→视频 连接被静默丢弃。修复：这类注入节点
// 豁免 allowedGenNodes / allowedTemplateIds 两条快捷设置硬约束。
beforeEach(() => {
  useCanvasStore.getState().resetCanvas();
  useCanvasStore.getState().setProjectId(1);
});

describe("applyAgentOperations：imageFirst 注入节点豁免 allowedGenNodes（Finding 2）", () => {
  // 模拟服务端 enforceImageFirst 后的算子：p1 → imgfirst_1(image_gen) → v1(video_task)
  const spliced = (): AgentOperation[] => [
    { op: "create", nodeType: "prompt", tempId: "p1" },
    { op: "create", nodeType: "video_task", tempId: "v1", payload: { prompt: "让画面动起来" } },
    { op: "create", nodeType: "image_gen", tempId: "imgfirst_1", payload: { prompt: "让画面动起来" } },
    { op: "connect", sourceRef: "imgfirst_1", targetRef: "v1" },
    { op: "connect", sourceRef: "p1", targetRef: "imgfirst_1" },
  ];

  it("allowedGenNodes 不含 image_gen 时，imgfirst_ 注入节点仍被创建、视频不被孤立", () => {
    const res = applyAgentOperations(spliced(), { x: 0, y: 0 }, { allowedGenNodes: ["video_task"] });
    // prompt + video_task + image_gen(imgfirst) 三个都建成，无失败
    expect(res.failures).toHaveLength(0);
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes.some((n) => n.data.nodeType === "image_gen")).toBe(true);
    const v1 = nodes.find((n) => n.data.nodeType === "video_task")!;
    const img = nodes.find((n) => n.data.nodeType === "image_gen")!;
    const edges = useCanvasStore.getState().edges;
    // 视频节点有入边（来自注入的 image_gen），管线完整、未被孤立
    expect(edges.some((e) => e.source === img.id && e.target === v1.id)).toBe(true);
    // p1 → image_gen 也接上
    const p1 = nodes.find((n) => n.data.nodeType === "prompt")!;
    expect(edges.some((e) => e.source === p1.id && e.target === img.id)).toBe(true);
  });

  it("对照：LLM 自选的（非 imgfirst_）image_gen 仍被 allowedGenNodes 正常拦截", () => {
    const ops: AgentOperation[] = [
      { op: "create", nodeType: "image_gen", tempId: "img_llm", payload: { prompt: "x" } },
      { op: "create", nodeType: "video_task", tempId: "v1", payload: { prompt: "x" } },
    ];
    const res = applyAgentOperations(ops, { x: 0, y: 0 }, { allowedGenNodes: ["video_task"] });
    expect(res.failures.some((f) => f.reason.includes("不允许使用 image_gen"))).toBe(true);
    expect(useCanvasStore.getState().nodes.some((n) => n.data.nodeType === "image_gen")).toBe(false);
  });
});
