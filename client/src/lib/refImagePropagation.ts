// Centralized "reference image" propagation between canvas nodes.
//
// An image-producing source node (image_gen / comfyui_image / storyboard /
// prompt / pose_control / post_process / comfyui_workflow) can feed its current
// output image into the `referenceImageUrl` of any downstream node that accepts
// one (video_task / comfyui_video / comfyui_image), wired through an
// `image-out`/`output` → `ref-image-in` edge.
//
// Two moments need this and used to be implemented separately (and incompletely):
//   1. onConnect — when the edge is first drawn (store).
//   2. after a source node finishes generating — so "connect first, generate
//      later" still fills the downstream reference.
// Both now go through the helpers here so coverage stays consistent.

import { useCanvasStore, type CanvasNode, type CanvasEdge } from "../hooks/useCanvasStore";

// Downstream node types that consume a reference image.
const REF_TARGET_TYPES = new Set(["video_task", "comfyui_video", "comfyui_image"]);

/** Whether a node type accepts an incoming reference image. */
export function isRefImageTarget(nodeType: string): boolean {
  return REF_TARGET_TYPES.has(nodeType);
}

/**
 * The current output-image URL of a source node, by node type. Returns
 * undefined for nodes that don't (currently) expose an output image.
 */
export function resolveNodeOutputImageUrl(node: CanvasNode | undefined): string | undefined {
  if (!node) return undefined;
  const p = node.data.payload as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  switch (node.data.nodeType) {
    case "image_gen":
    case "comfyui_image":
    case "storyboard":
    case "prompt":
      return str(p.imageUrl);
    case "pose_control":
      return str(p.outputImageUrl) ?? str(p.outputUrl);
    case "post_process":
      return str(p.outputUrl);
    case "comfyui_workflow":
      // Only image outputs feed a reference-image target — never a video output.
      if (p.outputType === "video") return undefined;
      return str(p.outputUrl) ?? (Array.isArray(p.outputUrls) ? str((p.outputUrls as unknown[])[0]) : undefined);
    default:
      return undefined;
  }
}

/**
 * Pure: compute the `referenceImageUrl` updates for every ref-accepting target
 * wired to `sourceId` via an image edge. Used by onConnect (which has live
 * nodes/edges in hand) and by propagateRefImage.
 *
 * A reference-image edge is identified solely by `targetHandle === "ref-image-in"`
 * (that handle only ever accepts an image) plus a ref-accepting target type. We
 * deliberately do NOT constrain the source handle: legacy-vertical nodes
 * (e.g. pose_control) have their source port rewritten from `output` to
 * `bottom` on load (see Canvas.tsx LEGACY_VERTICAL_NODES), so a source-handle
 * allowlist would silently drop propagation for those persisted edges.
 */
export function computeRefImageUpdates(
  sourceId: string,
  url: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): { id: string; payload: { referenceImageUrl: string } }[] {
  return edges
    .filter((e) => e.source === sourceId && e.targetHandle === "ref-image-in")
    .flatMap((e) => {
      const target = nodes.find((n) => n.id === e.target);
      return target && REF_TARGET_TYPES.has(target.data.nodeType)
        ? [{ id: e.target, payload: { referenceImageUrl: url } }]
        : [];
    });
}

/**
 * Push a source node's output image to every downstream reference-image target.
 * When `url` is omitted it is resolved from the source node's current payload.
 * Returns how many target nodes were updated (so callers can toast meaningfully).
 */
export function propagateRefImage(sourceId: string, url?: string): number {
  const { nodes, edges, batchUpdateNodeData } = useCanvasStore.getState();
  const finalUrl = url ?? resolveNodeOutputImageUrl(nodes.find((n) => n.id === sourceId));
  if (!finalUrl) return 0;
  const updates = computeRefImageUpdates(sourceId, finalUrl, nodes, edges);
  if (updates.length > 0) batchUpdateNodeData(updates);
  return updates.length;
}
