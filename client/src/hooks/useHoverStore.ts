import { create } from "zustand";

/** Which node is currently hovered (set by BaseNode). Edges read this to show
 *  their input/output order numbers near the hovered node's handles. Kept in a
 *  tiny isolated store so hovering doesn't re-render the whole canvas. */
export const useHoverStore = create<{ nodeId: string | null; setHovered: (id: string | null) => void }>((set) => ({
  nodeId: null,
  setHovered: (nodeId) => set({ nodeId }),
}));
