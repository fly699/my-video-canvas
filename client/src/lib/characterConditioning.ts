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

/** Reference images (main + extra views, de-duped) from every `character` node
 *  connected into targetId. Multi-character PRIORITY is deterministic: characters
 *  are ordered top→bottom (then left→right) by canvas position, so the topmost
 *  character is primary (its views come first) and the user controls priority just
 *  by arranging nodes — instead of relying on edge insertion order. Lets a downstream
 *  shot lock identity on ALL views. Pure / unit-testable. */
type CharNodeLike = { id: string; data: { nodeType: string; payload?: unknown }; position?: { x: number; y: number } };

/** Connected `character` nodes' payloads, ordered by canvas position (top→bottom,
 *  then left→right) so the topmost character has priority. De-duped. */
export function connectedCharacters(
  targetId: string,
  edges: { source: string; target: string }[],
  nodes: CharNodeLike[],
): CharacterNodeData[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chars = edges
    .filter((e) => e.target === targetId)
    .map((e) => byId.get(e.source))
    .filter((n): n is CharNodeLike => !!n && n.data.nodeType === "character");
  const uniq = Array.from(new Map(chars.map((n) => [n.id, n])).values());
  uniq.sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0));
  return uniq.map((n) => n.data.payload as CharacterNodeData);
}

export function connectedCharacterRefImages(
  targetId: string,
  edges: { source: string; target: string }[],
  nodes: CharNodeLike[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of connectedCharacters(targetId, edges, nodes)) {
    for (const url of characterReferenceImages(c)) {
      if (!seen.has(url)) { seen.add(url); out.push(url); }
    }
  }
  return out;
}

/** First connected character's LoRA (name + strength), or null. Priority by position. */
export function connectedCharacterLora(
  targetId: string,
  edges: { source: string; target: string }[],
  nodes: CharNodeLike[],
): { name: string; strengthModel: number } | null {
  for (const c of connectedCharacters(targetId, edges, nodes)) {
    const name = c.loraName?.trim();
    if (name) return { name, strengthModel: c.loraStrength ?? 0.8 };
  }
  return null;
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
