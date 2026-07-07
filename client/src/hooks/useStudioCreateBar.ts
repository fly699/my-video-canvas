import { useEffect, useReducer } from "react";

// 「快速创作栏」折叠状态的共享单例：让底部工具栏的开关按钮与 StudioCreateBar 本体同步
// （折叠时创作栏不渲染、由底栏那枚按钮控制展开），并持久化。
const KEY = "avc:studio-createbar-collapsed";
const listeners = new Set<() => void>();
// 默认折叠（关闭）：首次进入不弹出快速创作栏，需要时点底栏「快速创作」按钮展开。
// 老用户若显式展开过（存 "0"）仍保持展开。
let collapsed = ((): boolean => { try { const v = localStorage.getItem(KEY); return v === null ? true : v === "1"; } catch { return true; } })();

export function setStudioCreateBarCollapsed(v: boolean): void {
  if (collapsed === v) return;
  collapsed = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* quota */ }
  listeners.forEach((l) => l());
}

/** 读/写「快速创作栏是否折叠」。多处订阅同一单例，任一处切换全部同步。 */
export function useStudioCreateBarCollapsed(): [boolean, (v: boolean) => void] {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return [collapsed, setStudioCreateBarCollapsed];
}
