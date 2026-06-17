// localStorage-backed per-node-type setting templates. Lets a user save a
// configured node's payload (prompt / model / params …) under a name and re-apply
// it to another node of the same type later. Works for ALL node types — the
// payload shape is opaque here; we only strip transient/output fields so a saved
// "settings" template doesn't drag along generation results or huge base64 blobs.

export interface NodeTemplate {
  id: string;
  label: string;
  nodeType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const STORAGE_KEY = "nodeTemplates:v1";
const MAX_PER_TYPE = 30;
const MAX_LABEL_LEN = 32;
const MAX_JSON = 200_000; // cap a single template at ~200KB to stay clear of quota

// Fields excluded from a template — a template captures CONFIG parameters only
// (model / sampler / steps / cfg / size / arch …), never per-instance content.
// Excluded groups:
//   1) output / runtime state
//   2) prompts + content (正/反向提示词、脚本/分镜文案 等)
//   3) per-instance inputs (reference images, mask, seed)
const TRANSIENT_KEYS = new Set([
  // 1) output / runtime
  "pinned", "status", "progress", "error", "errorMessage",
  "taskId", "jobId", "promptId", "jobStatus",
  "generatedImageUrl", "imageUrl", "outputUrl", "resultUrl", "videoUrl",
  "resultVideoUrl", "outputUrls", "outputs", "history", "messages", "result", "results",
  // 2) prompts + content
  "prompt", "negPrompt", "negativePrompt", "positivePrompt", "promptText",
  "text", "content", "sceneDescription", "synopsis", "script", "caption",
  // 3) per-instance inputs
  "seed", "referenceImageUrl", "referenceImageUrls", "referenceImages",
  "maskUrl", "imageUrls",
]);

type Store = Record<string, NodeTemplate[]>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // quota exceeded / private mode — ignore
  }
}

// URL-ish keys whose string value gets bound to an href/src somewhere downstream.
// Imported template/canvas JSON is fully attacker-authored, so a `javascript:`/`data:`
// value here could reach an <a href> and execute on click. Drop unsafe-protocol
// values at ingestion (defense in depth alongside the render-time safeHref guard).
const UNSAFE_URL_PROTO = /^\s*(javascript|data|vbscript|file|blob):/i;
function isUrlKey(k: string): boolean {
  return k === "url" || /url$/i.test(k); // url, *Url, *URL
}

/** Drop transient/output fields, oversized strings (likely base64 data), and any
 *  URL-keyed field carrying an unsafe (script-capable) protocol. */
export function sanitizeTemplatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (TRANSIENT_KEYS.has(k) || v === undefined) continue;
    if (typeof v === "string" && v.length > 8000) continue;
    if (typeof v === "string" && isUrlKey(k) && UNSAFE_URL_PROTO.test(v)) continue;
    out[k] = v;
  }
  return out;
}

export function listNodeTemplates(nodeType: string): NodeTemplate[] {
  return read()[nodeType] ?? [];
}

export function saveNodeTemplate(
  nodeType: string,
  label: string,
  payload: Record<string, unknown>,
): NodeTemplate | null {
  const trimmed = label.trim().slice(0, MAX_LABEL_LEN);
  if (!trimmed) return null;
  const clean = sanitizeTemplatePayload(payload);
  const tpl: NodeTemplate = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: trimmed,
    nodeType,
    payload: clean,
    createdAt: new Date().toISOString(),
  };
  if (JSON.stringify(tpl).length > MAX_JSON) return null;
  const store = read();
  const list = store[nodeType] ?? [];
  if (list.length >= MAX_PER_TYPE) return null;
  store[nodeType] = [tpl, ...list];
  write(store);
  return tpl;
}

export function deleteNodeTemplate(nodeType: string, id: string): void {
  const store = read();
  const list = store[nodeType];
  if (!list) return;
  store[nodeType] = list.filter((t) => t.id !== id);
  write(store);
}

// ── File export / import ──────────────────────────────────────────────────────
// Lets a user store templates as a portable .json file (backup / share across
// machines or accounts), complementing the localStorage store.

interface NodeTemplateExport {
  version: 1;
  nodeType: string;
  exportedAt: string;
  templates: NodeTemplate[];
}

/** Serialize all templates of a node type to a JSON string, or null if there are none. */
export function exportNodeTemplatesJson(nodeType: string): string | null {
  const templates = listNodeTemplates(nodeType);
  if (templates.length === 0) return null;
  const data: NodeTemplateExport = { version: 1, nodeType, exportedAt: new Date().toISOString(), templates };
  return JSON.stringify(data, null, 2);
}

/**
 * Import templates from an exported JSON string into a node type. Accepts either
 * the `{ templates: [...] }` envelope or a bare array. Re-tags to the target
 * nodeType, re-generates ids, sanitizes payloads, dedupes by label, and respects
 * the per-type cap. Returns counts so the caller can report the result.
 */
export function importNodeTemplatesJson(nodeType: string, json: string): { imported: number; skipped: number } {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { imported: 0, skipped: 0 }; }
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object" && Array.isArray((parsed as { templates?: unknown }).templates))
      ? (parsed as { templates: unknown[] }).templates
      : [];
  if (arr.length === 0) return { imported: 0, skipped: 0 };
  const store = read();
  const list = store[nodeType] ?? [];
  const seenLabels = new Set(list.map((t) => t.label));
  let imported = 0, skipped = 0;
  for (const raw of arr) {
    if (list.length >= MAX_PER_TYPE) { skipped++; continue; }
    if (!raw || typeof raw !== "object") { skipped++; continue; }
    const r = raw as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim().slice(0, MAX_LABEL_LEN) : "";
    const payload = r.payload && typeof r.payload === "object" ? (r.payload as Record<string, unknown>) : null;
    if (!label || !payload || seenLabels.has(label)) { skipped++; continue; }
    const tpl: NodeTemplate = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label, nodeType, payload: sanitizeTemplatePayload(payload), createdAt: new Date().toISOString(),
    };
    if (JSON.stringify(tpl).length > MAX_JSON) { skipped++; continue; }
    list.unshift(tpl);
    seenLabels.add(label);
    imported++;
  }
  store[nodeType] = list;
  write(store);
  return { imported, skipped };
}
