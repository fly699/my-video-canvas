// Centralized "reference image" propagation between canvas nodes.
//
// An image-producing source node (image_gen / comfyui_image / storyboard /
// pose_control / post_process / comfyui_workflow) can feed its current
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
import type { ComfyuiControlNet } from "../../../shared/types";

// Downstream node types that consume a reference image.
const REF_TARGET_TYPES = new Set(["video_task", "comfyui_video", "comfyui_image"]);

/** Whether a node type accepts an incoming reference image. */
export function isRefImageTarget(nodeType: string): boolean {
  return REF_TARGET_TYPES.has(nodeType);
}

// Source node types that ALWAYS produce an image (never a video). Used to route
// a freshly-drawn wire onto the `ref-image-in` handle even before the source has
// produced its image yet ("connect first, generate later") — otherwise the later
// propagation, which only matches `targetHandle === "ref-image-in"`, would
// silently skip the edge.
// Deliberately excludes the ambiguous `asset` and `comfyui_workflow` (which can
// be VIDEO): those are routed only when they currently resolve to an image URL
// (resolveNodeOutputImageUrl), so a video asset / video workflow output is never
// mis-routed onto the reference-image handle.
const REF_SOURCE_TYPES = new Set([
  "image_gen", "comfyui_image", "storyboard", "pose_control", "post_process", "image_edit", "director",
]);

/** Whether a node type can act as a reference-image source (may not have an image yet). */
export function isRefImageSource(nodeType: string): boolean {
  return REF_SOURCE_TYPES.has(nodeType);
}

/**
 * Decide the effective `targetHandle` for a freshly-drawn connection.
 *
 * Video / image nodes expose two left target handles: the reference-image handle
 * `ref-image-in` (top:25%) and BaseNode's generic `input` (top:50%). ReactFlow
 * snaps a wire dropped near the node's middle onto the closer `input`, but a
 * reference-image edge is only ever recognised by `targetHandle === "ref-image-in"`
 * — so an image wire that lands on `input` silently fails to load/propagate the
 * reference image. Here we route any "image source → ref-image target" wire onto
 * `ref-image-in` regardless of which handle was hit (covers both generate-first,
 * via a current image URL, and connect-first, via the source node type). Text
 * sources (e.g. 提示词) expose no image and keep their original handle.
 */
export function effectiveTargetHandle(
  rawTargetHandle: string | null | undefined,
  sourceNode: CanvasNode | undefined,
  targetNode: CanvasNode | undefined,
): string | null | undefined {
  if (
    targetNode && isRefImageTarget(targetNode.data.nodeType) &&
    rawTargetHandle !== "ref-image-in" &&
    sourceNode && (resolveNodeOutputImageUrl(sourceNode) || isRefImageSource(sourceNode.data.nodeType))
  ) {
    return "ref-image-in";
  }
  return rawTargetHandle;
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
    case "director":
      // director 把 3D 渲染截图写进 p.imageUrl（与 image_gen 同字段口径）。
      // NB: "prompt" is intentionally NOT here — the 提示词 node is a text-only
      // producer and never feeds an image downstream.
      return str(p.imageUrl);
    case "pose_control":
      return str(p.outputImageUrl) ?? str(p.outputUrl);
    case "post_process":
      return str(p.outputUrl);
    case "image_edit":
      // 图像编辑结果是一张图(p.outputUrl)，可作下游 video_task/comfyui_video 的参考图首帧
      // （与 BaseNode.resultImageUrl 的 image_edit 分支同字段口径）。
      return str(p.outputUrl);
    case "asset":
      // An uploaded/imported IMAGE asset is a valid reference source (asset →
      // video_task / comfyui_video / comfyui_image are common i2v wirings). Only
      // images — never a video/audio asset's url.
      return p.type === "image" ? str(p.url) : undefined;
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

/**
 * Push a source node's prompt(s) to every downstream comfyui_video node so the
 * video matches the image. Returns the per-target payload updates (pure). A
 * connection is any edge source→target where target is a comfyui_video node.
 */
export function computePromptToVideoUpdates(
  sourceId: string,
  prompt: string,
  negPrompt: string | undefined,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): { id: string; payload: { prompt: string; negPrompt?: string } }[] {
  const seen = new Set<string>();
  const out: { id: string; payload: { prompt: string; negPrompt?: string } }[] = [];
  for (const e of edges) {
    if (e.source !== sourceId || seen.has(e.target)) continue;
    const target = nodes.find((n) => n.id === e.target);
    if (target?.data.nodeType !== "comfyui_video") continue;
    seen.add(e.target);
    out.push({ id: e.target, payload: { prompt, ...(negPrompt !== undefined ? { negPrompt } : {}) } });
  }
  return out;
}

/**
 * Apply prompt propagation from a source node to downstream comfyui_video nodes.
 * No-op unless the source's prompt is non-empty. Returns the number updated.
 */
export function propagatePromptToVideo(sourceId: string): number {
  const { nodes, edges, batchUpdateNodeData } = useCanvasStore.getState();
  const src = nodes.find((n) => n.id === sourceId);
  if (!src) return 0;
  const p = src.data.payload as { prompt?: string; negPrompt?: string };
  const prompt = typeof p.prompt === "string" ? p.prompt : "";
  if (!prompt.trim()) return 0;
  const negPrompt = typeof p.negPrompt === "string" ? p.negPrompt : undefined;
  const updates = computePromptToVideoUpdates(sourceId, prompt, negPrompt, nodes, edges);
  if (updates.length > 0) batchUpdateNodeData(updates);
  return updates.length;
}

/** Push an explicit prompt (the custom-workflow node's resolved positive/negative
 *  prompt) to downstream comfyui_video nodes. */
export function propagateWorkflowPrompt(sourceId: string, prompt: string, negPrompt?: string): number {
  if (!prompt.trim()) return 0;
  const { nodes, edges, batchUpdateNodeData } = useCanvasStore.getState();
  const updates = computePromptToVideoUpdates(sourceId, prompt, negPrompt, nodes, edges);
  if (updates.length > 0) batchUpdateNodeData(updates);
  return updates.length;
}

/**
 * Shot continuity: push an already-extracted control map (depth/pose/canny) into
 * every downstream comfyui_image node's ControlNet guide image. Pure. The map is
 * pre-processed, so we clear `preprocessor`; the user's ControlNet model/strength
 * are preserved.
 */
export function computeControlMapUpdates(
  sourceId: string,
  mapUrl: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  strength?: number,
): { id: string; payload: { controlnet: ComfyuiControlNet } }[] {
  const seen = new Set<string>();
  const out: { id: string; payload: { controlnet: ComfyuiControlNet } }[] = [];
  for (const e of edges) {
    if (e.source !== sourceId || seen.has(e.target)) continue;
    const target = nodes.find((n) => n.id === e.target);
    if (target?.data.nodeType !== "comfyui_image") continue;
    seen.add(e.target);
    const cur = ((target.data.payload as { controlnet?: Partial<ComfyuiControlNet> }).controlnet) ?? {};
    // 结构锁强度：调用方给了就写入(硬约束句柄)；否则保留下游原有 strength。
    const controlnet: ComfyuiControlNet = {
      ...cur, model: cur.model ?? "", imageUrl: mapUrl, preprocessor: "",
      ...(strength !== undefined ? { strength } : {}),
    };
    out.push({ id: e.target, payload: { controlnet } });
  }
  return out;
}

/** Apply an extracted control map to downstream comfyui_image ControlNet guides. */
export function propagateControlMap(sourceId: string, mapUrl: string, strength?: number): number {
  if (!mapUrl) return 0;
  const { nodes, edges, batchUpdateNodeData } = useCanvasStore.getState();
  const updates = computeControlMapUpdates(sourceId, mapUrl, nodes, edges, strength);
  if (updates.length > 0) batchUpdateNodeData(updates);
  return updates.length;
}

/**
 * ③ 硬结构句柄：读取一个已持久化控制图的源节点（当前为 director）的 controlMap。
 * 用于「连线即自动注入」——新连一个下游 comfyui_image 时，若源节点已存过控制图，
 * 直接把它注入新连的 ControlNet（无需回导演台重拍）。
 */
export function storedControlMap(node: CanvasNode | undefined): { url: string; strength: number } | undefined {
  if (!node || node.data.nodeType !== "director") return undefined;
  const cm = (node.data.payload as { controlMap?: { url?: string; strength?: number } }).controlMap;
  if (!cm || typeof cm.url !== "string" || !cm.url) return undefined;
  return { url: cm.url, strength: typeof cm.strength === "number" ? cm.strength : 0.85 };
}

/** 单个下游 comfyui_image 目标应写入的 ControlNet（合并其原有 controlnet，仅覆盖 imageUrl/preprocessor/strength）。 */
export function controlnetForStoredMap(
  targetNode: CanvasNode,
  map: { url: string; strength: number },
): ComfyuiControlNet {
  const cur = ((targetNode.data.payload as { controlnet?: Partial<ComfyuiControlNet> }).controlnet) ?? {};
  return { ...cur, model: cur.model ?? "", imageUrl: map.url, preprocessor: "", strength: map.strength };
}
