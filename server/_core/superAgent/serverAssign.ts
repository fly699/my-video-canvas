// 服务器分配（工程智能体多节点场景）：
// - 画布助手一次建多个 super_agent 节点时，把全局服务器列表【轮询（round-robin）分配】到各节点的
//   customBaseUrl，避免全挤到第一台（用户反馈：服务器无法按顺序/随机/自动分配）。
// - 工程智能体运行时若无显式地址，从全局列表按【在飞负载最少】自选（least-loaded），并发均衡。
// 纯函数便于单测。

interface CreateOpLike {
  op?: string;
  nodeType?: string;
  payload?: Record<string, unknown> | undefined;
}

const norm = (u: string) => u.replace(/\/+$/, "").trim();

/** 归一化 + 去重 + 去空的服务器列表。 */
export function normalizeServers(servers: (string | null | undefined)[]): string[] {
  return Array.from(new Set(servers.map((s) => (typeof s === "string" ? norm(s) : "")).filter(Boolean)));
}

/** 把服务器列表轮询分配到「未指定 customBaseUrl」的 super_agent create 操作（就地写入 payload.customBaseUrl）。
 *  已显式指定地址的节点保持不动。返回实际分配的节点数。servers 为空则不动、返回 0。 */
export function assignServersRoundRobin(ops: CreateOpLike[], servers: string[]): number {
  const pool = normalizeServers(servers);
  if (pool.length === 0) return 0;
  let i = 0;
  let assigned = 0;
  for (const op of ops) {
    if (op.op !== "create" || op.nodeType !== "super_agent") continue;
    const payload = (op.payload ?? {}) as Record<string, unknown>;
    const cur = typeof payload.customBaseUrl === "string" ? payload.customBaseUrl.trim() : "";
    if (cur) continue; // 已指定地址 → 尊重
    payload.customBaseUrl = pool[i % pool.length];
    op.payload = payload;
    i++;
    assigned++;
  }
  return assigned;
}

/** 从服务器池里择「在飞任务最少」的一台（tie：取列表靠前者）。池空返回 undefined。 */
export function pickLeastLoaded(servers: string[], load: Map<string, number>): string | undefined {
  const pool = normalizeServers(servers);
  if (pool.length === 0) return undefined;
  return pool.reduce((best, s) => ((load.get(s) ?? 0) < (load.get(best) ?? 0) ? s : best), pool[0]);
}
