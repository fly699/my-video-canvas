import { useCanvasStore } from "../hooks/useCanvasStore";
import type { NodeType, NodeData, AgentOperation } from "../../../shared/types";

// ── Apply agent-proposed operations to the canvas store ───────────────────────
// Runs every op through the SAME store actions a manual edit uses (addNode /
// updateNodeData / updateNodeTitle / onConnect / deleteNode), so the whole batch
// is undoable, persisted and broadcast to collaborators like any other change.
// `tempId`s the agent assigned to freshly-created nodes are resolved to the real
// nanoid ids so subsequent `connect` ops wire the right nodes.

export interface ApplyResult {
  created: number;
  connected: number;
  updated: number;
  deleted: number;
}

export function applyAgentOperations(ops: AgentOperation[], anchor: { x: number; y: number }): ApplyResult {
  const store = useCanvasStore.getState();
  const idMap = new Map<string, string>(); // tempId → real node id
  const resolve = (ref?: string): string | undefined => (ref ? idMap.get(ref) ?? ref : undefined);
  const res: ApplyResult = { created: 0, connected: 0, updated: 0, deleted: 0 };

  let createdIdx = 0;
  for (const op of ops) {
    try {
      if (op.op === "create" && op.nodeType) {
        // Fan created nodes out to the right of the agent node, 3 per row.
        const pos = {
          x: anchor.x + 480 + (createdIdx % 3) * 360,
          y: anchor.y + Math.floor(createdIdx / 3) * 300,
        };
        const node = store.addNode(op.nodeType as NodeType, pos);
        if (op.tempId) idMap.set(op.tempId, node.id);
        if (op.title) store.updateNodeTitle(node.id, op.title);
        if (op.payload && Object.keys(op.payload).length) {
          store.updateNodeData(node.id, op.payload as Partial<NodeData>, true);
        }
        res.created++;
        createdIdx++;
      } else if (op.op === "connect") {
        const source = resolve(op.sourceRef);
        const target = resolve(op.targetRef);
        if (source && target && source !== target) {
          store.onConnect({
            source, target,
            sourceHandle: op.sourceHandle ?? "output",
            targetHandle: op.targetHandle ?? "input",
          });
          res.connected++;
        }
      } else if (op.op === "update") {
        const target = resolve(op.targetRef);
        if (target) {
          if (op.title) store.updateNodeTitle(target, op.title);
          if (op.payload && Object.keys(op.payload).length) {
            store.updateNodeData(target, op.payload as Partial<NodeData>, true);
          }
          res.updated++;
        }
      } else if (op.op === "delete") {
        const target = resolve(op.targetRef);
        if (target) { store.deleteNode(target); res.deleted++; }
      }
    } catch { /* skip a bad op, keep applying the rest */ }
  }
  return res;
}

// ── Compact graph summary for the agent's context ─────────────────────────────
// A few headline payload fields per node type so the model knows what already
// exists (for incremental edits) without shipping the whole node data.
const SUMMARY_FIELDS: Partial<Record<NodeType, string[]>> = {
  script: ["aiGenre", "aiStyle", "aiSceneCount"],
  storyboard: ["description", "promptText"],
  prompt: ["positivePrompt"],
  image_gen: ["prompt"],
  comfyui_image: ["prompt"],
  comfyui_video: ["prompt"],
  video_task: ["prompt"],
  merge: ["transition"],
  audio: ["audioCategory"],
  note: ["content"],
};

export function buildGraphSummary(excludeNodeId: string): string {
  const { nodes, edges } = useCanvasStore.getState();
  const clip = (v: unknown) => (typeof v === "string" ? (v.length > 60 ? v.slice(0, 60) + "…" : v) : v);
  const nodeLines = nodes
    .filter((n) => n.id !== excludeNodeId)
    .map((n) => {
      const type = n.data.nodeType as NodeType;
      const fields = SUMMARY_FIELDS[type] ?? [];
      const p = (n.data.payload ?? {}) as Record<string, unknown>;
      const kv: Record<string, unknown> = {};
      for (const f of fields) if (p[f] != null && p[f] !== "") kv[f] = clip(p[f]);
      return { id: n.id, type, title: n.data.title, ...kv };
    });
  const edgeLines = edges
    .filter((e) => e.source !== excludeNodeId && e.target !== excludeNodeId)
    .map((e) => ({ from: e.source, to: e.target }));
  if (nodeLines.length === 0 && edgeLines.length === 0) return "";
  return JSON.stringify({ nodes: nodeLines, edges: edgeLines });
}
