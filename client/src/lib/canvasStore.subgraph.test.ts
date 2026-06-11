// cloneSubgraph / autoLayout 回归测试：子图复制保留内部连线、丢弃跨边界连线；
// 一键整理按连线方向分层排布自由节点。
import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasStore } from "../hooks/useCanvasStore";

type AnyNode = { id: string; type: string; position: { x: number; y: number }; data: { nodeType: string; title: string; payload: Record<string, unknown>; projectId: number } };
const node = (id: string, nodeType: string, x = 0, y = 0): AnyNode => ({
  id, type: "custom", position: { x, y }, data: { nodeType, title: id, payload: {}, projectId: 1 },
});
const edge = (id: string, source: string, target: string) => ({ id, source, target });

function seed(nodes: AnyNode[], edges: Array<{ id: string; source: string; target: string }>) {
  useCanvasStore.setState({ nodes: nodes as never, edges: edges as never, past: [], future: [], _suppressHistory: false, currentUserId: null } as never);
}

beforeEach(() => seed([], []));

describe("cloneSubgraph", () => {
  it("克隆选中节点 + 内部连线，丢弃跨边界连线，并选中克隆体", () => {
    seed(
      [node("a", "prompt"), node("b", "image_gen"), node("c", "video_task"), node("x", "asset")],
      [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "x")],
    );
    const newIds = useCanvasStore.getState().cloneSubgraph(["a", "b"], { x: 100, y: 0 });
    expect(newIds).toHaveLength(2);
    const st = useCanvasStore.getState();
    expect(st.nodes).toHaveLength(6); // 4 原 + 2 克隆
    // 内部连线 a→b 克隆了一条；b→c（跨边界）未克隆
    const cloneSet = new Set(newIds);
    const clonedEdges = st.edges.filter((e) => cloneSet.has(e.source) && cloneSet.has(e.target));
    expect(clonedEdges).toHaveLength(1);
    expect(st.edges).toHaveLength(4); // 3 原 + 1 内部克隆
    // 克隆体选中、原件取消选中
    const cloned = st.nodes.filter((n) => cloneSet.has(n.id));
    expect(cloned.every((n) => n.selected)).toBe(true);
    expect(st.nodes.find((n) => n.id === "a")?.selected).toBe(false);
    // 偏移落位
    expect(cloned[0].position.x).toBe(100);
  });
  it("空选返回空，不改画布", () => {
    seed([node("a", "prompt")], []);
    expect(useCanvasStore.getState().cloneSubgraph([])).toEqual([]);
    expect(useCanvasStore.getState().nodes).toHaveLength(1);
  });
});

describe("autoLayout", () => {
  it("按连线方向分层：链 a→b→c 排成三列", () => {
    seed([node("a", "prompt", 999, 5), node("b", "image_gen", 10, 200), node("c", "video_task", 50, 50)],
      [edge("e1", "a", "b"), edge("e2", "b", "c")]);
    const n = useCanvasStore.getState().autoLayout();
    expect(n).toBe(3);
    const st = useCanvasStore.getState();
    const px = (id: string) => st.nodes.find((x) => x.id === id)!.position.x;
    expect(px("b") - px("a")).toBe(360); // 相邻层间距 COL
    expect(px("c") - px("b")).toBe(360);
  });
  it("少于 2 个自由节点返回 0", () => {
    seed([node("a", "prompt")], []);
    expect(useCanvasStore.getState().autoLayout()).toBe(0);
  });
});
