import { useEffect, useReducer } from "react";

// 「展开配置区必须真点击」守卫。
//
// 需求：拖拽节点、框选（橡皮筋）时，被选中的节点都不应展开配置区，要维持点击前(收起)的样子；
// 只有真正的点击（按下并抬起、无拖动）才展开。
//
// 做法：只把「因手势(拖拽/框选)而选中」的节点 id 放进抑制集 —— 这些 id 即使 selected=true
// 也不展开，直到被真正点击(onNodeClick，React Flow 仅在无拖动时触发)时清出抑制集。
// 程序化选中(新建节点/线上插入/搜索聚焦等)不入抑制集，照旧「选中即展开」，零回归。
//
// 不区分节点类型：所有节点统一走 BaseNode 的 expandSelected，故此守卫对每一种节点一致生效。
const suppressed = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** 标记这些节点为「手势选中」——即便被选中也不展开，直到被真正点击。 */
export function markGestureSelected(ids: string[]): void {
  let changed = false;
  for (const id of ids) if (!suppressed.has(id)) { suppressed.add(id); changed = true; }
  if (changed) emit();
}

/** 解除抑制：传 id 解除单个（真点击该节点）；不传解除全部（点空白/清空选区）。 */
export function clearGestureSelected(id?: string): void {
  if (id === undefined) { if (suppressed.size) { suppressed.clear(); emit(); } return; }
  if (suppressed.delete(id)) emit();
}

/** 该节点是否被手势(拖拽/框选)抑制展开。纯函数，供单测与 hook 复用。 */
export function isGestureSuppressed(id: string): boolean {
  return suppressed.has(id);
}

/** 该节点当前是否允许「选中即展开」（未被拖拽/框选抑制）。 */
export function useNodeExpandable(id: string): boolean {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return !isGestureSuppressed(id);
}
