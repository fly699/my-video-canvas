// 全局在线状态 + 今日在线时长统计。
// 每个用户可能有多个 socket（多标签 + 主/‑chat 两个命名空间），用引用计数：
// count 0→1 视为「上线」记 sessionStart，count→0 视为「下线」把本段时长累加进当天累计。
// 「今日在线时长」按 wall-clock 计（并发多 socket 不重复计时），跨天自动重置。
// 内存态：服务器重启清零（与在线状态本身一致）。独立模块避免 index.ts↔admin router 循环依赖。
interface UserPresence {
  count: number;          // 当前活跃 socket 数
  day: string;            // 累计所属的自然日（本地时区）
  accumulatedMs: number;  // 当天已下线段的累计在线毫秒
  sessionStart: number | null; // 当前在线段的起始时间戳（count>0 时有值）
}
const map = new Map<number, UserPresence>();

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// 跨天处理：若累计所属日已非今日，清零累计；若此刻仍在线，则新的一天从当前时刻重新起算。
function rollover(p: UserPresence, now: number): void {
  const t = today();
  if (p.day !== t) {
    p.day = t;
    p.accumulatedMs = 0;
    p.sessionStart = p.count > 0 ? now : null;
  }
}

export function markOnline(userId: number): void {
  if (!Number.isFinite(userId)) return;
  const now = Date.now();
  let p = map.get(userId);
  if (!p) { p = { count: 0, day: today(), accumulatedMs: 0, sessionStart: null }; map.set(userId, p); }
  rollover(p, now);
  if (p.count === 0) p.sessionStart = now; // 首个 socket 上线 → 起算
  p.count += 1;
}

export function markOffline(userId: number): void {
  const p = map.get(userId);
  if (!p || p.count === 0) return;
  const now = Date.now();
  rollover(p, now);
  p.count -= 1;
  if (p.count === 0 && p.sessionStart != null) {
    p.accumulatedMs += Math.max(0, now - p.sessionStart); // 最后一个 socket 下线 → 累加本段
    p.sessionStart = null;
  }
}

/** 当前在线的用户 id 列表（count > 0）。 */
export function getOnlineUserIds(): number[] {
  const out: number[] = [];
  map.forEach((p, id) => { if (p.count > 0) out.push(id); });
  return out;
}

export function isUserOnline(userId: number): boolean {
  return (map.get(userId)?.count ?? 0) > 0;
}

/** 在线状态 + 今日在线时长（秒）。含已下线但今日有累计时长的用户，供管理后台显示。 */
export function getPresenceStats(): { userId: number; online: boolean; todaySeconds: number }[] {
  const now = Date.now();
  const out: { userId: number; online: boolean; todaySeconds: number }[] = [];
  map.forEach((p, id) => {
    rollover(p, now);
    const live = p.count > 0 && p.sessionStart != null ? now - p.sessionStart : 0;
    const todaySeconds = Math.round((p.accumulatedMs + live) / 1000);
    if (p.count > 0 || todaySeconds > 0) out.push({ userId: id, online: p.count > 0, todaySeconds });
  });
  return out;
}
