// localStorage-backed "node parameter templates" for the three ComfyUI node
// types (comfyui_image / comfyui_video / comfyui_workflow). Unlike the generic
// per-type setting templates in nodeTemplates.ts, these KEEP prompts and the
// full workflow JSON — the goal is to re-create a fully-configured node (like
// duplicating it) from a library panel. Only runtime/output state is stripped.

import { getNodeConfig } from "./nodeConfig";
import { summarizeComfyWorkflow } from "./comfyWorkflowSummary";
import type { NodeType } from "../../../shared/types";

export type ComfyNodeType = "comfyui_image" | "comfyui_video" | "comfyui_workflow";

export const COMFY_NODE_TYPES: ComfyNodeType[] = ["comfyui_image", "comfyui_video", "comfyui_workflow"];

export function isComfyNodeType(t: string | undefined): t is ComfyNodeType {
  return t === "comfyui_image" || t === "comfyui_video" || t === "comfyui_workflow";
}

export interface ComfyNodeTemplate {
  id: string;
  label: string;
  nodeType: ComfyNodeType;
  payload: Record<string, unknown>;
  /** comfyui_workflow only: local (green) vs cloud (blue) — drives the card color. */
  useCloud?: boolean;
  createdAt: string;
}

const STORAGE_KEY = "comfyNodeTemplates:v1";
const MAX_TOTAL = 60;
const MAX_LABEL_LEN = 40;
const MAX_JSON = 1_200_000;   // ~1.2MB per template — workflow JSON can be large
const MAX_STR = 8000;         // skip oversized strings (likely base64) …
const KEEP_LARGE = new Set(["workflowJson"]); // … except the workflow definition

// Runtime / output fields — everything else (prompts, params, models, workflow
// JSON, server addresses) is preserved so the node re-creates fully configured.
const RUNTIME_KEYS = new Set([
  "status", "progress", "error", "errorMessage",
  "taskId", "externalTaskId", "promptId", "jobId", "jobStatus", "messages",
  "outputUrl", "outputUrls", "outputDuration",
  "imageUrl", "imageStorageKey", "imageHistory", "imageUrls", "selectedImageIndex",
  "resultVideoUrl", "resultStorageKey", "url", "storageKey",
  "pinned",
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

/** Border / dot color for a template card — 4 colors across the 3 node types
 *  (comfyui_workflow splits into local-green vs cloud-blue). */
export function colorForTemplate(nodeType: ComfyNodeType, useCloud?: boolean): string {
  if (nodeType === "comfyui_workflow" && useCloud) return "oklch(0.68 0.16 235)"; // cloud blue
  return getNodeConfig(nodeType as NodeType).color;
}

function modelBaseName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, "");
}

/** Suggested default template name when saving — auto-derived from the node's
 *  model: the workflow's main checkpoint (custom flow), or the configured
 *  checkpoint / motion module / template (image & video). Empty if none found,
 *  so the caller can fall back to the node title. */
export function suggestComfyTemplateName(nodeType: ComfyNodeType, payload: Record<string, unknown>): string {
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  if (nodeType === "comfyui_workflow") {
    const s = summarizeComfyWorkflow(str(payload.workflowJson) || undefined);
    if (s.checkpoints[0]) return s.checkpoints[0];
    return str(payload.workflowName);
  }
  const ckpt = str(payload.ckpt);
  if (ckpt) return modelBaseName(ckpt);
  const motion = str((payload as { motionModule?: unknown }).motionModule);
  if (motion) return modelBaseName(motion);
  return str((payload as { workflowTemplate?: unknown }).workflowTemplate);
}

function read(): ComfyNodeTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ComfyNodeTemplate[]) : [];
  } catch {
    return [];
  }
}

function write(list: ComfyNodeTemplate[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false; // quota exceeded / private mode
  }
}

export function listComfyNodeTemplates(): ComfyNodeTemplate[] {
  return read();
}

export function saveComfyNodeTemplate(
  nodeType: ComfyNodeType,
  label: string,
  payload: Record<string, unknown>,
  useCloud?: boolean,
): ComfyNodeTemplate | null {
  const trimmed = label.trim().slice(0, MAX_LABEL_LEN);
  if (!trimmed) return null;
  const tpl: ComfyNodeTemplate = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: trimmed,
    nodeType,
    payload: sanitizeComfyPayload(payload),
    useCloud: nodeType === "comfyui_workflow" ? !!useCloud : undefined,
    createdAt: new Date().toISOString(),
  };
  if (JSON.stringify(tpl).length > MAX_JSON) return null;
  const list = read();
  if (list.length >= MAX_TOTAL) return null;
  const next = [tpl, ...list];
  if (!write(next)) return null;
  return tpl;
}

export function deleteComfyNodeTemplate(id: string): void {
  write(read().filter((t) => t.id !== id));
}

// ── File export / import ──────────────────────────────────────────────────────

interface ComfyNodeTemplateExport {
  version: 1;
  kind: "comfyNodeTemplates";
  exportedAt: string;
  templates: ComfyNodeTemplate[];
}

export function exportComfyNodeTemplatesJson(): string | null {
  const templates = read();
  if (templates.length === 0) return null;
  const data: ComfyNodeTemplateExport = {
    version: 1, kind: "comfyNodeTemplates", exportedAt: new Date().toISOString(), templates,
  };
  return JSON.stringify(data, null, 2);
}

export function importComfyNodeTemplatesJson(json: string): { imported: number; skipped: number } {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { imported: 0, skipped: 0 }; }
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object" && Array.isArray((parsed as { templates?: unknown }).templates))
      ? (parsed as { templates: unknown[] }).templates
      : [];
  if (arr.length === 0) return { imported: 0, skipped: 0 };
  const list = read();
  let imported = 0, skipped = 0;
  for (const raw of arr) {
    if (list.length >= MAX_TOTAL) { skipped++; continue; }
    if (!raw || typeof raw !== "object") { skipped++; continue; }
    const r = raw as Record<string, unknown>;
    const nodeType = r.nodeType;
    const label = typeof r.label === "string" ? r.label.trim().slice(0, MAX_LABEL_LEN) : "";
    const payload = r.payload && typeof r.payload === "object" ? (r.payload as Record<string, unknown>) : null;
    if (!label || !payload || !isComfyNodeType(typeof nodeType === "string" ? nodeType : undefined)) { skipped++; continue; }
    const tpl: ComfyNodeTemplate = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      nodeType: nodeType as ComfyNodeType,
      payload: sanitizeComfyPayload(payload),
      useCloud: nodeType === "comfyui_workflow" ? !!r.useCloud : undefined,
      createdAt: new Date().toISOString(),
    };
    if (JSON.stringify(tpl).length > MAX_JSON) { skipped++; continue; }
    list.unshift(tpl);
    imported++;
  }
  write(list);
  return { imported, skipped };
}
