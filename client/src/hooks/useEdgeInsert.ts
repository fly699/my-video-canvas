import { create } from "zustand";

// ◆1 线上插入节点的意图桥：边工具条的 ⊕ 点击后记下 edgeId 并请求打开节点选择器；
// Canvas 监听到 edgeId 就打开 NodePicker，用户选类型时改走 insertNodeOnEdge 而非普通新建。
interface EdgeInsertState {
  edgeId: string | null;
  requestInsert: (id: string) => void;
  clear: () => void;
}
export const useEdgeInsert = create<EdgeInsertState>((set) => ({
  edgeId: null,
  requestInsert: (id) => set({ edgeId: id }),
  clear: () => set({ edgeId: null }),
}));
