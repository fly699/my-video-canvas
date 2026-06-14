import { useCanvasStore } from "../hooks/useCanvasStore";
import type { ScriptNodeData } from "../../../shared/types";

// 脚本正文版本历史工具：在每次 AI 改写 content 之前快照旧正文，供「历史」面板
// 逐行 diff 对比与一键还原。纯逻辑抽成 appendSnapshot 便于单测。

export const MAX_HISTORY = 20;

export type ScriptHistoryEntry = { content: string; label: string; at: number };

/**
 * 纯函数：把 `content` 以 `label` 追加进历史，返回新数组。
 * - 空 content 不快照（返回原数组）。
 * - 与最后一条 content 相同则不快照（相邻去重）。
 * - 超过 MAX_HISTORY 时丢弃最旧的。
 */
export function appendSnapshot(
  history: ScriptHistoryEntry[] | undefined,
  content: string,
  label: string,
  now: number = Date.now(),
): ScriptHistoryEntry[] {
  const prev = history ?? [];
  if (!content.trim()) return prev;
  const last = prev[prev.length - 1];
  if (last && last.content === content) return prev;
  const next = [...prev, { content, label, at: now }];
  if (next.length > MAX_HISTORY) next.splice(0, next.length - MAX_HISTORY);
  return next;
}

/**
 * 读取脚本节点当前正文，快照进 scriptHistory（silent 写入，避免污染 undo 栈）。
 * 在所有「AI 改写 content」的 onSuccess 里、写入新正文之前调用。
 */
export function snapshotContent(id: string, label: string): void {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === id);
  if (!node) return;
  const payload = node.data.payload as ScriptNodeData;
  const current = payload.content ?? "";
  const next = appendSnapshot(payload.scriptHistory, current, label);
  if (next === payload.scriptHistory) return; // 无变化（空/重复）不写
  store.updateNodeData(id, { scriptHistory: next }, true);
}
