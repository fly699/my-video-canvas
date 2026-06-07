// Wire a connected Character node's identity into a ComfyUI image node's
// conditioning: its reference image(s) drive IPAdapter face-lock, and its
// optional character LoRA is added to the lora stack. Pure + unit-testable;
// the graph traversal lives in the auto-fill hook.
//
// Semantics mirror the existing upstream auto-fill: FILL-ONLY-WHEN-BLANK, so a
// user's manually-set IPAdapter images / LoRAs are never overwritten and there's
// no update loop. Text identity (name/outfit/…) already flows via the prompt
// injection path (characterPrompt.ts), so this only handles model conditioning.

import type { CharacterNodeData, ComfyuiIPAdapter, ComfyuiLoraEntry } from "../../../shared/types";

/** Distinct, non-empty reference image URLs for a character (main + extra views). */
export function characterReferenceImages(c: CharacterNodeData): string[] {
  const urls = [c.referenceImageUrl, ...(c.additionalImageUrls ?? [])]
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0);
  return Array.from(new Set(urls));
}

/** True when the character carries any conditioning we can apply downstream. */
export function characterHasConditioning(c: CharacterNodeData): boolean {
  return characterReferenceImages(c).length > 0 || !!c.loraName?.trim();
}

/** Reference images (main + extra views, de-duped, edge order) from every
 *  `character` node connected into targetId. Lets a downstream shot lock identity
 *  on ALL of a character's views, not just the first — used to feed multi-reference
 *  (reference_image_urls / IPAdapter). Pure / unit-testable. */
export function connectedCharacterRefImages(
  targetId: string,
  edges: { source: string; target: string }[],
  nodes: { id: string; data: { nodeType: string; payload?: unknown } }[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.target !== targetId) continue;
    const src = nodes.find((n) => n.id === e.source);
    if (!src || src.data.nodeType !== "character") continue;
    for (const url of characterReferenceImages(src.data.payload as CharacterNodeData)) {
      if (!seen.has(url)) { seen.add(url); out.push(url); }
    }
  }
  return out;
}

export interface CharacterConditioningPatch {
  ipadapter?: ComfyuiIPAdapter;
  loras?: ComfyuiLoraEntry[];
}

/**
 * Compute the fill-only-when-blank patch that wires a character's identity into a
 * comfyui_image node. Returns an empty object when nothing should change.
 *
 * - IPAdapter: only when the node has NO reference images set yet. We fill the
 *   image(s) and weight but DON'T invent a model — the user still picks the
 *   IPAdapter model (the server only applies IPAdapter when a model is set), so
 *   this never silently changes a render that lacked a model.
 * - LoRA: append the character LoRA only if not already present in the stack.
 */
export function deriveCharacterConditioning(
  character: CharacterNodeData,
  current: { ipadapter?: ComfyuiIPAdapter | null; loras?: ComfyuiLoraEntry[] | null },
): CharacterConditioningPatch {
  const patch: CharacterConditioningPatch = {};

  const refs = characterReferenceImages(character);
  const curIp = current.ipadapter ?? undefined;
  const ipHasImages = !!(curIp && ((curIp.imageUrls && curIp.imageUrls.length > 0) || curIp.imageUrl));
  if (refs.length > 0 && !ipHasImages) {
    patch.ipadapter = {
      model: curIp?.model ?? "",
      imageUrl: refs[0],
      imageUrls: refs,
      clipVision: curIp?.clipVision,
      weight: curIp?.weight ?? character.ipadapterWeight ?? 0.8,
    };
  }

  const loraName = character.loraName?.trim();
  if (loraName) {
    const loras = current.loras ?? [];
    if (!loras.some((l) => l.name === loraName)) {
      patch.loras = [...loras, { name: loraName, strengthModel: character.loraStrength ?? 0.8 }];
    }
  }

  return patch;
}
