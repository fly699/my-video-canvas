import { useCanvasStore } from "../hooks/useCanvasStore";
import { isConnectionValid } from "./connectionRules";
import type { NodeType, NodeData, AgentOperation, WorkflowParamBinding } from "../../../shared/types";

/** Library template shape (subset of comfyTemplates.list output) used to
 *  materialize an agent-proposed comfyui_workflow node from a templateId. */
export interface AgentTemplate { id: number; label: string; payload: Record<string, unknown> }

/** Build a comfyui_workflow node payload from a template, writing the agent's
 *  prompts into the template's positive/negative role params.
 *  （也被镜头表「批量生成视频 · ComfyUI 模板」复用来物化逐镜工位。） */
export function materializeTemplate(tpl: AgentTemplate, prompt: string, negPrompt: string): Record<string, unknown> {
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

const COMFY_NODE_TYPES = new Set<string>(["comfyui_image", "comfyui_video", "comfyui_workflow"]);

/** Assign chosen ComfyUI server URLs onto a batch's comfy create ops (in place),
 *  spreading load by round-robin (顺序) or random. No-op when chosen is empty. */
export function distributeServers(ops: AgentOperation[], chosen: string[], strategy: "round" | "random"): void {
  if (chosen.length === 0) return;
  let i = 0;
  for (const o of ops) {
    if (o.op !== "create" || !o.nodeType || !COMFY_NODE_TYPES.has(o.nodeType)) continue;
    const url = strategy === "random" ? chosen[Math.floor(Math.random() * chosen.length)] : chosen[i % chosen.length];
    o.payload = { ...(o.payload ?? {}), customBaseUrl: url };
    i++;
  }
}

/** When enabled, set freeVramAfterRun=true on every comfy create op's payload, so
 *  the agent's planned ComfyUI nodes free VRAM after each run. Pure / in place. */
export function injectFreeVramIntoOps(ops: AgentOperation[], enabled: boolean): AgentOperation[] {
  if (!enabled) return ops;
  for (const o of ops) {
    if (o.op !== "create" || !o.nodeType || !COMFY_NODE_TYPES.has(o.nodeType)) continue;
    o.payload = { ...(o.payload ?? {}), freeVramAfterRun: true };
  }
  return ops;
}

export function applyAgentOperations(
  ops: AgentOperation[],
  anchor: { x: number; y: number },
  opts: { templates?: AgentTemplate[]; freeVramAfterRun?: boolean; ownerAgentId?: string } = {},
): ApplyResult {
  injectFreeVramIntoOps(ops, opts.freeVramAfterRun === true);
  const store = useCanvasStore.getState();
  const idMap = new Map<string, string>(); // tempId → real node id
  const resolve = (ref?: string): string | undefined => (ref ? idMap.get(ref) ?? ref : undefined);
  // Track live node ids (existing + created this batch) and their types so connect
  // ops can be validated — otherwise a connect to a hallucinated/uncreated ref
  // would create a dangling edge, and an illegal pairing would bypass the rules.
  const liveIds = new Set(store.nodes.map((n) => n.id));
  const typeById = new Map<string, NodeType>(store.nodes.map((n) => [n.id, n.data.nodeType as NodeType]));
  const res: ApplyResult = { created: 0, connected: 0, updated: 0, deleted: 0, failures: [] };
  const fail = (index: number, op: AgentOperation, reason: string) => {
    op.status = "failed"; op.error = reason;
    res.failures.push({ index, op: op.op, reason });
  };

  // ── Scene-aware layout planning ──────────────────────────────────────────
  // When create ops carry `sceneGroup` (duration-aware scene planning), lay each
  // scene out as its own vertical column and wrap it in a `group` "场景" box.
  // Otherwise fall back to the original 3-per-row fan-out (unchanged behavior).
  // Generous spacing so connection edges stay visible between (often tall) nodes —
  // node ≈340w and image/video nodes run 400–600px tall, so columns/rows need room.
  const SCENE_COL_W = 560, ROW_H = 480, PAD = 40, HEADER = 48, NODE_W = 340;
  const createOps = ops.filter((o) => o.op === "create");
  const sceneKeys: string[] = [];
  for (const o of createOps) {
    const k = o.sceneGroup?.trim();
    if (k && !sceneKeys.includes(k)) sceneKeys.push(k);
  }
  const useScenes = sceneKeys.length > 0;
  const posByOp = new Map<AgentOperation, { x: number; y: number }>();
  const sceneBoxes: { x: number; y: number; width: number; height: number; title: string }[] = [];
  if (useScenes) {
    sceneKeys.forEach((key, sIdx) => {
      const sceneOps = createOps.filter((o) => o.sceneGroup?.trim() === key);
      const baseX = anchor.x + 560 + sIdx * (SCENE_COL_W + PAD);
      sceneOps.forEach((o, i) => posByOp.set(o, { x: baseX + PAD, y: anchor.y + HEADER + i * ROW_H }));
      sceneBoxes.push({ x: baseX, y: anchor.y, width: NODE_W + PAD * 2, height: HEADER + sceneOps.length * ROW_H, title: `场景${sIdx + 1}` });
    });
    // Scene-less create ops (e.g. shared script / merge) go in a trailing column.
    const tailX = anchor.x + 560 + sceneKeys.length * (SCENE_COL_W + PAD);
    let tailIdx = 0;
    for (const o of createOps) {
      if (!o.sceneGroup?.trim()) { posByOp.set(o, { x: tailX, y: anchor.y + HEADER + tailIdx * ROW_H }); tailIdx++; }
    }
  }

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
            // Guard: only comfyui_workflow templates carry a workflowJson. Referencing
            // a comfyui_image/video template id here would produce an empty workflow
            // node (no params/model) — fail clearly instead of creating a blank node.
            if (!tpl.payload || typeof tpl.payload.workflowJson !== "string" || !(tpl.payload.workflowJson as string).trim()) {
              fail(index, op, `模板「${tpl.label}」(id=${tpl.id}) 不是工作流模板（无 workflowJson），无法作为 comfyui_workflow 节点`);
              return;
            }
            // Preserve client-side overrides (set before apply) — materializeTemplate
            // rebuilds payload from the template and would otherwise drop them.
            const serverOverride = typeof payload.customBaseUrl === "string" ? payload.customBaseUrl : undefined;
            const freeVramOverride = payload.freeVramAfterRun === true;
            payload = materializeTemplate(tpl, String(payload.prompt ?? ""), String(payload.negPrompt ?? ""));
            if (serverOverride) payload.customBaseUrl = serverOverride;
            if (freeVramOverride) payload.freeVramAfterRun = true;
          }
          // 分镜兜底（实测 bug）：LLM/配方常把生成提示词整段写进 description（场景描述框），
          // promptText（提示词框）留空。批量生产本就按 promptText||description 回退——这里
          // 在创建时把回退显式化：promptText 为空则补 description，提示词框不再空置。
          // 仅创建时填空，绝不覆盖 LLM 已分别给出的两个字段。
          if (op.nodeType === "storyboard" && payload) {
            const d = typeof payload.description === "string" ? payload.description.trim() : "";
            const pt = typeof payload.promptText === "string" ? payload.promptText.trim() : "";
            if (!pt && d) payload = { ...payload, promptText: d };
          }
          // Scene layout when planned, else fan out 3 per row to the agent's right.
          const pos = posByOp.get(op) ?? {
            x: anchor.x + 560 + (createdIdx % 3) * 540,
            y: anchor.y + Math.floor(createdIdx / 3) * 480,
          };
          const node = store.addNode(op.nodeType as NodeType, pos);
          if (op.tempId) idMap.set(op.tempId, node.id);
          liveIds.add(node.id);
          typeById.set(node.id, op.nodeType as NodeType);
          if (op.title) store.updateNodeTitle(node.id, op.title);
          // Stamp ownership (multi-agent) + scene membership (so a Character can
          // "应用到本场景所有镜头"). Both stored in payload like `createdBy`.
          const ownedPayload = {
            ...(payload ?? {}),
            ...(opts.ownerAgentId ? { ownerAgentId: opts.ownerAgentId } : {}),
            ...(op.sceneGroup?.trim() ? { sceneGroup: op.sceneGroup.trim() } : {}),
          };
          if (Object.keys(ownedPayload).length) {
            store.updateNodeData(node.id, ownedPayload as Partial<NodeData>, true);
          }
          op.status = "applied";
          res.created++;
          createdIdx++;
        } else if (op.op === "connect") {
          const source = resolve(op.sourceRef);
          const target = resolve(op.targetRef);
          if (!source || !target) { fail(index, op, `连接的节点未找到（${op.sourceRef}→${op.targetRef}）`); return; }
          if (source === target) { fail(index, op, "不能连接到自身"); return; }
          // The refs must resolve to REAL nodes (existing or created this batch) —
          // a hallucinated/uncreated ref otherwise becomes a dangling edge.
          if (!liveIds.has(source) || !liveIds.has(target)) { fail(index, op, `连接引用了不存在的节点（${op.sourceRef}→${op.targetRef}）`); return; }
          // Enforce the same connection rules as the manual UI so the agent can't
          // build illegal pairings (e.g. merge → script).
          const st = typeById.get(source), tt = typeById.get(target);
          if (st && tt && !isConnectionValid(st, tt)) { fail(index, op, `不允许的连接：${st} → ${tt}`); return; }
          store.onConnect({ source, target, sourceHandle: op.sourceHandle ?? "output", targetHandle: op.targetHandle ?? "input" });
          op.status = "applied";
          res.connected++;
        } else if (op.op === "update") {
          const target = resolve(op.targetRef);
          if (!target) { fail(index, op, `要更新的节点未找到（${op.targetRef}）`); return; }
          if (op.title) store.updateNodeTitle(target, op.title);
          if (op.payload && Object.keys(op.payload).length) {
            // Guard: an update must not inject a templateId for a node whose template
            // isn't a real workflow template (would blank the node) — strip it.
            const up = { ...(op.payload as Record<string, unknown>) };
            if (up.templateId != null) {
              const tpl = opts.templates?.find((t) => t.id === Number(up.templateId));
              if (!tpl || typeof tpl.payload?.workflowJson !== "string" || !(tpl.payload.workflowJson as string).trim()) delete up.templateId;
            }
            if (Object.keys(up).length) store.updateNodeData(target, up as Partial<NodeData>, true);
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
    // Wrap each planned scene's shots in a 「场景」group container (behind nodes).
    for (const box of sceneBoxes) store.addGroupBox(box, box.title);
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

export function buildGraphSummary(excludeNodeId: string, opts: { focusNodeIds?: string[] } = {}): string {
  const { nodes, edges } = useCanvasStore.getState();
  const focus = opts.focusNodeIds && opts.focusNodeIds.length ? new Set(opts.focusNodeIds) : null;
  const clip = (v: unknown) => (typeof v === "string" ? (v.length > 60 ? v.slice(0, 60) + "…" : v) : v);
  const nodeLines = nodes
    .filter((n) => n.id !== excludeNodeId && (!focus || focus.has(n.id)))
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
