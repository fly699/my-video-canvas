// 全局在线用户计数：每个用户可能有多个 socket（多标签页 + 主/‑chat 两个命名空间），
// 用引用计数，每个 socket connect +1、disconnect −1，归零即离线。独立模块以避免
// index.ts(写) 与 admin router(读) 之间的循环依赖（同 registerChatBroadcaster 范式）。
const onlineCounts = new Map<number, number>();

export function markOnline(userId: number): void {
  if (!Number.isFinite(userId)) return;
  onlineCounts.set(userId, (onlineCounts.get(userId) ?? 0) + 1);
}

export function markOffline(userId: number): void {
  const n = onlineCounts.get(userId);
  if (n === undefined) return;
  if (n <= 1) onlineCounts.delete(userId);
  else onlineCounts.set(userId, n - 1);
}

/** 当前在线的用户 id 列表（计数 > 0）。供管理后台读取。 */
export function getOnlineUserIds(): number[] {
  return Array.from(onlineCounts.keys());
}

export function isUserOnline(userId: number): boolean {
  return (onlineCounts.get(userId) ?? 0) > 0;
}
