// 轨道片段「一键排布」：把目标片段按当前先后顺序首尾衔接（无缝拼接），起点锚定在最早
// 目标片段的位置。未指定目标（或为空）则排布该轨全部片段。纯函数，便于单测。

/** 将 `clips` 中的目标片段首尾衔接排布；非目标片段保持不动。
 *  @param dur 取片段时长（秒）的函数。
 *  @param targetIds 目标片段 id 集合；为空/省略时表示全部。 */
export function arrangeClips<T extends { id: string; start: number }>(
  clips: readonly T[],
  dur: (c: T) => number,
  targetIds?: ReadonlySet<string> | null,
): T[] {
  const all = !targetIds || targetIds.size === 0;
  const isTarget = (c: T) => all || targetIds!.has(c.id);
  const targets = clips.filter(isTarget);
  if (targets.length <= 1) return clips.slice(); // 0/1 个目标无需排布
  const sorted = [...targets].sort((a, b) => a.start - b.start);
  const anchor = Math.max(0, sorted[0].start); // 锚定在最早目标片段的起点
  const next = new Map<string, number>();
  let cur = anchor;
  for (const c of sorted) { next.set(c.id, cur); cur += Math.max(0, dur(c)); }
  return clips.map((c) => (next.has(c.id) ? { ...c, start: next.get(c.id)! } : c));
}
