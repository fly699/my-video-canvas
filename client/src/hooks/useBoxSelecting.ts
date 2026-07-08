import { useEffect, useReducer } from "react";

// 框选（拖拽橡皮筋选择）进行中的全局标志。框选过程中框内瞬时可能只覆盖 1 个节点，
// 会被当作「单选」而浮起/展开命令栏，造成节点在框选时闪烁展开。拖拽期间置 true，
// BaseNode 据此抑制所有 studio 浮层，松手后恢复正常（单选才展开）。共享单例。
let selecting = false;
const listeners = new Set<() => void>();

export function setBoxSelecting(v: boolean): void {
  if (selecting === v) return;
  selecting = v;
  listeners.forEach((l) => l());
}

/** 读「框选进行中」全局标志。任一处切换，所有订阅者同步。 */
export function useBoxSelecting(): boolean {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return selecting;
}
