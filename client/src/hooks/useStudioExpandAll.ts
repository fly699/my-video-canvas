import { useEffect, useReducer } from "react";

// ★4：工作室命令栏「展开全部参数」的全局偏好——展开/收起一次即记住，后续选中的节点默认沿用，
// 不再每次重选都强制回到 compact。共享单例 + 持久化（与 useStudioCreateBar 同款）。
const KEY = "avc:studio-expand-all";
const listeners = new Set<() => void>();
let expanded = ((): boolean => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })();

export function setStudioExpandAll(v: boolean): void {
  if (expanded === v) return;
  expanded = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* quota */ }
  listeners.forEach((l) => l());
}

/** 读/写「展开全部参数」全局偏好。任一节点切换，所有节点同步。 */
export function useStudioExpandAll(): [boolean, (v: boolean) => void] {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return [expanded, setStudioExpandAll];
}
