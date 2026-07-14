import { create } from "zustand";

// 全局悬浮「AI 客户端」的可见性/激活会话/窗口几何状态。
// open=展开面板；minimized=收成悬浮小球；activeNodeId=当前会话 id（画布 ai_chat 节点 id
// 或无节点会话的合成 id sess-*）；pinned=钉住（记住展开态，下次进画布自动打开）；
// geometry=自定义位置/尺寸（拖拽/缩放后持久化；null=默认右下角停靠）。
export interface AiClientGeometry { x: number; y: number; w: number; h: number }

interface AiClientState {
  open: boolean;
  minimized: boolean;
  activeNodeId: string | null;
  pinned: boolean;
  geometry: AiClientGeometry | null;
  toggle: () => void;
  openPanel: (nodeId?: string) => void;
  close: () => void;
  setMinimized: (v: boolean) => void;
  setActive: (nodeId: string | null) => void;
  setPinned: (v: boolean) => void;
  setGeometry: (g: AiClientGeometry | null) => void;
}

const GEOM_KEY = "avc:ai-client-geom";
const PIN_KEY = "avc:ai-client-pinned";
function readGeom(): AiClientGeometry | null {
  try { const s = localStorage.getItem(GEOM_KEY); return s ? (JSON.parse(s) as AiClientGeometry) : null; } catch { return null; }
}
function readPinned(): boolean {
  try { return localStorage.getItem(PIN_KEY) === "1"; } catch { return false; }
}
const persistGeom = (g: AiClientGeometry | null) => { try { g ? localStorage.setItem(GEOM_KEY, JSON.stringify(g)) : localStorage.removeItem(GEOM_KEY); } catch { /* restricted */ } };
const persistPinned = (v: boolean) => { try { localStorage.setItem(PIN_KEY, v ? "1" : "0"); } catch { /* restricted */ } };

export const useAiClient = create<AiClientState>((set) => ({
  // 钉住时默认进画布即展开（记住展开态）。
  open: readPinned(),
  minimized: false,
  activeNodeId: null,
  pinned: readPinned(),
  geometry: readGeom(),
  toggle: () => set((s) => (s.open ? (s.minimized ? { minimized: false } : { open: false }) : { open: true, minimized: false })),
  openPanel: (nodeId) => set((s) => ({ open: true, minimized: false, activeNodeId: nodeId ?? s.activeNodeId })),
  close: () => set({ open: false }),
  setMinimized: (v) => set({ minimized: v }),
  setActive: (nodeId) => set({ activeNodeId: nodeId }),
  setPinned: (v) => { persistPinned(v); set({ pinned: v }); },
  setGeometry: (g) => { persistGeom(g); set({ geometry: g }); },
}));
