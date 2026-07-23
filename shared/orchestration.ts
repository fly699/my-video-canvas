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
