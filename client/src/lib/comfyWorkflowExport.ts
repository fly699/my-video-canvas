// #160 自定义工作流节点「工作流导出」：把节点当前的 API-format workflowJson 导出为 .json，
// 并把用户已设的参数值（提示词/种子/步数/尺寸等）回写进对应 inputs——导出的即「当前状态」，
// 可在 ComfyUI 里 Load 直接复用，或存档/分享。图像/音频类参数是运行期上传的 URL/文件名，
// 不属于可移植的工作流内容，导出时跳过（保留模板原有的 LoadImage 占位）。
import type { WorkflowParamBinding } from "../../../shared/types";

type WorkflowNode = { class_type?: string; inputs?: Record<string, unknown>; [k: string]: unknown };
type WorkflowJson = Record<string, WorkflowNode>;

/** 把 `nodeId.fieldPath` 的值写进 workflow[nodeId].inputs（与服务端注入口径一致：
 *  fieldPath 以 "inputs" 开头则剥掉；支持多级路径）。就地修改传入对象。 */
function writeParam(workflow: WorkflowJson, key: string, value: unknown): void {
  const parts = key.split(".");
  if (parts.length < 2) return;
  const [wfNodeId, ...pathParts] = parts;
  const node = workflow[wfNodeId];
  if (!node) return;
  if (!node.inputs || typeof node.inputs !== "object") node.inputs = {};
  const fieldParts = pathParts[0] === "inputs" ? pathParts.slice(1) : pathParts;
  if (fieldParts.length === 0) return;
  if (fieldParts.length === 1) { node.inputs[fieldParts[0]] = value; return; }
  let obj: Record<string, unknown> = node.inputs;
  for (let i = 0; i < fieldParts.length - 1; i++) {
    if (obj[fieldParts[i]] == null || typeof obj[fieldParts[i]] !== "object") obj[fieldParts[i]] = {};
    obj = obj[fieldParts[i]] as Record<string, unknown>;
  }
  obj[fieldParts[fieldParts.length - 1]] = value;
}

/** 生成可导出的 API-format 工作流 JSON（美化缩进）。把非 图像/音频 类参数的当前值回写进 inputs。
 *  workflowJson 为空/非法 → 返回 null（调用方据此禁用导出按钮/给提示）。 */
export function buildWorkflowExportJson(
  workflowJson: string | undefined,
  paramBindings: WorkflowParamBinding[] | undefined,
  paramValues: Record<string, unknown> | undefined,
): string | null {
  const raw = workflowJson?.trim();
  if (!raw) return null;
  let workflow: WorkflowJson;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    workflow = parsed as WorkflowJson;
  } catch { return null; }

  const values = paramValues ?? {};
  const bindings = paramBindings ?? [];
  // 只回写「有绑定 + 非图像/音频 + 用户确有值」的参数——图像/音频是运行期 URL，导出无意义。
  for (const b of bindings) {
    if (b.type === "image" || b.type === "audio") continue;
    const key = `${b.nodeId}.${b.fieldPath}`;
    if (!(key in values)) continue;
    const v = values[key];
    if (v === undefined || v === "") continue;
    writeParam(workflow, key, v);
  }
  return JSON.stringify(workflow, null, 2);
}

/** 由工作流名生成安全的导出文件名（去非法字符、限长、补 .json）。空名回退 workflow。 */
export function workflowExportFilename(name: string | undefined): string {
  const base = (name ?? "").trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 60);
  return `${base || "workflow"}.json`;
}
