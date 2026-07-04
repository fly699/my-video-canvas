import type { NodeConfig } from "./nodeConfig";

// Shared ordering for the node-palette pickers (right-click ContextMenu + bottom
// NodePicker). Pinned types are placed first in this explicit order; everything
// else preserves NODE_CONFIGS order. Stable sort keeps the original sequence for
// non-pinned entries.
//
// Order: 智能体(agent) first (most prominent), then 工程智能体(super_agent) next to it,
// then the 3 ComfyUI nodes, then the rest (script, storyboard, …) in NODE_CONFIGS order.
// NB: super_agent is defined last in NODE_CONFIGS, so without pinning it fell to the very
// end of the palette (after the coming-soon placeholders) and was easy to miss.
const HEAD_ORDER: Record<string, number> = {
  agent: 0,
  super_agent: 1,
  comfyui_image: 2,
  comfyui_video: 3,
  comfyui_workflow: 4,
};

export function sortNodeConfigsForPalette(list: NodeConfig[]): NodeConfig[] {
  return [...list].sort((a, b) => {
    const ai = HEAD_ORDER[a.type] ?? Infinity;
    const bi = HEAD_ORDER[b.type] ?? Infinity;
    return ai - bi; // stable: equal ranks keep source order
  });
}
