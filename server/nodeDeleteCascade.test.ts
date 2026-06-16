import { describe, it, expect } from "vitest";
import { devUpsertNode, devDeleteNode, devUpsertEdge, devGetEdgesByProject } from "./_core/devStore";

// Regression: deleting a node must cascade-delete edges that reference it (as
// source OR target), scoped to the project. canvas_edges has no FK cascade and
// saveCanvas only upserts edges, so orphan edges would otherwise revive on reload.
describe("deleteNode 级联删除关联边（悬挂边回归）", () => {
  it("删除节点连带删除以它为 source 或 target 的边，且不误删他节点/他项目的边", () => {
    const pid = 7001;
    devUpsertNode({ id: "A", projectId: pid, type: "script" });
    devUpsertNode({ id: "B", projectId: pid, type: "storyboard" });
    devUpsertNode({ id: "C", projectId: pid, type: "video_task" });
    devUpsertEdge({ id: "eAB", projectId: pid, sourceNodeId: "A", targetNodeId: "B", sourcePort: "output", targetPort: "input" });
    devUpsertEdge({ id: "eBC", projectId: pid, sourceNodeId: "B", targetNodeId: "C", sourcePort: "output", targetPort: "input" });
    // 另一个项目里复用相同节点 id 的边，必须不受影响（projectId 隔离）
    devUpsertEdge({ id: "eOther", projectId: 7002, sourceNodeId: "B", targetNodeId: "C", sourcePort: "output", targetPort: "input" });

    devDeleteNode("B", pid);

    const remaining = devGetEdgesByProject(pid).map((e) => e.id);
    expect(remaining).toEqual([]); // eAB(以B为target) 与 eBC(以B为source) 都被级联删除
    expect(devGetEdgesByProject(7002).map((e) => e.id)).toEqual(["eOther"]); // 他项目不受影响
  });

  it("删除孤立节点（无边）不报错、不动其它边", () => {
    const pid = 7003;
    devUpsertNode({ id: "X", projectId: pid, type: "prompt" });
    devUpsertNode({ id: "Y", projectId: pid, type: "prompt" });
    devUpsertEdge({ id: "eYY", projectId: pid, sourceNodeId: "Y", targetNodeId: "Y", sourcePort: "output", targetPort: "input" });
    devDeleteNode("X", pid);
    expect(devGetEdgesByProject(pid).map((e) => e.id)).toEqual(["eYY"]);
  });
});
