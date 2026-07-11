import { create } from "zustand";

/**
 * 画布拾取模式（LibTV「＋参考 / 标记」）：节点输入条发起 → 顶部浮条提示 →
 * 点击画布上其它节点的产物完成拾取。
 * - ref：从画布选择参考（可连选，「返回节点/退出」结束）
 * - mark：元素选择模式（点一张图 → AI 分析元素 → 点选插入引用），选一张即结束
 * 拾取结果经 CustomEvent("canvas:pick-result", {forNodeId, kind, url}) 派回发起节点。
 */
export type PickKind = "ref" | "mark";

interface PickState {
  kind: PickKind | null;
  forNodeId: string | null;
  begin: (kind: PickKind, forNodeId: string) => void;
  end: () => void;
}

export const usePickStore = create<PickState>((set) => ({
  kind: null,
  forNodeId: null,
  begin: (kind, forNodeId) => set({ kind, forNodeId }),
  end: () => set({ kind: null, forNodeId: null }),
}));
