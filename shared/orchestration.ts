// 优化③ 编排模板库：把一次满意规划的 operations 存成「可复用编排」，下次一句话重放。
// 关键是只保留【跨项目可重放】的操作：create（带 tempId）+ 连接两个本批 create 的 connect。
// update/delete/canvas 等引用既有节点或触发生成的上下文相关操作剔除——跨项目重放会失效或误触发。
import type { AgentOperation } from "./types";

export interface OrchestrationTemplate {
  id: string;
  name: string;
  createdAt: number;
  ops: AgentOperation[];
}

/** 抽出可复用编排：create（有 tempId）+ 两端都指向本批 create 的 connect。其余操作剔除。 */
export function extractReplayableOps(ops: AgentOperation[]): AgentOperation[] {
  const createIds = new Set<string>();
  for (const o of ops) if (o.op === "create" && o.tempId) createIds.add(o.tempId);
  const out: AgentOperation[] = [];
  for (const o of ops) {
    if (o.op === "create" && o.tempId) out.push(o);
    else if (o.op === "connect" && o.sourceRef && o.targetRef && createIds.has(o.sourceRef) && createIds.has(o.targetRef)) out.push(o);
  }
  return out;
}

/** 编排规模摘要（建节点数 / 连线数），供模板列表展示。 */
export function orchestrationSummary(ops: AgentOperation[]): { creates: number; connects: number } {
  let creates = 0, connects = 0;
  for (const o of ops) { if (o.op === "create") creates++; else if (o.op === "connect") connects++; }
  return { creates, connects };
}

export const MAX_ORCHESTRATIONS = 20;   // 每账号最多存 20 套编排模板
export const MAX_ORCH_OPS = 200;        // 单套编排最多 200 个操作（防超 KV 上限）

/** 是否可把这批 ops 存成编排模板（至少 1 个 create 且操作数不超上限）。 */
export function canSaveOrchestration(ops: AgentOperation[]): boolean {
  const replay = extractReplayableOps(ops);
  return replay.some((o) => o.op === "create") && replay.length <= MAX_ORCH_OPS;
}

/** 拖拽排序：把 fromId 的编排移动到 toId 所在位置（插到 toId 原位）。纯函数。
 *  fromId===toId、任一 id 不存在时原样返回（引用不变，便于 setState 短路）。 */
export function reorderOrch<T extends { id: string }>(list: T[], fromId: string, toId: string): T[] {
  if (fromId === toId) return list;
  const fromIdx = list.findIndex((x) => x.id === fromId);
  const toIdx = list.findIndex((x) => x.id === toId);
  if (fromIdx < 0 || toIdx < 0) return list;
  const next = list.slice();
  const [moved] = next.splice(fromIdx, 1);
  // 方向感知：往下拖插到目标【之后】、往上拖插到目标【之前】——与拖拽落点直觉一致。
  let insertAt = next.findIndex((x) => x.id === toId);
  if (insertAt < 0) return list;
  if (fromIdx < toIdx) insertAt += 1;
  next.splice(insertAt, 0, moved);
  return next;
}

// ── 导入/导出：把「我的编排」备份成 JSON 或从 JSON 导入（跨账号/项目共享、备份）。──────
/** 序列化编排模板列表为可下载的 JSON 文本（带版本号）。纯函数。 */
export function serializeOrchestrations(list: OrchestrationTemplate[]): string {
  return JSON.stringify({ version: 1, templates: list }, null, 2);
}

/** 解析导入的 JSON 文本为编排模板：容错跳过非法项，只保留可重放（含 create）的编排，
 *  重新分配 id 防与现有冲突，最多取 MAX_ORCHESTRATIONS 套。纯函数（id 由外部传入生成器保证可测）。 */
export function parseOrchestrations(json: string, genId: (i: number) => string): OrchestrationTemplate[] {
  let data: unknown;
  try { data = JSON.parse(json); } catch { return []; }
  const raw = Array.isArray(data) ? data : (data && typeof data === "object" && Array.isArray((data as { templates?: unknown }).templates) ? (data as { templates: unknown[] }).templates : []);
  const out: OrchestrationTemplate[] = [];
  for (const item of raw) {
    if (out.length >= MAX_ORCHESTRATIONS) break;
    if (!item || typeof item !== "object") continue;
    const t = item as { name?: unknown; ops?: unknown; createdAt?: unknown };
    if (!Array.isArray(t.ops)) continue;
    const ops = extractReplayableOps(t.ops as AgentOperation[]);
    if (!ops.some((o) => o.op === "create")) continue; // 无可建节点操作 → 跳过
    out.push({
      id: genId(out.length),
      name: typeof t.name === "string" && t.name.trim() ? t.name.trim().slice(0, 60) : `导入编排${out.length + 1}`,
      createdAt: typeof t.createdAt === "number" ? t.createdAt : 0,
      ops,
    });
  }
  return out;
}
