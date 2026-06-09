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

/** Identity REFERENCE images only come from PERSON characters — a 场景 (scene) node's
 *  image is a location, not a face/subject, so it must not feed IPAdapter/identity refs. */
export function connectedCharacterRefImages(
  targetId: string,
  edges: { source: string; target: string }[],
  nodes: CharNodeLike[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of connectedCharacters(targetId, edges, nodes)) {
    if ((c.characterKind ?? "person") === "scene") continue; // scenes = location text, not identity
    for (const url of characterReferenceImages(c)) {
      if (!seen.has(url)) { seen.add(url); out.push(url); }
    }
  }
  return out;
}

/** Reference images from connected SCENE characters — backdrop / location / style refs,
 *  NOT identity/face refs. Kept SEPARATE from connectedCharacterRefImages so a scene's
 *  image never feeds IPAdapter face-lock; callers append these as general image context
 *  (POYO edit/reference models) after the person identity refs. Position-ordered. */
export function connectedSceneRefImages(
  targetId: string,
  edges: { source: string; target: string }[],
  nodes: CharNodeLike[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of connectedCharacters(targetId, edges, nodes)) {
    if ((c.characterKind ?? "person") !== "scene") continue;
    for (const url of characterReferenceImages(c)) {
      if (!seen.has(url)) { seen.add(url); out.push(url); }
    }
  }
  return out;
}

// ── @角色 提及解析 ────────────────────────────────────────────────────────────
// 在文本框输入「@角色名」是一种「无需连线」就引用画布上角色/场景的方式。生成时
// 必须把这些 @提及 当成和「连线」等价：注入该角色的结构化描述 + 参考图，并把
// 字面量「@名字」从 prompt 里去掉（否则模型只看到一串无意义的 "@名字"）。

/** 角色/场景节点的显示名（person 用 name，scene 用 sceneName）。 */
export function charDisplayName(p: CharacterNodeData): string {
  return (((p.characterKind ?? "person") === "scene" ? p.sceneName : p.name) ?? "").trim();
}

// 「@名字」的边界匹配：名字两侧不能再接「名字字符」(字母/数字/下划线/CJK 文字)，
// 否则会把 @李明 误命中到 @李明华、把 @Bob 误命中到 @Bobby——而 李明华/Bobby 往往
// 是用户随手打的另一个人名（并非画布角色），导致「凭空多出一个并不在角色库里的人物」。
// 用 Unicode 词边界把「@名字」锁成完整一段：前面不接名字字符、后面不接名字字符
// （空格 / 标点 / 行尾 / 另一个 @ 都算边界，下拉插入的「@名字 」天然带空格，正常命中）。
const NAME_CHAR = "\\p{L}\\p{N}_";
function mentionRegex(name: string): RegExp {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![${NAME_CHAR}])@${esc}(?![${NAME_CHAR}])`, "gu");
}

/** prompt 里被「@名字」提及到的角色/场景（去重）。长名优先；用词边界匹配，
 *  避免 @李明 误命中 @李明华、@Bob 误命中 @Bobby。 */
export function mentionedCharacters(prompt: string | undefined, nodes: CharNodeLike[]): CharacterNodeData[] {
  const scan = prompt ?? "";
  if (!scan.includes("@")) return [];
  const named = nodes
    .filter((n) => n.data.nodeType === "character")
    .map((n) => ({ p: n.data.payload as CharacterNodeData, name: charDisplayName(n.data.payload as CharacterNodeData) }))
    .filter((x) => x.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  const out: CharacterNodeData[] = [];
  const seen = new Set<string>();
  for (const { p, name } of named) {
    if (seen.has(name)) continue;
    if (!mentionRegex(name).test(scan)) continue; // 边界匹配：整段「@名字」才算
    seen.add(name);
    out.push(p);
  }
  return out;
}

/** 去掉 prompt 里所有「@名字」字面量（生成改用结构化注入，不让模型看到 "@名字"）。
 *  仅去掉边界匹配到的整段，避免误删 @李明华 里的 @李明。 */
export function stripCharacterMentions(prompt: string | undefined, nodes: CharNodeLike[]): string {
  let text = prompt ?? "";
  if (!text.includes("@")) return text;
  for (const c of mentionedCharacters(text, nodes)) {
    const name = charDisplayName(c);
    if (name) text = text.replace(mentionRegex(name), " ");
  }
  return text.replace(/[ \t]{2,}/g, " ").replace(/\s+([，,。.!！?？])/g, "$1").trim();
}

/** 连线 + @提及 合并后的「实际生效角色」：连线优先（位置序），@提及补充未连线者，按名去重。 */
export function effectiveCharacters(
  targetId: string,
  prompt: string | undefined,
  edges: { source: string; target: string }[],
  nodes: CharNodeLike[],
): CharacterNodeData[] {
  const conn = connectedCharacters(targetId, edges, nodes);
  const seen = new Set(conn.map(charDisplayName));
  const extra = mentionedCharacters(prompt, nodes).filter((c) => !seen.has(charDisplayName(c)));
  return [...conn, ...extra];
}

function dedupeRefImages(chars: CharacterNodeData[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of chars) {
    for (const u of characterReferenceImages(c)) {
      if (!seen.has(u)) { seen.add(u); out.push(u); }
    }
  }
  return out;
}

/** PERSON 参考图（连线 + @提及，去重，连线优先）。 */
export function effectiveCharacterRefImages(
  targetId: string, prompt: string | undefined,
  edges: { source: string; target: string }[], nodes: CharNodeLike[],
): string[] {
  return dedupeRefImages(effectiveCharacters(targetId, prompt, edges, nodes).filter((c) => (c.characterKind ?? "person") !== "scene"));
}

/** SCENE 参考图（连线 + @提及，去重，连线优先）。 */
export function effectiveSceneRefImages(
  targetId: string, prompt: string | undefined,
  edges: { source: string; target: string }[], nodes: CharNodeLike[],
): string[] {
  return dedupeRefImages(effectiveCharacters(targetId, prompt, edges, nodes).filter((c) => (c.characterKind ?? "person") === "scene"));
}

/** First connected PERSON character's LoRA (name + strength), or null. Priority by
 *  position. Scene nodes carry no character LoRA. */
export function connectedCharacterLora(
  targetId: string,
  edges: { source: string; target: string }[],
  nodes: CharNodeLike[],
): { name: string; strengthModel: number } | null {
  for (const c of connectedCharacters(targetId, edges, nodes)) {
    if ((c.characterKind ?? "person") === "scene") continue;
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
  // A 场景 (scene) node is location context, not a face/subject — never wire its
  // image into IPAdapter face-lock or treat its data as a character LoRA.
  if ((character.characterKind ?? "person") === "scene") return patch;

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
