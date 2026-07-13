import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasStore } from "../hooks/useCanvasStore";
import { applyAgentOperations } from "./agentApply";
import type { AgentOperation } from "../../../shared/types";

// #138 快速设置「排除分镜节点」硬约束：excludeStoryboard 时 storyboard 的 create
// 直接判失败（失败原因随自愈回路喂回 LLM），其余节点不受影响；未开启时行为不变。
beforeEach(() => {
  useCanvasStore.getState().resetCanvas();
  useCanvasStore.getState().setProjectId(1);
});

describe("applyAgentOperations excludeStoryboard（#138）", () => {
  const ops = (): AgentOperation[] => [
    { op: "create", nodeType: "script", tempId: "sc" },
    { op: "create", nodeType: "storyboard", tempId: "sb" },
    { op: "create", nodeType: "prompt", tempId: "p1" },
    { op: "create", nodeType: "video_task", tempId: "v1" },
    { op: "connect", sourceRef: "p1", targetRef: "v1" },
  ];

  it("开启时拦截 storyboard create，其余照常创建与连线", () => {
    const res = applyAgentOperations(ops(), { x: 0, y: 0 }, { excludeStoryboard: true });
    expect(res.created).toBe(3); // script + prompt + video_task
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0].reason).toContain("排除分镜节点");
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes.some((n) => n.data.nodeType === "storyboard")).toBe(false);
    expect(nodes.some((n) => n.data.nodeType === "prompt")).toBe(true);
    // prompt → video_task 连线不受被拦截的分镜影响
    expect(useCanvasStore.getState().edges.length).toBe(1);
  });

  it("未开启时 storyboard 照常创建（行为不变）", () => {
    const res = applyAgentOperations(ops(), { x: 0, y: 0 });
    expect(res.created).toBe(4);
    expect(res.failures).toHaveLength(0);
    expect(useCanvasStore.getState().nodes.some((n) => n.data.nodeType === "storyboard")).toBe(true);
  });

  it("开启时既有 storyboard 的 update 不受影响（只拦 create）", () => {
    applyAgentOperations([{ op: "create", nodeType: "storyboard", tempId: "sb0" }], { x: 0, y: 0 });
    const sbId = useCanvasStore.getState().nodes.find((n) => n.data.nodeType === "storyboard")!.id;
    const res = applyAgentOperations(
      [{ op: "update", targetRef: sbId, payload: { description: "改描述" } }],
      { x: 0, y: 0 },
      { excludeStoryboard: true },
    );
    expect(res.failures).toHaveLength(0);
    const sb = useCanvasStore.getState().nodes.find((n) => n.id === sbId)!;
    expect((sb.data.payload as { description?: string }).description).toBe("改描述");
  });
});
