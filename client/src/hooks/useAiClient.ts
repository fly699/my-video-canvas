import { create } from "zustand";

// 全局悬浮「AI 客户端」的可见性/激活会话状态（瞬态，不持久化）。
// open=展开面板；minimized=收成悬浮小球；activeNodeId=当前会话对应的 ai_chat 节点 id。
interface AiClientState {
  open: boolean;
  minimized: boolean;
  activeNodeId: string | null;
  /** Cmd/Ctrl+J：关→开、开→关（最小化态先还原为展开）。 */
  toggle: () => void;
  openPanel: (nodeId?: string) => void;
  close: () => void;
  setMinimized: (v: boolean) => void;
  setActive: (nodeId: string | null) => void;
}

export const useAiClient = create<AiClientState>((set) => ({
  open: false,
  minimized: false,
  activeNodeId: null,
  toggle: () => set((s) => (s.open ? (s.minimized ? { minimized: false } : { open: false }) : { open: true, minimized: false })),
  openPanel: (nodeId) => set((s) => ({ open: true, minimized: false, activeNodeId: nodeId ?? s.activeNodeId })),
  close: () => set({ open: false }),
  setMinimized: (v) => set({ minimized: v }),
  setActive: (nodeId) => set({ activeNodeId: nodeId }),
}));
