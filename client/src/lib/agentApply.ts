import { useCanvasStore } from "../hooks/useCanvasStore";
import type { NodeType, NodeData, AgentOperation, WorkflowParamBinding } from "../../../shared/types";

/** Library template shape (subset of comfyTemplates.list output) used to
 *  materialize an agent-proposed comfyui_workflow node from a templateId. */
export interface AgentTemplate { id: number; label: string; payload: Record<string, unknown> }

/** Build a comfyui_workflow node payload from a template, writing the agent's
 *  prompts into the template's positive/negative role params. */
function materializeTemplate(tpl: AgentTemplate, prompt: string, negPrompt: string): Record<string, unknown> {
  const base: Record<string, unknown> = { ...tpl.payload, templateId: tpl.id, templateLabel: tpl.label };
  const bindings = (base.paramBindings as WorkflowParamBinding[] | undefined) ?? [];
  const paramValues: Record<string, unknown> = { ...((base.paramValues as Record<string, unknown>) ?? {}) };
  for (const b of bindings) {
    const key = `${b.nodeId}.${b.fieldPath}`;
    if (b.role === "positive" && prompt) paramValues[key] = prompt;
    if (b.role === "negative" && negPrompt) paramValues[key] = negPrompt;
  }
  base.paramValues = paramValues;
  return base;
}

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
  failures: { index: number; op: string; reason: string }[];
}

export function applyAgentOperations(
  ops: AgentOperation[],
  anchor: { x: number; y: number },
  opts: { templates?: AgentTemplate[] } = {},
): ApplyResult {
  const store = useCanvasStore.getState();
  const idMap = new Map<string, string>(); // tempId → real node id
  const resolve = (ref?: string): string | undefined => (ref ? idMap.get(ref) ?? ref : undefined);
  const res: ApplyResult = { created: 0, connected: 0, updated: 0, deleted: 0, failures: [] };
  const fail = (index: number, op: AgentOperation, reason: string) => {
    op.status = "failed"; op.error = reason;
    res.failures.push({ index, op: op.op, reason });
  };

  // Whole plan = one undo step.
  store.runBatch(() => {
    let createdIdx = 0;
    ops.forEach((op, index) => {
      try {
        if (op.op === "create") {
          if (!op.nodeType) { fail(index, op, "缺少 nodeType"); return; }
          // comfyui_workflow with a templateId → materialize from the library.
          let payload = op.payload as Record<string, unknown> | undefined;
          if (op.nodeType === "comfyui_workflow" && payload?.templateId != null) {
            const tpl = opts.templates?.find((t) => t.id === Number(payload!.templateId));
            if (!tpl) { fail(index, op, `未找到模板 id=${String(payload.templateId)}`); return; }
            payload = materializeTemplate(tpl, String(payload.prompt ?? ""), String(payload.negPrompt ?? ""));
          }
          // Fan created nodes out to the right of the agent node, 3 per row.
          const pos = {
            x: anchor.x + 480 + (createdIdx % 3) * 360,
            y: anchor.y + Math.floor(createdIdx / 3) * 300,
          };
          const node = store.addNode(op.nodeType as NodeType, pos);
          if (op.tempId) idMap.set(op.tempId, node.id);
          if (op.title) store.updateNodeTitle(node.id, op.title);
          if (payload && Object.keys(payload).length) {
            store.updateNodeData(node.id, payload as Partial<NodeData>, true);
          }
          op.status = "applied";
          res.created++;
          createdIdx++;
        } else if (op.op === "connect") {
          const source = resolve(op.sourceRef);
          const target = resolve(op.targetRef);
          if (!source || !target) { fail(index, op, `连接的节点未找到（${op.sourceRef}→${op.targetRef}）`); return; }
          if (source === target) { fail(index, op, "不能连接到自身"); return; }
          store.onConnect({ source, target, sourceHandle: op.sourceHandle ?? "output", targetHandle: op.targetHandle ?? "input" });
          op.status = "applied";
          res.connected++;
        } else if (op.op === "update") {
          const target = resolve(op.targetRef);
          if (!target) { fail(index, op, `要更新的节点未找到（${op.targetRef}）`); return; }
          if (op.title) store.updateNodeTitle(target, op.title);
          if (op.payload && Object.keys(op.payload).length) {
            store.updateNodeData(target, op.payload as Partial<NodeData>, true);
          }
          op.status = "applied";
          res.updated++;
        } else if (op.op === "delete") {
          const target = resolve(op.targetRef);
          if (!target) { fail(index, op, `要删除的节点未找到（${op.targetRef}）`); return; }
          store.deleteNode(target);
          op.status = "applied";
          res.deleted++;
        }
      } catch (e) {
        fail(index, op, e instanceof Error ? e.message : String(e));
      }
    });
  });
  return res;
}

// ── Compact graph summary for the agent's context ─────────────────────────────
// A few headline payload fields per node type so the model knows what already
// exists (for incremental edits) without shipping the whole node data.
const SUMMARY_FIELDS: Partial<Record<NodeType, string[]>> = {
  script: ["aiGenre", "aiStyle", "aiMood", "aiSceneCount", "aiTargetModel", "synopsis"],
  storyboard: ["description", "promptText", "negativePrompt", "cameraMovement", "duration"],
  prompt: ["positivePrompt", "negativePrompt", "style", "aspectRatio"],
  image_gen: ["prompt", "negativePrompt", "model", "aspectRatio"],
  comfyui_image: ["prompt", "negPrompt", "templateId"],
  comfyui_video: ["prompt", "negPrompt", "templateId"],
  comfyui_workflow: ["templateLabel", "templateId"],
  video_task: ["prompt", "provider"],
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
      // Surface generation status so the agent knows what's done/failed.
      if (typeof p.status === "string" && p.status !== "idle") kv.status = p.status;
      return { id: n.id, type, title: n.data.title, ...kv };
    });
  const edgeLines = edges
    .filter((e) => e.source !== excludeNodeId && e.target !== excludeNodeId)
    .map((e) => {
      const o: Record<string, unknown> = { from: e.source, to: e.target };
      if (e.sourceHandle && e.sourceHandle !== "output") o.fromHandle = e.sourceHandle;
      if (e.targetHandle && e.targetHandle !== "input") o.toHandle = e.targetHandle;
      return o;
    });
  if (nodeLines.length === 0 && edgeLines.length === 0) return "";
  const json = JSON.stringify({ nodes: nodeLines, edges: edgeLines });
  // Hard cap to stay well under the chat input's 20000-char graphSummary limit.
  return json.length > 18000 ? json.slice(0, 18000) : json;
}
