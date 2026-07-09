import type { ResultSnapshot } from "../../../shared/types";

// 节点级「版本历史 + 一键回滚」（#5）：每次产出一张**新**图就追加一条快照（最新在前，封顶）。
// 回滚 = 把某条快照的 url 写回 imageUrl；此时该 url 已在历史里 → 追加逻辑判定为「已记录」不动，
// 保持历史严格按产出时间倒序、来回回滚不打乱顺序。纯函数，便于单测。
export const RESULT_HISTORY_CAP = 12;

export function pushResultSnapshot(
  history: ResultSnapshot[] | undefined,
  snap: ResultSnapshot,
): ResultSnapshot[] {
  const hist = history ?? [];
  if (!snap.url) return hist;
  // 已记录（新图重复 / 回滚到旧快照）→ 原样返回同一引用，调用方据引用相等跳过写入，防更新环。
  if (hist.some((h) => h.url === snap.url)) return hist;
  return [snap, ...hist].slice(0, RESULT_HISTORY_CAP);
}
