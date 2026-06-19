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

export const useGlobalPeekStore = create<PeekState>((set, get) => ({
  active: false,
  setActive: (v) => {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    set({ active: v });
    if (v) autoTimer = setTimeout(() => { autoTimer = null; set({ active: false }); }, 5000);
  },
  toggle: () => get().setActive(!get().active),
}));

/** Selector hook for nodes — subscribes only to the boolean. */
export const useGlobalPeek = (): boolean => useGlobalPeekStore((s) => s.active);
