import { useSyncExternalStore } from "react";

/**
 * #109 极简显示（Alt+Q）状态的响应式订阅。
 * 信号源是 <html data-canvas-minimal="1">（CSS 覆写同款单一信号），Canvas 在切换/
 * 恢复时同步派发 `canvas:minimal-change` 事件驱动本 hook 重渲染。
 * 用于需要按极简态改变「渲染结构」的场景（如多产物节点强制网格平铺）——
 * 纯外观差异请直接写 CSS，别用本 hook。
 */
const subscribe = (cb: () => void) => {
  window.addEventListener("canvas:minimal-change", cb);
  return () => window.removeEventListener("canvas:minimal-change", cb);
};
const getSnapshot = () =>
  typeof document !== "undefined" && document.documentElement.getAttribute("data-canvas-minimal") === "1";

export function useMinimalDisplay(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
