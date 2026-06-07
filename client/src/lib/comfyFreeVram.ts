// Broadcast the "free VRAM after run" (freeVramAfterRun) toggle to every ComfyUI
// node on the canvas. Only ComfyUI-driving nodes have a VRAM concept, so we filter
// to those three types. The pure `computeFreeVramUpdates` is unit-tested; the thin
// wrapper applies it through the canvas store's batch updater.
import { useCanvasStore } from "../hooks/useCanvasStore";

/** Node types that actually drive a ComfyUI run (and thus can free VRAM). */
export const COMFY_VRAM_NODE_TYPES = new Set(["comfyui_image", "comfyui_video", "comfyui_workflow"]);

type MiniNode = { id: string; data: { nodeType: string } };

/** Pure: updates that set freeVramAfterRun=value on every ComfyUI node. */
export function computeFreeVramUpdates<T extends MiniNode>(
  nodes: T[],
  value: boolean,
): { id: string; payload: { freeVramAfterRun: boolean } }[] {
  return nodes
    .filter((n) => COMFY_VRAM_NODE_TYPES.has(n.data.nodeType))
    .map((n) => ({ id: n.id, payload: { freeVramAfterRun: value } }));
}

/** Apply the given freeVramAfterRun value to all ComfyUI nodes. Returns the count. */
export function applyFreeVramToAllComfyNodes(value: boolean): number {
  const { nodes, batchUpdateNodeData } = useCanvasStore.getState();
  const updates = computeFreeVramUpdates(nodes, value);
  if (updates.length > 0) batchUpdateNodeData(updates);
  return updates.length;
}
