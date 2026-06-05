// "直传" (direct pass-through): push a node's CURRENT output to its connected
// downstream nodes' input fields without running the workflow. Mirrors what the
// runner / onConnect would propagate after a run, so a node that already has an
// output (uploaded asset, previously generated image/video, etc.) can prime its
// downstream consumers immediately.
import { useCanvasStore } from "../hooks/useCanvasStore";
import { resolveWorkflowImageParams } from "./comfyWorkflowParams";
import type { WorkflowParamBinding } from "../../../shared/types";

type AnyPayload = Record<string, unknown>;

// Downstream nodes that take an image via `referenceImageUrl`.
const IMAGE_CONSUMERS = new Set(["video_task", "comfyui_video", "comfyui_image", "image_gen"]);
// Downstream nodes that take a single video via `inputVideoUrl`.
const VIDEO_CONSUMERS = new Set(["clip", "overlay", "smart_cut", "subtitle", "subtitle_motion"]);

/** This node's image output URL, or undefined if it has none. */
export function getNodeImageOutput(nodeType: string, payload: AnyPayload): string | undefined {
  if (nodeType === "asset") return payload.type === "image" ? (payload.url as string | undefined) : undefined;
  if (nodeType === "comfyui_workflow") return payload.outputType === "video" ? undefined : (payload.outputUrl as string | undefined);
  return (payload.imageUrl ?? payload.outputUrl) as string | undefined;
}

/** This node's video output URL, or undefined if it has none.
 *  The `resultVideoUrl ?? outputUrl` fallback bridges the historical field-name split
 *  (video_task/comfyui_video write resultVideoUrl; clip/merge/…/comfyui_workflow write
 *  outputUrl). Full rationale in getNodeVideoUrl, client/src/hooks/useWorkflowRunner.ts. */
export function getNodeVideoOutput(nodeType: string, payload: AnyPayload): string | undefined {
  if (nodeType === "asset") return payload.type === "video" ? (payload.url as string | undefined) : undefined;
  if (nodeType === "comfyui_workflow") return payload.outputType === "image" ? undefined : (payload.outputUrl as string | undefined);
  return (payload.resultVideoUrl ?? payload.outputUrl) as string | undefined;
}

/** Whether this node currently has an output worth passing downstream. */
export function hasPassableOutput(nodeType: string, payload: AnyPayload): boolean {
  return Boolean(getNodeImageOutput(nodeType, payload) || getNodeVideoOutput(nodeType, payload));
}

/**
 * Push the source node's current output to every compatible downstream node.
 * Returns how many downstream nodes were updated, and how many incompatible
 * edges were skipped, so the caller can give meaningful feedback.
 */
export function directPassDownstream(sourceId: string): { updated: number; skipped: number } {
  const { edges, nodes, batchUpdateNodeData } = useCanvasStore.getState();
  const src = nodes.find((n) => n.id === sourceId);
  if (!src) return { updated: 0, skipped: 0 };
  const sp = (src.data.payload ?? {}) as AnyPayload;
  const imageUrl = getNodeImageOutput(src.data.nodeType, sp);
  const videoUrl = getNodeVideoOutput(src.data.nodeType, sp);

  const updates: { id: string; payload: AnyPayload }[] = [];
  let skipped = 0;

  for (const edge of edges) {
    if (edge.source !== sourceId) continue;
    const target = nodes.find((n) => n.id === edge.target);
    if (!target) continue;
    const tt = target.data.nodeType;
    const tp = (target.data.payload ?? {}) as AnyPayload;

    if (imageUrl && IMAGE_CONSUMERS.has(tt)) {
      updates.push({ id: target.id, payload: { referenceImageUrl: imageUrl } });
    } else if (imageUrl && tt === "comfyui_workflow") {
      // Fill blank image params (presets preserved); the node uploads on run.
      const bindings = (tp.paramBindings as WorkflowParamBinding[] | undefined) ?? [];
      if (!bindings.some((b) => b.type === "image")) { skipped++; continue; }
      const { paramValues } = resolveWorkflowImageParams(bindings, (tp.paramValues as AnyPayload) || {}, imageUrl);
      updates.push({ id: target.id, payload: { paramValues } });
    } else if (videoUrl && tt === "merge") {
      const arr = Array.isArray(tp.inputVideoUrls) ? (tp.inputVideoUrls as string[]) : [];
      if (!arr.includes(videoUrl)) updates.push({ id: target.id, payload: { inputVideoUrls: [...arr, videoUrl] } });
    } else if (videoUrl && VIDEO_CONSUMERS.has(tt)) {
      updates.push({ id: target.id, payload: { inputVideoUrl: videoUrl } });
    } else {
      skipped++;
    }
  }

  if (updates.length > 0) batchUpdateNodeData(updates);
  return { updated: updates.length, skipped };
}
