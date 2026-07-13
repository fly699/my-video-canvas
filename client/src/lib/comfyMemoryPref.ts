// ComfyUI 节点「是否使用记忆体」全局开关（第三个调用方的开关）。
// 开（默认）：模型选择器等走服务端资源记忆体缓存——学过一次后秒开、跨节点共享、永不过期。
// 关：每次强制读真机（useMemory:false）——刚装/删模型想立刻看到最新时用。
// 存 localStorage，跨会话保持；用自定义事件让同页多个组件即时同步。
import { useSyncExternalStore } from "react";

const KEY = "comfy.useMemory";
const EVT = "comfy-memory-pref-changed";

export function getComfyMemoryEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } // 默认开
}

export function setComfyMemoryEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* 隐私模式等忽略 */ }
  try { window.dispatchEvent(new Event(EVT)); } catch { /* SSR/无 window */ }
}

/** React 订阅：开关变化即刻重渲染读取方（模型选择器等）。 */
export function useComfyMemoryEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVT, cb);
      window.addEventListener("storage", cb); // 跨标签页同步
      return () => { window.removeEventListener(EVT, cb); window.removeEventListener("storage", cb); };
    },
    getComfyMemoryEnabled,
    () => true,
  );
}
