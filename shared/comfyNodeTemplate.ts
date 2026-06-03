// Shared (React-free) types + payload sanitization for the ComfyUI node template
// library. Imported by BOTH the client lib and the server router so payload
// stripping / validation is identical on save (defense in depth — the server
// re-sanitizes whatever the client sends).

export type ComfyNodeType = "comfyui_image" | "comfyui_video" | "comfyui_workflow";

export const COMFY_NODE_TYPES: ComfyNodeType[] = ["comfyui_image", "comfyui_video", "comfyui_workflow"];

export function isComfyNodeType(t: string | undefined | null): t is ComfyNodeType {
  return t === "comfyui_image" || t === "comfyui_video" || t === "comfyui_workflow";
}

export const COMFY_TEMPLATE_LIMITS = {
  MAX_LABEL_LEN: 64,
  MAX_NOTE_LEN: 300,
  MAX_JSON: 1_200_000,   // ~1.2MB per template — workflow JSON can be large
} as const;

const MAX_STR = 8000;                          // skip oversized strings (likely base64) …
const KEEP_LARGE = new Set(["workflowJson"]);  // … except the workflow definition

// Runtime / output fields — everything else (prompts, params, models, workflow
// JSON, server addresses) is preserved so the node re-creates fully configured.
const RUNTIME_KEYS = new Set([
  "status", "progress", "error", "errorMessage",
  "taskId", "externalTaskId", "promptId", "jobId", "jobStatus", "messages",
  "outputUrl", "outputUrls", "outputDuration",
  "imageUrl", "imageStorageKey", "imageHistory", "imageUrls", "selectedImageIndex",
  "resultVideoUrl", "resultStorageKey", "url", "storageKey",
  "pinned",
  // per-instance corner annotation — a saved template gets its own name instead
  "templateLabel",
]);

/** Strip runtime/output fields and oversized strings (keep the workflow JSON). */
export function sanitizeComfyPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (RUNTIME_KEYS.has(k) || v === undefined) continue;
    if (typeof v === "string" && v.length > MAX_STR && !KEEP_LARGE.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Shape returned to the client by the comfyTemplates router. */
export interface ComfyNodeTemplate {
  id: number;
  label: string;
  nodeType: ComfyNodeType;
  payload: Record<string, unknown>;
  note?: string;
  /** Generated-image URL captured at save (shown on cards; excluded from export). */
  thumbnail?: string;
  useCloud?: boolean;
  /** Creator (for ownership-based edit/delete) + display name. */
  userId: number;
  creatorName?: string;
  createdAt: string;
}

/** Capture a thumbnail (generated IMAGE url) from a node's LIVE payload at save
 *  time. Only image outputs yield a thumbnail; video outputs return undefined.
 *  Rejects data: URLs / oversized strings to keep the DB row small. */
export function extractComfyThumbnail(nodeType: ComfyNodeType, payload: Record<string, unknown>): string | undefined {
  const ok = (u: unknown): u is string =>
    typeof u === "string" && u.length > 0 && u.length < 2048 && (/^https?:\/\//i.test(u) || u.startsWith("/"));
  const firstOk = (...cands: unknown[]): string | undefined => {
    for (const c of cands) {
      if (ok(c)) return c;
      if (Array.isArray(c) && ok(c[0])) return c[0] as string;
    }
    return undefined;
  };
  if (nodeType === "comfyui_workflow") {
    if (payload.outputType === "video") return undefined; // video output → no still
    return firstOk(payload.outputUrls, payload.outputUrl);
  }
  if (nodeType === "comfyui_image") {
    return firstOk(payload.imageUrl, payload.imageUrls);
  }
  return undefined; // comfyui_video → result is a video, no still thumbnail
}
