// Convert a ComfyUI UI-graph workflow (the editor's "workflow" format) into the
// runnable API "prompt" format, using the server's /object_info to map each
// node's widget values to their input names (the same thing the ComfyUI frontend
// does in graphToPrompt). This only runs for UI-format imports; it is best-effort
// and STRICTLY VALIDATED — on any ambiguity it returns { error } so the caller
// falls back to asking the user for the API format. It never emits a partial graph.

interface InputSpec { 0: unknown; 1?: Record<string, unknown> } // [type|combo, opts?]
interface ClassDef { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }
type ObjectInfo = Record<string, ClassDef>;

interface UiNodeInput { name: string; link: number | null; widget?: { name: string } }
interface UiNode { id: number; type: string; mode?: number; inputs?: UiNodeInput[]; widgets_values?: unknown[] | Record<string, unknown>; title?: string }
interface UiWorkflow { nodes?: UiNode[]; links?: unknown[] }

type ApiNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } };

// Nodes that produce no prompt output themselves.
const VIRTUAL = new Set(["Note", "MarkdownNote", "Reroute", "Reroute (rgthree)", "PrimitiveNode", "GetNode", "SetNode"]);
const WIDGET_PRIMITIVES = new Set(["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"]);

const isWidgetSpec = (spec: unknown): boolean => {
  if (Array.isArray(spec)) {
    // [type|combo, opts]; a combo (list of options) is an array as the 0th element.
    if (Array.isArray(spec[0])) return true;
    return typeof spec[0] === "string" && WIDGET_PRIMITIVES.has(spec[0] as string);
  }
  return false;
};

const specOpts = (spec: unknown): Record<string, unknown> => (Array.isArray(spec) && spec[1] && typeof spec[1] === "object" ? (spec[1] as Record<string, unknown>) : {});

/** True when this widget gets an extra "control_after_generate" companion value
 *  in widgets_values (seed/noise_seed, or opts flagged). */
const hasControlAfterGenerate = (name: string, spec: unknown): boolean => {
  const opts = specOpts(spec);
  if (opts.control_after_generate === true) return true;
  return name === "seed" || name === "noise_seed";
};

export function convertUiWorkflowToApiPrompt(ui: UiWorkflow, objectInfo: ObjectInfo): { prompt?: Record<string, ApiNode>; error?: string } {
  const nodes = ui?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return { error: "工作流为空或不是 UI 格式" };

  // linkId → [originNodeId, originSlot]
  const linkMap = new Map<number, [number, number]>();
  for (const l of ui.links ?? []) {
    if (Array.isArray(l) && l.length >= 5) linkMap.set(l[0] as number, [l[1] as number, l[2] as number]);
    else if (l && typeof l === "object") {
      const o = l as Record<string, unknown>;
      if (typeof o.id === "number" && typeof o.origin_id === "number") linkMap.set(o.id, [o.origin_id, (o.origin_slot as number) ?? 0]);
    }
  }
  const nodeById = new Map<number, UiNode>();
  for (const n of nodes) nodeById.set(n.id, n);

  const isActive = (n: UiNode | undefined) => !!n && n.mode !== 2 && n.mode !== 4; // 2=muted,4=bypass

  const isPrimitive = (t: string) => /^primitivenode$|^primitive$/i.test(t);

  // Resolve a link to a concrete graph edge [nodeId, slot] OR a literal value (a
  // PrimitiveNode feeds a widget value), following Reroute passthrough. Returns
  // null when it dead-ends at an unsupported virtual node.
  const resolveLink = (linkId: number, depth = 0): { link?: [string, number]; value?: unknown } | null => {
    if (depth > 64) return null;
    const src = linkMap.get(linkId);
    if (!src) return null;
    const [srcId, srcSlot] = src;
    const srcNode = nodeById.get(srcId);
    if (srcNode) {
      const t = srcNode.type;
      if (t === "Reroute" || t === "Reroute (rgthree)") {
        const up = srcNode.inputs?.[0]?.link;
        return typeof up === "number" ? resolveLink(up, depth + 1) : null;
      }
      if (isPrimitive(t)) {
        const wv = Array.isArray(srcNode.widgets_values) ? srcNode.widgets_values : [];
        return { value: wv[0] };
      }
      if (VIRTUAL.has(t)) return null;
    }
    return { link: [String(srcId), srcSlot] };
  };

  const ADVICE = "。最稳做法：在 ComfyUI 用「Save (API Format)」导出 JSON，或直接拖入带工作流的 PNG。";
  const prompt: Record<string, ApiNode> = {};
  const missingDefs = new Set<string>();
  const unresolved: string[] = [];
  // Every concrete graph edge we emit, so we can verify after the pass that its target
  // node was actually output. A bypassed/muted upstream node is skipped (not emitted)
  // but resolveLink still returns its id → a dangling reference that ComfyUI rejects at
  // runtime ("node X not found"). We catch that here instead of emitting a broken graph.
  const linkRefs: { from: number; field: string; to: string }[] = [];

  for (const node of nodes) {
    if (!isActive(node)) continue;
    if (VIRTUAL.has(node.type) || isPrimitive(node.type)) continue;
    const def = objectInfo[node.type];
    if (!def || !def.input) { missingDefs.add(node.type); continue; }

    const ordered: [string, unknown][] = [
      ...Object.entries(def.input.required ?? {}),
      ...Object.entries(def.input.optional ?? {}),
    ];
    const connectedByName = new Map<string, number>();
    for (const inp of node.inputs ?? []) if (typeof inp.link === "number") connectedByName.set(inp.name, inp.link);

    const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : null;
    if (node.widgets_values && !Array.isArray(node.widgets_values)) { unresolved.push(`${node.type}（参数格式特殊）`); continue; }

    const apiInputs: Record<string, unknown> = {};
    let wi = 0; // widgets_values cursor
    let nodeFailed = false;
    for (const [name, spec] of ordered) {
      if (connectedByName.has(name)) {
        const r = resolveLink(connectedByName.get(name)!);
        if (!r) { unresolved.push(`${node.type}.${name}`); nodeFailed = true; break; }
        apiInputs[name] = r.link ?? r.value;
        if (r.link) linkRefs.push({ from: node.id, field: name, to: r.link[0] });
      } else if (isWidgetSpec(spec)) {
        if (!widgets || wi >= widgets.length) {
          // Missing widget value: use the spec default if any, else leave out.
          const def2 = specOpts(spec).default;
          if (def2 !== undefined) apiInputs[name] = def2;
          continue;
        }
        apiInputs[name] = widgets[wi++];
        if (hasControlAfterGenerate(name, spec)) wi++; // skip the control_after_generate companion value
      }
      // else: an unconnected link-type input → omit (ComfyUI treats as optional/none)
    }
    if (nodeFailed) continue;

    // Validate: every REQUIRED input must be present (connected or widget/default).
    let missingReq = false;
    for (const name of Object.keys(def.input.required ?? {})) {
      if (!(name in apiInputs)) { unresolved.push(`${node.type}.${name}（必填缺失）`); missingReq = true; break; }
    }
    if (missingReq) continue;

    prompt[String(node.id)] = { class_type: node.type, inputs: apiInputs, _meta: node.title ? { title: node.title } : undefined };
  }

  // Aggregate all problems into ONE actionable message (rather than bailing on the
  // first), and always point to the reliable API-format / PNG path.
  if (missingDefs.size > 0) {
    return { error: `服务器上缺少这些节点定义：${Array.from(missingDefs).slice(0, 8).join("、")}${missingDefs.size > 8 ? " 等" : ""}（未安装对应自定义节点？）${ADVICE}` };
  }
  if (unresolved.length > 0) {
    return { error: `部分连线/参数无法自动转换：${unresolved.slice(0, 6).join("、")}${unresolved.length > 6 ? " 等" : ""}${ADVICE}` };
  }
  // Graph integrity: refuse to emit a graph whose edges point at nodes we didn't output
  // (bypassed/muted upstream, or otherwise dropped). Name the offending edges + source.
  const dangling = linkRefs
    .filter((r) => !(r.to in prompt))
    .map((r) => `${nodeById.get(r.from)?.type ?? r.from}.${r.field}→#${r.to}${nodeById.get(Number(r.to))?.type ? `(${nodeById.get(Number(r.to))!.type})` : ""}`);
  if (dangling.length > 0) {
    return { error: `部分连线指向未输出的上游节点（多为被 bypass/静音的节点）：${dangling.slice(0, 6).join("、")}${dangling.length > 6 ? " 等" : ""}。请在 ComfyUI 取消这些节点的 bypass/mute，或${ADVICE.replace(/^。/, "")}` };
  }
  if (Object.keys(prompt).length === 0) return { error: `没有可转换的有效节点${ADVICE}` };
  return { prompt };
}
