// Helpers for wiring upstream images into a ComfyUI custom-workflow node.
//
// The custom-workflow node binds arbitrary workflow params; some are images
// (LoadImage etc.). When an image-producing node is wired into the workflow
// node, we pull that node's image URL at run time (mirroring the video pull
// model in useWorkflowRunner) and fill any image param the user left blank.
// The server then uploads the URL to ComfyUI and substitutes the filename.
import type { WorkflowParamBinding } from "../../../shared/types";

type MiniNode = { id: string; data: { nodeType: string; payload?: unknown } };
type MiniEdge = { source: string; target: string };

const IMAGE_SOURCE_TYPES = new Set(["image_gen", "comfyui_image", "storyboard", "comfyui_workflow", "asset"]);

/** Pick a node's image-output URL regardless of which field/type it uses. */
function getNodeImageUrl(nodeType: string, payload: Record<string, unknown>): string | undefined {
  if (nodeType === "asset") {
    const mt = payload.mimeType as string | undefined;
    if (mt && !mt.startsWith("image/")) return undefined;
    return payload.url as string | undefined;
  }
  // comfyui_workflow stores its result in outputUrl, but only treat it as an
  // image when the run produced images (not a video).
  if (nodeType === "comfyui_workflow" && payload.outputType === "video") return undefined;
  return (payload.imageUrl ?? payload.outputUrl) as string | undefined;
}

/** Auto-detect the first image URL from nodes connected into targetId. */
export function detectUpstreamImageUrl(targetId: string, edges: MiniEdge[], nodes: MiniNode[]): string | undefined {
  for (const edge of edges) {
    if (edge.target !== targetId) continue;
    const src = nodes.find((n) => n.id === edge.source);
    if (!src || !IMAGE_SOURCE_TYPES.has(src.data.nodeType)) continue;
    const url = getNodeImageUrl(src.data.nodeType, (src.data.payload ?? {}) as Record<string, unknown>);
    if (url) return url;
  }
  return undefined;
}

/**
 * Compute the paramValues to actually submit plus the list of image-param keys.
 * Blank image params are filled with `upstreamImageUrl` when available; the
 * returned `imageParamKeys` tells the server which params to upload-as-image.
 */
export function resolveWorkflowImageParams(
  bindings: WorkflowParamBinding[] | undefined,
  paramValues: Record<string, unknown>,
  upstreamImageUrl: string | undefined,
): { paramValues: Record<string, unknown>; imageParamKeys: string[] } {
  const imageBindings = (bindings ?? []).filter((b) => b.type === "image");
  const imageParamKeys = imageBindings.map((b) => `${b.nodeId}.${b.fieldPath}`);
  if (!upstreamImageUrl) return { paramValues, imageParamKeys };
  const next = { ...paramValues };
  for (const b of imageBindings) {
    const key = `${b.nodeId}.${b.fieldPath}`;
    const cur = next[key];
    if (cur == null || cur === "") next[key] = upstreamImageUrl;
  }
  return { paramValues: next, imageParamKeys };
}
