import type { NodeConfig } from "./nodeConfig";

// Shared ordering for the node-palette pickers (right-click ContextMenu + bottom
// NodePicker). Pinned types are placed first in this explicit order; everything
// else preserves NODE_CONFIGS order. Stable sort keeps the original sequence for
// non-pinned entries.
//
// Order: 智能体(agent) first (most prominent), then the 3 ComfyUI nodes, then the
// rest (script, storyboard, …) in their NODE_CONFIGS order.
const HEAD_ORDER: Record<string, number> = {
  agent: 0,
  comfyui_image: 1,
  comfyui_video: 2,
  comfyui_workflow: 3,
};

export function sortNodeConfigsForPalette(list: NodeConfig[]): NodeConfig[] {
  return [...list].sort((a, b) => {
    const ai = HEAD_ORDER[a.type] ?? Infinity;
    const bi = HEAD_ORDER[b.type] ?? Infinity;
    return ai - bi; // stable: equal ranks keep source order
  });
}
