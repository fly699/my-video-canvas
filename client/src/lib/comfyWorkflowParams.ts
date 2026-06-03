// Helpers for wiring upstream images into a ComfyUI custom-workflow node.
//
// The custom-workflow node binds arbitrary workflow params; some are images
// (LoadImage etc.). When an image-producing node is wired into the workflow
// node, we pull that node's image URL at run time (mirroring the video pull
// model in useWorkflowRunner) and fill any image param the user left blank.
// The server then uploads the URL to ComfyUI and substitutes the filename.
import type { WorkflowParamBinding } from "../../../shared/types";
import { compareUpstreamNodes } from "./inputOrder";

type MiniNode = { id: string; data: { nodeType: string; payload?: unknown; title?: string }; position?: { y?: number } };
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
  return detectUpstreamImages(targetId, edges, nodes)[0];
}

/** All upstream image URLs feeding targetId (edge order, de-duplicated). Used to
 *  fill MULTIPLE blank image params (multi-reference workflows: IPAdapter / multi
 *  LoadImage / fusion). */
export function detectUpstreamImages(targetId: string, edges: MiniEdge[], nodes: MiniNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Smart, deterministic order: by trailing number in the source title, then Y,
  // then connection order — so multi-reference fill matches the on-edge numbers.
  const incoming = edges.map((e, i) => ({ e, i })).filter(({ e }) => e.target === targetId);
  incoming.sort((a, b) => compareUpstreamNodes(byId.get(a.e.source), byId.get(b.e.source), a.i, b.i));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { e } of incoming) {
    const src = byId.get(e.source);
    if (!src || !IMAGE_SOURCE_TYPES.has(src.data.nodeType)) continue;
    const url = getNodeImageUrl(src.data.nodeType, (src.data.payload ?? {}) as Record<string, unknown>);
    if (url && !seen.has(url)) { seen.add(url); out.push(url); }
  }
  return out;
}

const PROMPT_SOURCE_TYPES = new Set(["prompt", "storyboard", "script", "ai_chat"]);

/** Auto-detect positive / negative prompt text from upstream text-producing
 *  nodes wired into targetId (first match each). */
export function detectUpstreamPrompt(targetId: string, edges: MiniEdge[], nodes: MiniNode[]): { positive?: string; negative?: string } {
  let positive: string | undefined;
  let negative: string | undefined;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  for (const edge of edges) {
    if (edge.target !== targetId) continue;
    const src = nodes.find((n) => n.id === edge.source);
    if (!src || !PROMPT_SOURCE_TYPES.has(src.data.nodeType)) continue;
    const p = (src.data.payload ?? {}) as Record<string, unknown>;
    let pos: string | undefined;
    let neg: string | undefined;
    switch (src.data.nodeType) {
      case "prompt": pos = str(p.positivePrompt); neg = str(p.negativePrompt); break;
      case "storyboard": pos = str(p.description); neg = str(p.negativePrompt); break;
      case "script": pos = str(p.content); break;
      case "ai_chat": {
        const msgs = Array.isArray(p.messages) ? (p.messages as Array<{ role?: string; content?: string }>) : [];
        const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
        pos = str(lastAssistant?.content);
        break;
      }
    }
    positive ??= pos;
    negative ??= neg;
    if (positive && negative) break;
  }
  return { positive, negative };
}

/**
 * Compute the paramValues to actually submit plus the list of image-param keys.
 * Blank image params are filled with `upstreamImageUrl` when available; the
 * returned `imageParamKeys` tells the server which params to upload-as-image.
 */
export function resolveWorkflowImageParams(
  bindings: WorkflowParamBinding[] | undefined,
  paramValues: Record<string, unknown>,
  upstream: string | string[] | undefined,
): { paramValues: Record<string, unknown>; imageParamKeys: string[] } {
  const imageBindings = (bindings ?? []).filter((b) => b.type === "image");
  const imageParamKeys = imageBindings.map((b) => `${b.nodeId}.${b.fieldPath}`);
  const urls = Array.isArray(upstream) ? upstream : upstream ? [upstream] : [];
  if (urls.length === 0) return { paramValues, imageParamKeys };
  const next = { ...paramValues };
  // Fill the blank image params in order with successive upstream images
  // (multi-reference). A single upstream image fills only the first blank.
  let i = 0;
  for (const b of imageBindings) {
    if (i >= urls.length) break;
    const key = `${b.nodeId}.${b.fieldPath}`;
    const cur = next[key];
    if (cur == null || cur === "") { next[key] = urls[i]; i++; }
  }
  return { paramValues: next, imageParamKeys };
}

/** Fill blank positive / negative prompt params from upstream prompt text.
 *  Positive param = first text binding labelled 提示词 (not 负…); negative =
 *  first labelled 负…. Only fills params the user hasn't set. */
export function fillWorkflowPromptParams(
  bindings: WorkflowParamBinding[] | undefined,
  paramValues: Record<string, unknown>,
  prompts: { positive?: string; negative?: string },
): Record<string, unknown> {
  if (!prompts.positive && !prompts.negative) return paramValues;
  const texts = (bindings ?? []).filter((b) => b.type === "text");
  const isNeg = (b: WorkflowParamBinding) => b.role === "negative" || (!b.role && /负|negative/i.test(b.label));
  // Prefer explicit roles; fall back to the label heuristic.
  const posB = texts.find((b) => b.role === "positive")
    ?? texts.find((b) => !b.role && /提示词|prompt/i.test(b.label) && !isNeg(b))
    ?? texts.find((b) => !isNeg(b));
  const negB = texts.find((b) => b.role === "negative") ?? texts.find(isNeg);
  const next = { ...paramValues };
  const set = (b: WorkflowParamBinding | undefined, v: string | undefined) => {
    if (!b || !v) return;
    const key = `${b.nodeId}.${b.fieldPath}`;
    const cur = next[key];
    if (cur == null || cur === "") next[key] = v;
  };
  set(posB, prompts.positive);
  set(negB, prompts.negative);
  return next;
}
