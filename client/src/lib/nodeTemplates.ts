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

// Output / runtime fields that aren't "settings" — excluded from templates.
const TRANSIENT_KEYS = new Set([
  "pinned", "status", "progress", "error", "errorMessage",
  "taskId", "jobId", "promptId", "jobStatus",
  "generatedImageUrl", "imageUrl", "outputUrl", "resultUrl", "videoUrl",
  "outputs", "history", "messages", "result", "results",
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

/** Drop transient/output fields and oversized strings (likely base64 data). */
export function sanitizeTemplatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (TRANSIENT_KEYS.has(k) || v === undefined) continue;
    if (typeof v === "string" && v.length > 8000) continue;
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
