// Client-side helpers for the ComfyUI node template library. Persistence now
// lives in the database (shared across all users) via the `comfyTemplates`
// tRPC router — this module only holds the render helpers (color / default
// name / model summary) and re-exports the shared types + payload sanitizer.

import { getNodeConfig } from "./nodeConfig";
import { summarizeComfyWorkflow } from "./comfyWorkflowSummary";
import type { NodeType } from "../../../shared/types";
import type { ComfyNodeType } from "../../../shared/comfyNodeTemplate";

export {
  COMFY_NODE_TYPES, isComfyNodeType, sanitizeComfyPayload, COMFY_TEMPLATE_LIMITS, extractComfyThumbnail,
} from "../../../shared/comfyNodeTemplate";
export type { ComfyNodeType, ComfyNodeTemplate } from "../../../shared/comfyNodeTemplate";

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

/** Human-readable model / parameter summary for a template (panel + save dialog). */
export function describeComfyTemplate(nodeType: ComfyNodeType, payload: Record<string, unknown>): string {
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  if (nodeType === "comfyui_workflow") {
    const s = summarizeComfyWorkflow(str(payload.workflowJson) || undefined);
    return s.ok ? s.brief : "未加载工作流";
  }
  const parts: string[] = [];
  const tpl = str(payload.workflowTemplate);
  if (tpl) parts.push(tpl);
  const ckpt = str(payload.ckpt);
  if (ckpt) parts.push(modelBaseName(ckpt));
  const lora = str(payload.lora);
  if (lora) parts.push(`LoRA ${modelBaseName(lora)}`);
  const prompt = str(payload.prompt);
  if (prompt) parts.push(`"${prompt.slice(0, 40)}${prompt.length > 40 ? "…" : ""}"`);
  return parts.length > 0 ? parts.join(" · ") : "无参数";
}
