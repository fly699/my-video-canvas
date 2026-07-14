// 「无节点会话」——不在画布上建 ai_chat 节点也能保留的对话（免得画布被聊天节点堆乱）。
// 消息本身仍存服务端（aiChat 表按 nodeId 字符串键存，不要求画布真有该节点），这里只维护
// 「会话索引」（id/标题/模型/更新时间），按项目存 localStorage，跨刷新记住。id 前缀 sess- 以
// 与真实画布节点 id 区分。列表增删改为纯函数，便于单测。

export interface NodelessSession {
  id: string;          // "sess-xxxx"
  title: string;
  model?: string;
  contextNodeIds?: string[]; // 引用的画布节点（本会话上下文）
  updatedAt: number;
}

const PREFIX = "sess-";
export const isNodelessId = (id: string | null | undefined): boolean => !!id && id.startsWith(PREFIX);
/** 生成一个无节点会话 id（随机段由调用方提供，保持纯函数/可测）。 */
export const makeNodelessId = (rand: string): string => `${PREFIX}${rand}`;

// ── 纯列表操作（可单测）───────────────────────────────────────────────────────
export function addSession(list: NodelessSession[], s: NodelessSession): NodelessSession[] {
  return [s, ...list.filter((x) => x.id !== s.id)];
}
export function removeSession(list: NodelessSession[], id: string): NodelessSession[] {
  return list.filter((x) => x.id !== id);
}
export function updateSession(list: NodelessSession[], id: string, patch: Partial<NodelessSession>): NodelessSession[] {
  return list.map((x) => (x.id === id ? { ...x, ...patch } : x));
}
/** 排序：最近更新在前。 */
export function sortSessions(list: NodelessSession[]): NodelessSession[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

// ── localStorage 持久化（按项目）─────────────────────────────────────────────
const keyFor = (projectId: number) => `avc:ai-sessions:v1:${projectId}`;
export function loadNodeless(projectId: number): NodelessSession[] {
  try {
    const s = localStorage.getItem(keyFor(projectId));
    const arr = s ? (JSON.parse(s) as NodelessSession[]) : [];
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x.id === "string") : [];
  } catch { return []; }
}
export function saveNodeless(projectId: number, list: NodelessSession[]): void {
  try { localStorage.setItem(keyFor(projectId), JSON.stringify(list.slice(0, 200))); } catch { /* restricted/full */ }
}
