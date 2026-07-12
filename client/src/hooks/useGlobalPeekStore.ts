import { create } from "zustand";

/**
 * Global "peek" toggle (Alt+W). When active, EVERY node temporarily expands its
 * left reference dock + top prompt dock (useNodeDocks ORs this in), so the user
 * can eyeball all参考图/提示词 at once without hovering each node. Pressing Alt+W
 * again — or after a 5s auto-timeout — restores the original state. The peek is
 * presentation-only (it never writes the per-node persisted pin state).
 */
interface PeekState {
  active: boolean;
  toggle: () => void;
  setActive: (v: boolean) => void;
}

let autoTimer: ReturnType<typeof setTimeout> | null = null;

// #114 极简显示（Alt+Q）与速览（Alt+W）的协同：速览期间在 :root 打
// data-canvas-peek 标记，index.css 的极简隐藏规则据此临时豁免——否则参考窗/
// 提示词窗刚被速览展开就被极简规则 display:none 掉（用户实测「显示不出来」）。
const syncPeekAttr = (v: boolean) => {
  if (typeof document === "undefined") return;
  if (v) document.documentElement.setAttribute("data-canvas-peek", "1");
  else document.documentElement.removeAttribute("data-canvas-peek");
};

export const useGlobalPeekStore = create<PeekState>((set, get) => ({
  active: false,
  setActive: (v) => {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    set({ active: v });
    syncPeekAttr(v);
    if (v) autoTimer = setTimeout(() => { autoTimer = null; set({ active: false }); syncPeekAttr(false); }, 5000);
  },
  toggle: () => get().setActive(!get().active),
}));

/** Selector hook for nodes — subscribes only to the boolean. */
export const useGlobalPeek = (): boolean => useGlobalPeekStore((s) => s.active);
