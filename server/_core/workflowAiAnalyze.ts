// 工作流参数「主次」排序 + AI 辅助分析（本机 Claude + ComfyUI MCP）的纯逻辑。
// - bindingPriority：给每个参数绑定判主次（1=主参数：提示词/尺寸/主模型/步数/CFG/种子；2=次要）。
//   即便不开 AI，也让参数列表主次分明（用户反馈「主次不分」）。
// - mergeAiBindings：把 AI 纠正的 type/role/priority/label 按 (nodeId,fieldPath) 合并进启发式结果
//   （推荐策略 C：AI 纠类型+分主次，绑定本身沿用启发式，稳）。
// - parseAiBindings：从 claude 返回文本里抠严格 JSON `{bindings:[...]}`。
import type { WorkflowParamBinding } from "../../shared/types";

/** 主参数：正/负提示词、宽高、主模型 ckpt、步数、CFG、种子。其余次要。 */
export function bindingPriority(b: Pick<WorkflowParamBinding, "fieldPath" | "role" | "label">): number {
  if (b.role === "positive" || b.role === "negative") return 1;
  const fp = (b.fieldPath || "").toLowerCase();
  if (/(^|[._])(text|width|height|ckpt_name|steps|cfg|seed|noise_seed|length|frames|batch_size)$/.test(fp)) return 1;
  if (/提示词|正向|负向|宽|高|种子|主模型|检查点|步数|帧/.test(b.label || "")) return 1;
  return 2;
}

/** 给一批启发式绑定补上 priority（不改其它字段）。 */
export function withPriorities(bindings: WorkflowParamBinding[]): WorkflowParamBinding[] {
  return bindings.map((b) => (typeof b.priority === "number" ? b : { ...b, priority: bindingPriority(b) }));
}

/** 合并 AI 纠正（只覆盖 type/role/priority/label，按 nodeId+fieldPath 匹配；未命中的绑定原样保留）。 */
export function mergeAiBindings(base: WorkflowParamBinding[], ai: Partial<WorkflowParamBinding>[]): WorkflowParamBinding[] {
  const VALID_TYPE = new Set(["text", "number", "select", "image", "audio", "boolean"]);
  const VALID_ROLE = new Set(["positive", "negative", "reference", "control", "mask"]);
  const byKey = new Map<string, Partial<WorkflowParamBinding>>();
  for (const a of ai) if (a && a.nodeId && a.fieldPath) byKey.set(`${a.nodeId}.${a.fieldPath}`, a);
  return base.map((b) => {
    const a = byKey.get(`${b.nodeId}.${b.fieldPath}`);
    if (!a) return b;
    return {
      ...b,
      ...(typeof a.type === "string" && VALID_TYPE.has(a.type) ? { type: a.type as WorkflowParamBinding["type"] } : {}),
      ...(typeof a.role === "string" && VALID_ROLE.has(a.role) ? { role: a.role as WorkflowParamBinding["role"] } : {}),
      ...(typeof a.priority === "number" && a.priority >= 1 && a.priority <= 3 ? { priority: a.priority } : {}),
      ...(typeof a.label === "string" && a.label.trim() ? { label: a.label.trim().slice(0, 80) } : {}),
    };
  });
}

/** 从 claude 返回文本里抠 `{"bindings":[...]}` 的 bindings 数组（容错 Markdown 围栏/解释文字）。 */
export function parseAiBindings(text: string): Partial<WorkflowParamBinding>[] {
  const m = /\{[\s\S]*"bindings"[\s\S]*\}/.exec(text);
  if (!m) return [];
  try {
    const o = JSON.parse(m[0]) as { bindings?: unknown };
    if (!Array.isArray(o.bindings)) return [];
    return o.bindings.filter((x): x is Partial<WorkflowParamBinding> => !!x && typeof x === "object"
      && typeof (x as { nodeId?: unknown }).nodeId === "string" && typeof (x as { fieldPath?: unknown }).fieldPath === "string");
  } catch { return []; }
}

/** 从工作流 JSON 抽出 nodeId → class_type 精简映射（喂给 AI，让它按 class_type 用 MCP 查 schema）。 */
export function nodeClassMap(workflowJson: string): Record<string, string> {
  try {
    const wf = JSON.parse(workflowJson) as Record<string, { class_type?: unknown }>;
    const out: Record<string, string> = {};
    for (const [id, n] of Object.entries(wf)) if (n && typeof n === "object" && typeof n.class_type === "string") out[id] = n.class_type;
    return out;
  } catch { return {}; }
}
