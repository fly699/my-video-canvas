import type { NodeType } from "../../../shared/types";
import { RUNNABLE_TYPES } from "../hooks/useWorkflowRunner";
import { estimateNodesBudget, type BudgetEstimate } from "./agentBudget";

// 运行前体检（pre-flight）— a pure, side-effect-free scan of the canvas graph that
// surfaces problems which would make a run fail or produce nothing, plus a
// whole-canvas cost estimate. Kept framework-free so it's unit-testable.

export type PreflightSeverity = "error" | "warning";

export interface PreflightIssue {
  severity: PreflightSeverity;
  nodeId?: string;
  nodeTitle?: string;
  message: string;
}

export interface PreflightResult {
  issues: PreflightIssue[];
  errorCount: number;
  warningCount: number;
  runnableCount: number;
  budget: BudgetEstimate;
}

export interface PFNode {
  id: string;
  data: { nodeType: NodeType; title: string; payload?: Record<string, unknown> };
}
export interface PFEdge {
  source: string;
  target: string;
}

// Node types that consume upstream output and are useless without an input edge.
const CONSUMER_TYPES: NodeType[] = [
  "video_task", "merge", "subtitle", "overlay", "clip", "smart_cut", "subtitle_motion",
];

// Minimal "must be filled" fields per type. Deliberately conservative to avoid
// false positives on nodes the user is still editing.
const REQUIRED_FIELDS: Partial<Record<NodeType, { field: string; label: string }[]>> = {
  script: [{ field: "synopsis", label: "剧情梗概" }],
  storyboard: [{ field: "description", label: "分镜描述" }],
};

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** Detect whether the directed graph (over the given node ids) contains a cycle. */
function findCycle(nodeIds: Set<string>, edges: PFEdge[]): boolean {
  const ids = Array.from(nodeIds);
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) adj.get(e.source)!.push(e.target);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of ids) color.set(id, WHITE);
  const stack: Array<{ id: string; idx: number }> = [];
  for (const start of ids) {
    if (color.get(start) !== WHITE) continue;
    stack.push({ id: start, idx: 0 });
    color.set(start, GRAY);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const neighbors = adj.get(frame.id)!;
      if (frame.idx < neighbors.length) {
        const next = neighbors[frame.idx++];
        const c = color.get(next);
        if (c === GRAY) return true; // back-edge → cycle
        if (c === WHITE) { color.set(next, GRAY); stack.push({ id: next, idx: 0 }); }
      } else {
        color.set(frame.id, BLACK);
        stack.pop();
      }
    }
  }
  return false;
}

export function runPreflight(nodes: PFNode[], edges: PFEdge[]): PreflightResult {
  const issues: PreflightIssue[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const e of edges) {
    if (nodeIds.has(e.target)) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    if (nodeIds.has(e.source)) outgoing.set(e.source, (outgoing.get(e.source) ?? 0) + 1);
  }

  // Skip agent / note / asset-only nodes — only generation-relevant nodes matter.
  const relevant = nodes.filter((n) => n.data.nodeType !== "agent" && n.data.nodeType !== "note");

  for (const n of relevant) {
    const t = n.data.nodeType;
    const p = n.data.payload ?? {};
    const inDeg = incoming.get(n.id) ?? 0;
    const outDeg = outgoing.get(n.id) ?? 0;

    // 1) 孤立节点：既无输入也无输出，永远不会参与运行。
    if (inDeg === 0 && outDeg === 0) {
      issues.push({ severity: "warning", nodeId: n.id, nodeTitle: n.data.title, message: `「${n.data.title}」是孤立节点（没有任何连接），不会参与运行` });
    }
    // 2) 缺输入：消费型节点没有上游输入，无法生成。
    else if (CONSUMER_TYPES.includes(t) && inDeg === 0) {
      issues.push({ severity: "error", nodeId: n.id, nodeTitle: n.data.title, message: `「${n.data.title}」缺少输入连接（${t} 需要上游内容才能运行）` });
    }
    // 3) 缺参：关键字段为空。
    for (const req of REQUIRED_FIELDS[t] ?? []) {
      if (isBlank(p[req.field])) {
        issues.push({ severity: "warning", nodeId: n.id, nodeTitle: n.data.title, message: `「${n.data.title}」未填写${req.label}` });
      }
    }
  }

  // 4) 循环依赖：会导致运行死锁/无法拓扑排序。
  if (findCycle(nodeIds, edges)) {
    issues.push({ severity: "error", message: "画布中存在循环依赖（节点首尾相连成环），无法确定运行顺序" });
  }

  const runnableCount = relevant.filter((n) => RUNNABLE_TYPES.includes(n.data.nodeType)).length;
  const budget = estimateNodesBudget(relevant);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.length - errorCount;
  return { issues, errorCount, warningCount, runnableCount, budget };
}
