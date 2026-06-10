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

/** Like detectUpstreamImages, but BATCH-EXPANDED: when a single upstream node holds a
 *  batch (image_gen / comfyui_image `imageUrls`, comfyui_workflow `outputUrls`), ALL of
 *  its images are collected in array order (not just the primary one). Same deterministic
 *  node ordering + kind-safe guards + global de-dup. Used to fill a character node's main
 *  + alternate-view reference images from connected upstream image producers. */
export function detectUpstreamImagesExpanded(targetId: string, edges: MiniEdge[], nodes: MiniNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = edges.map((e, i) => ({ e, i })).filter(({ e }) => e.target === targetId);
  incoming.sort((a, b) => compareUpstreamNodes(byId.get(a.e.source), byId.get(b.e.source), a.i, b.i));
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: unknown) => {
    if (typeof u === "string" && u.trim() && !seen.has(u)) { seen.add(u); out.push(u); }
  };
  for (const { e } of incoming) {
    const src = byId.get(e.source);
    if (!src || !IMAGE_SOURCE_TYPES.has(src.data.nodeType)) continue;
    const p = (src.data.payload ?? {}) as Record<string, unknown>;
    // Skip a comfyui_workflow that produced a video (kind-safe, mirrors getNodeImageUrl).
    if (src.data.nodeType === "comfyui_workflow" && p.outputType === "video") continue;
    // Batch field: image_gen/comfyui_image → imageUrls; comfyui_workflow → outputUrls.
    const batch = (p.imageUrls ?? p.outputUrls) as unknown;
    if (Array.isArray(batch) && batch.length > 0) {
      for (const u of batch) push(u);
    } else {
      push(getNodeImageUrl(src.data.nodeType, p)); // asset/storyboard/single-output fallback
    }
  }
  return out;
}

export interface UpstreamImageSource { id: string; title: string; url: string }

/** Connected upstream image sources (id + display title + url), in smart order.
 *  Powers the per-image-param「来源」picker. */
export function listUpstreamImageSources(targetId: string, edges: MiniEdge[], nodes: MiniNode[]): UpstreamImageSource[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = (edges as Array<{ source: string; target: string }>).map((e, i) => ({ e, i })).filter(({ e }) => e.target === targetId);
  incoming.sort((a, b) => compareUpstreamNodes(byId.get(a.e.source), byId.get(b.e.source), a.i, b.i));
  const out: UpstreamImageSource[] = [];
  const seen = new Set<string>();
  for (const { e } of incoming) {
    const src = byId.get(e.source);
    if (!src || seen.has(e.source) || !IMAGE_SOURCE_TYPES.has(src.data.nodeType)) continue;
    const url = getNodeImageUrl(src.data.nodeType, (src.data.payload ?? {}) as Record<string, unknown>);
    if (url) { seen.add(e.source); out.push({ id: e.source, title: src.data.title || e.source, url }); }
  }
  return out;
}

// ── Audio params (VHS_LoadAudioUpload 等) — 与 image 完全对称 ─────────────────
const AUDIO_SOURCE_TYPES = new Set(["audio", "asset"]);

/** Pick a node's audio-output URL (audio 节点 / 素材[音频]). */
function getNodeAudioUrl(nodeType: string, payload: Record<string, unknown>): string | undefined {
  if (nodeType === "asset") {
    const mt = payload.mimeType as string | undefined;
    const t = payload.type as string | undefined;
    if ((mt && !mt.startsWith("audio/")) || (t && t !== "audio")) return undefined;
    return payload.url as string | undefined;
  }
  if (nodeType === "audio") return payload.url as string | undefined;
  return undefined;
}

export interface UpstreamAudioSource { id: string; title: string; url: string }

/** 连入 targetId 的上游音频来源（id + 标题 + url），智能排序。供音频参数「来源」下拉用。 */
export function listUpstreamAudioSources(targetId: string, edges: MiniEdge[], nodes: MiniNode[]): UpstreamAudioSource[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = (edges as Array<{ source: string; target: string }>).map((e, i) => ({ e, i })).filter(({ e }) => e.target === targetId);
  incoming.sort((a, b) => compareUpstreamNodes(byId.get(a.e.source), byId.get(b.e.source), a.i, b.i));
  const out: UpstreamAudioSource[] = [];
  const seen = new Set<string>();
  for (const { e } of incoming) {
    const src = byId.get(e.source);
    if (!src || seen.has(e.source) || !AUDIO_SOURCE_TYPES.has(src.data.nodeType)) continue;
    const url = getNodeAudioUrl(src.data.nodeType, (src.data.payload ?? {}) as Record<string, unknown>);
    if (url) { seen.add(e.source); out.push({ id: e.source, title: src.data.title || e.source, url }); }
  }
  return out;
}

// ── Video params — 与 audio 完全对称（视频任务输出 / comfy 视频 / 素材[视频]）─────
const VIDEO_SOURCE_TYPES = new Set(["video_task", "comfyui_video", "asset"]);

/** Pick a node's video-output URL（video_task / comfyui_video / 素材[视频]）。 */
function getNodeVideoUrl(nodeType: string, payload: Record<string, unknown>): string | undefined {
  if (nodeType === "asset") {
    const mt = payload.mimeType as string | undefined;
    const t = payload.type as string | undefined;
    if ((mt && !mt.startsWith("video/")) || (t && t !== "video")) return undefined;
    return payload.url as string | undefined;
  }
  if (nodeType === "video_task" || nodeType === "comfyui_video") {
    const u = (payload.resultVideoUrl ?? payload.outputUrl ?? payload.url) as string | undefined;
    return typeof u === "string" && u.trim() ? u : undefined;
  }
  return undefined;
}

export interface UpstreamVideoSource { id: string; title: string; url: string }

/** 连入 targetId 的上游视频来源（id + 标题 + url），智能排序。供视频参考吸附栏 / 来源下拉用。 */
export function listUpstreamVideoSources(targetId: string, edges: MiniEdge[], nodes: MiniNode[]): UpstreamVideoSource[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = (edges as Array<{ source: string; target: string }>).map((e, i) => ({ e, i })).filter(({ e }) => e.target === targetId);
  incoming.sort((a, b) => compareUpstreamNodes(byId.get(a.e.source), byId.get(b.e.source), a.i, b.i));
  const out: UpstreamVideoSource[] = [];
  const seen = new Set<string>();
  for (const { e } of incoming) {
    const src = byId.get(e.source);
    if (!src || seen.has(e.source) || !VIDEO_SOURCE_TYPES.has(src.data.nodeType)) continue;
    const url = getNodeVideoUrl(src.data.nodeType, (src.data.payload ?? {}) as Record<string, unknown>);
    if (url) { seen.add(e.source); out.push({ id: e.source, title: src.data.title || e.source, url }); }
  }
  return out;
}

// ── @音频名 / @视频名：引用画布上「独立」音/视频节点（无需连线）──────────────────
// 与「@角色名」对称：在文本框 @某个音频/视频节点的标题，即把该媒体计入参考。媒体节点的
// 「名字」用节点标题（node.data.title）。供 omni / 数字人 / 动作控制等模型用。

export type MediaKind = "audio" | "video" | "image";
export interface CanvasMediaSource { id: string; name: string; url: string; kind: MediaKind }

/** 画布上所有可 @引用 的独立音/视频/图像媒体节点（有标题 + 媒体 URL），按名去重。
 *  优先级：音频 > 视频 > 图像（同名同节点只归一类，避免一个节点既算音频又算图像）。 */
export function listCanvasMediaSources(nodes: MiniNode[]): CanvasMediaSource[] {
  const out: CanvasMediaSource[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const name = (n.data.title ?? "").trim();
    if (!name) continue;
    const payload = (n.data.payload ?? {}) as Record<string, unknown>;
    const aud = getNodeAudioUrl(n.data.nodeType, payload);
    if (aud && !seen.has("a:" + name)) { seen.add("a:" + name); out.push({ id: n.id, name, url: aud, kind: "audio" }); continue; }
    const vid = getNodeVideoUrl(n.data.nodeType, payload);
    if (vid && !seen.has("v:" + name)) { seen.add("v:" + name); out.push({ id: n.id, name, url: vid, kind: "video" }); continue; }
    const img = getNodeImageUrl(n.data.nodeType, payload);
    if (img && !seen.has("i:" + name)) { seen.add("i:" + name); out.push({ id: n.id, name, url: img, kind: "image" }); }
  }
  return out;
}

/** prompt 里被「@名字」提及到的媒体来源（按 kind 过滤，去重，含 id/name/url）。长名优先消费，避免短名命中长名内部。 */
export function mentionedMediaSources(prompt: string | undefined, kind: MediaKind, nodes: MiniNode[]): CanvasMediaSource[] {
  let scan = prompt ?? "";
  if (!scan.includes("@")) return [];
  const sources = listCanvasMediaSources(nodes).filter((s) => s.kind === kind).sort((a, b) => b.name.length - a.name.length);
  const out: CanvasMediaSource[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const token = "@" + s.name;
    if (!scan.includes(token)) continue;
    scan = scan.split(token).join(" ");
    if (!seen.has(s.url)) { seen.add(s.url); out.push(s); }
  }
  return out;
}

/** prompt 里被「@名字」提及到的媒体 URL（按 kind 过滤，去重）。 */
export function mentionedMediaUrls(prompt: string | undefined, kind: MediaKind, nodes: MiniNode[]): string[] {
  return mentionedMediaSources(prompt, kind, nodes).map((s) => s.url);
}

/** 去掉 prompt 里所有被提及的「@媒体名」字面量（与 stripCharacterMentions 同理，避免模型读到 "@名字"）。 */
export function stripMediaMentions(prompt: string | undefined, nodes: MiniNode[]): string {
  let text = prompt ?? "";
  if (!text.includes("@")) return text;
  const names = listCanvasMediaSources(nodes).map((s) => s.name).sort((a, b) => b.length - a.length);
  for (const name of names) text = text.split("@" + name).join(" ");
  return text.replace(/[ \t]{2,}/g, " ").trim();
}

/** 解析音频参数：显式来源映射优先，剩余空位按顺序自动填充。镜像 resolveImageParamsWithMap。 */
export function resolveAudioParamsWithMap(
  bindings: WorkflowParamBinding[] | undefined,
  paramValues: Record<string, unknown>,
  sources: UpstreamAudioSource[],
  sourceMap: Record<string, string> = {},
): { paramValues: Record<string, unknown>; audioParamKeys: string[] } {
  const audioBindings = (bindings ?? []).filter((b) => b.type === "audio");
  const audioParamKeys = audioBindings.map((b) => `${b.nodeId}.${b.fieldPath}`);
  const next = { ...paramValues };
  const mappedIds = new Set(Object.values(sourceMap));
  const autoUrls = sources.filter((s) => !mappedIds.has(s.id)).map((s) => s.url);
  let ai = 0;
  for (const b of audioBindings) {
    const key = `${b.nodeId}.${b.fieldPath}`;
    if (!isParamAtDefault(next[key], b)) continue; // 用户已填的值不覆盖
    const mappedId = sourceMap[key];
    if (mappedId) {
      const s = sources.find((x) => x.id === mappedId);
      if (s) { next[key] = s.url; continue; }
    }
    if (ai < autoUrls.length) next[key] = autoUrls[ai++];
  }
  return { paramValues: next, audioParamKeys };
}

/** Resolve image params from an EXPLICIT source map (paramKey → upstream nodeId)
 *  first, then auto-fill remaining blanks from the unused sources in smart order.
 *  User-typed values are never overwritten. */
export function resolveImageParamsWithMap(
  bindings: WorkflowParamBinding[] | undefined,
  paramValues: Record<string, unknown>,
  sources: UpstreamImageSource[],
  sourceMap: Record<string, string> = {},
): { paramValues: Record<string, unknown>; imageParamKeys: string[] } {
  const imageBindings = (bindings ?? []).filter((b) => b.type === "image");
  const imageParamKeys = imageBindings.map((b) => `${b.nodeId}.${b.fieldPath}`);
  const next = { ...paramValues };
  const mappedIds = new Set(Object.values(sourceMap));
  const autoUrls = sources.filter((s) => !mappedIds.has(s.id)).map((s) => s.url);
  let ai = 0;
  for (const b of imageBindings) {
    const key = `${b.nodeId}.${b.fieldPath}`;
    if (!isParamAtDefault(next[key], b)) continue; // genuine user edit → keep
    const mappedId = sourceMap[key];
    if (mappedId) {
      const s = sources.find((x) => x.id === mappedId);
      if (s) { next[key] = s.url; continue; }
    }
    if (ai < autoUrls.length) next[key] = autoUrls[ai++];
  }
  return { paramValues: next, imageParamKeys };
}

const PROMPT_SOURCE_TYPES = new Set(["prompt", "storyboard", "script", "ai_chat"]);

const _str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Auto-detect positive / negative prompt text from upstream text-producing
 *  nodes wired into targetId (first match each).
 *
 *  A `comfyui_workflow` node is treated as a TRANSPARENT prompt forwarder: it
 *  re-emits the prompt it effectively uses (its own typed prompt param, or — when
 *  blank / 上游优先 — the prompt from ITS upstream, recursively). This lets a chain
 *  of workflow nodes carry the prompt downstream. `_visited` guards against cycles. */
export function detectUpstreamPrompt(
  targetId: string,
  edges: MiniEdge[],
  nodes: MiniNode[],
  _visited: Set<string> = new Set(),
): { positive?: string; negative?: string } {
  if (_visited.has(targetId)) return {};
  _visited.add(targetId);
  let positive: string | undefined;
  let negative: string | undefined;
  const str = _str;
  for (const edge of edges) {
    if (edge.target !== targetId) continue;
    const src = nodes.find((n) => n.id === edge.source);
    if (!src) continue;
    const p = (src.data.payload ?? {}) as Record<string, unknown>;
    let pos: string | undefined;
    let neg: string | undefined;
    if (src.data.nodeType === "comfyui_workflow") {
      const fwd = resolveWorkflowOutputPrompt(src, edges, nodes, _visited);
      pos = fwd.positive; neg = fwd.negative;
    } else if (PROMPT_SOURCE_TYPES.has(src.data.nodeType)) {
      switch (src.data.nodeType) {
        case "prompt": {
          pos = str(p.positivePrompt);
          neg = str(p.negativePrompt);
          // Style / aspect-ratio opt into the outgoing prompt text via per-field
          // checkboxes (the 提示词 node is text-only — it has no separate downstream
          // channel for these), appended after the positive prompt.
          const extras: string[] = [];
          if (p.passStyle && str(p.style)) extras.push(str(p.style)!);
          if (p.passRatio && str(p.aspectRatio)) extras.push(str(p.aspectRatio)!);
          if (extras.length) pos = [pos, ...extras].filter(Boolean).join(", ");
          break;
        }
        // Forward the storyboard's REFINED image prompt (promptText) — the same text
        // it generates its own image from — so a downstream comfyui node stays
        // consistent with it. Fall back to the raw scene description when not yet
        // expanded (preserves prior behavior).
        case "storyboard": pos = str(p.promptText) ?? str(p.description); neg = str(p.negativePrompt); break;
        case "script": pos = str(p.content); break;
        case "ai_chat": {
          const msgs = Array.isArray(p.messages) ? (p.messages as Array<{ role?: string; content?: string }>) : [];
          const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
          pos = str(lastAssistant?.content);
          break;
        }
      }
    } else {
      continue;
    }
    positive ??= pos;
    negative ??= neg;
    if (positive && negative) break;
  }
  return { positive, negative };
}

/** The positive / negative prompt a `comfyui_workflow` node effectively uses and
 *  thus forwards downstream. Mirrors the run-time rule in fillWorkflowPromptParams:
 *  with 上游优先 (preferUpstreamPrompt !== false) an upstream prompt wins over the
 *  node's own param value; otherwise the node's own value wins unless blank/default. */
function resolveWorkflowOutputPrompt(
  node: MiniNode,
  edges: MiniEdge[],
  nodes: MiniNode[],
  visited: Set<string>,
): { positive?: string; negative?: string } {
  const payload = (node.data.payload ?? {}) as {
    paramBindings?: WorkflowParamBinding[];
    paramValues?: Record<string, unknown>;
    preferUpstreamPrompt?: boolean;
    forwardPrompt?: boolean;
  };
  // Forwarding is opt-out: a node with forwardPrompt === false stops the prompt here.
  if (payload.forwardPrompt === false) return {};
  const texts = (payload.paramBindings ?? []).filter((b) => b.type === "text");
  const isNeg = (b: WorkflowParamBinding) => b.role === "negative" || (!b.role && /负|negative/i.test(b.label));
  const posB = texts.find((b) => b.role === "positive")
    ?? texts.find((b) => !b.role && /提示词|prompt/i.test(b.label) && !isNeg(b))
    ?? texts.find((b) => !isNeg(b));
  const negB = texts.find((b) => b.role === "negative") ?? texts.find(isNeg);
  const force = payload.preferUpstreamPrompt !== false;
  const values = payload.paramValues ?? {};
  const upstream = detectUpstreamPrompt(node.id, edges, nodes, visited);
  const ownVal = (b: WorkflowParamBinding | undefined) => (b ? _str(values[`${b.nodeId}.${b.fieldPath}`]) : undefined);
  const pick = (b: WorkflowParamBinding | undefined, up: string | undefined) => {
    const own = ownVal(b);
    if (force) return up ?? own; // 上游优先：upstream wins, fall back to own
    // 仅填空：own value wins unless it's blank or still the workflow's built-in default
    return b && !isParamAtDefault(values[`${b.nodeId}.${b.fieldPath}`], b) ? own : (up ?? own);
  };
  return { positive: pick(posB, upstream.positive), negative: pick(negB, upstream.negative) };
}

/** A param is "overridable by an explicitly connected upstream node" when it is
 *  blank OR still holds the workflow's built-in default (b.defaultValue) — i.e.
 *  the user hasn't deliberately typed/picked a different value. Connecting an
 *  upstream node is a clear signal it should drive that param, so upstream wins
 *  over the workflow's baked-in defaults while genuine user edits are preserved.
 *  Shared by the prompt-text and image auto-fill paths for consistent behavior. */
export function isParamAtDefault(cur: unknown, b: WorkflowParamBinding): boolean {
  return cur == null || cur === "" || (b.defaultValue != null && cur === b.defaultValue);
}

/**
 * Compute the paramValues to actually submit plus the list of image-param keys.
 * Image params that are blank or at their built-in default are filled with
 * `upstreamImageUrl` when available; the returned `imageParamKeys` tells the
 * server which params to upload-as-image.
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
    if (isParamAtDefault(next[key], b)) { next[key] = urls[i]; i++; }
  }
  return { paramValues: next, imageParamKeys };
}

/** Fill the workflow's exposed LoRA-name param from a connected character's LoRA.
 *  Targets the binding whose fieldPath/label looks like a LoRA model selector
 *  (`lora_name` / 「LoRA 模型」). Fill-only-when-blank or at the built-in default —
 *  a value the user picked is preserved. Returns the (possibly) updated values. */
export function fillWorkflowLoraParam(
  bindings: WorkflowParamBinding[] | undefined,
  paramValues: Record<string, unknown>,
  loraName: string | undefined,
): Record<string, unknown> {
  if (!loraName) return paramValues;
  const b = (bindings ?? []).find((x) =>
    (x.type === "select" || x.type === "text") &&
    (/lora_name$/i.test(x.fieldPath) || /lora/i.test(x.label)) &&
    !/strength|权重|强度/i.test(x.label));
  if (!b) return paramValues;
  const key = `${b.nodeId}.${b.fieldPath}`;
  if (!isParamAtDefault(paramValues[key], b)) return paramValues; // user-picked → keep
  return { ...paramValues, [key]: loraName };
}

/** The workflow's positive-prompt param key (`nodeId.fieldPath`), or null. Same
 *  resolution as fillWorkflowPromptParams' posB — exported so callers can AUGMENT
 *  the effective positive (e.g. prepend character identity) without replacing it. */
export function positivePromptParamKey(bindings: WorkflowParamBinding[] | undefined): string | null {
  const texts = (bindings ?? []).filter((b) => b.type === "text");
  const isNeg = (b: WorkflowParamBinding) => b.role === "negative" || (!b.role && /负|negative/i.test(b.label));
  const posB = texts.find((b) => b.role === "positive")
    ?? texts.find((b) => !b.role && /提示词|prompt/i.test(b.label) && !isNeg(b))
    ?? texts.find((b) => !isNeg(b));
  return posB ? `${posB.nodeId}.${posB.fieldPath}` : null;
}

/** Fill blank positive / negative prompt params from upstream prompt text.
 *  Positive param = first text binding labelled 提示词 (not 负…); negative =
 *  first labelled 负…. Only fills params the user hasn't set. */
export function fillWorkflowPromptParams(
  bindings: WorkflowParamBinding[] | undefined,
  paramValues: Record<string, unknown>,
  prompts: { positive?: string; negative?: string },
  opts?: { force?: boolean },
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
  // Fill when the param is blank OR still holds the workflow's BUILT-IN default
  // (b.defaultValue) — so a workflow whose positive CLIPTextEncode ships with
  // default text (e.g. "一个女孩在操场上") doesn't silently ignore an explicitly
  // connected upstream prompt node. A value the user deliberately typed in the
  // node (i.e. differing from the default) is preserved, matching prior behavior.
  // `force` (上游提示词优先): override even a user-typed value whenever an upstream
  // prompt exists. Default = fill only when blank / at the workflow's built-in default.
  const set = (b: WorkflowParamBinding | undefined, v: string | undefined) => {
    if (!b || !v) return;
    const key = `${b.nodeId}.${b.fieldPath}`;
    if (opts?.force || isParamAtDefault(next[key], b)) next[key] = v;
  };
  set(posB, prompts.positive);
  set(negB, prompts.negative);
  return next;
}
