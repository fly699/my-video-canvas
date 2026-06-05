import { analyzeWorkflow } from "./comfyui";
import { invokeLLM, extractTextContent } from "./llm";
import * as db from "../db";
import type { ComfyNodeTemplateRow, InsertComfyTemplateAnalysis } from "../../drizzle/schema";
import type { WorkflowParamBinding } from "../../shared/types";

// Bump when the analysis algorithm/output shape changes so the incremental
// re-analysis (analyzeLibrary) re-processes older rows.
// v2: added per-shot video duration (maxFrames/fps) for agent scene planning.
export const CURRENT_ANALYSIS_VERSION = 2;

const MODEL_FIELD_HINTS = ["ckpt_name", "unet_name", "lora_name", "vae_name", "model_name"];

/** Pull model file names out of detected select-params (checkpoints/unet/lora/vae). */
function modelNamesFromParams(params: WorkflowParamBinding[]): string[] {
  const names = new Set<string>();
  for (const p of params) {
    if (MODEL_FIELD_HINTS.some((h) => p.fieldPath.includes(h)) && typeof p.defaultValue === "string" && p.defaultValue) {
      names.add(p.defaultValue);
    }
  }
  return Array.from(names);
}

/**
 * Analyze one ComfyUI template: structural parse (analyzeWorkflow) + an LLM
 * functional summary. Degrades gracefully when there is no workflowJson or the
 * structural parse fails. Returns a row ready for upsertComfyTemplateAnalysis.
 */
export async function analyzeTemplate(template: ComfyNodeTemplateRow, model: string): Promise<InsertComfyTemplateAnalysis> {
  const payload = (template.payload ?? {}) as Record<string, unknown>;
  const workflowJson = typeof payload.workflowJson === "string" ? payload.workflowJson : undefined;

  let outputType: "image" | "video" | "mixed" = template.nodeType === "comfyui_video" ? "video" : "image";
  let params: WorkflowParamBinding[] = [];
  let videoCaps: { maxFrames: number; fps: number } | undefined;
  if (workflowJson) {
    try {
      const a = await analyzeWorkflow(workflowJson); // offline: no baseUrl
      outputType = a.outputType;
      params = a.detectedParams;
      videoCaps = a.videoCapabilities;
    } catch { /* keep nodeType-derived outputType, no params */ }
  }

  // Resolve per-shot video duration (frames/fps). Prefer the workflow-derived
  // values; else read the saved comfyui_video node payload; else fall back to the
  // built-in template defaults (comfyui.ts buildVideoWorkflow). Left null for
  // image-only templates so the agent simply treats them as unconstrained.
  const { maxFrames, fps } = resolveVideoCaps(template, payload, videoCaps, outputType);

  // Model names: from params, else from common payload fields.
  let modelNames = modelNamesFromParams(params);
  if (modelNames.length === 0) {
    for (const k of ["ckpt", "unet", "motionModule", "vae"]) {
      const v = payload[k];
      if (typeof v === "string" && v) modelNames.push(v);
    }
    modelNames = Array.from(new Set(modelNames));
  }

  // LLM functional summary (JSON-prompt + regex parse — proven pattern here).
  let functionSummary = template.note?.trim() || template.label;
  let capabilities: string[] = [];
  try {
    const paramBrief = params.slice(0, 30).map((p) => `${p.label}(${p.type}${p.role ? `,${p.role}` : ""})`).join("; ");
    const sys = `你是 ComfyUI 工作流专家。根据给定模板信息，用中文总结其功能与能力。严格只输出一个 JSON 对象（无 markdown、无多余文字）：{"functionSummary":"一句话功能说明","capabilities":["能力标签",...]}。capabilities 示例：文生图、图生图、文生视频、图生视频、LoRA微调、ControlNet、放大、换脸、风格迁移。`;
    const user = `模板名：${template.label}
节点类型：${template.nodeType}
输出类型：${outputType}
模型：${modelNames.join(", ") || "未知"}
备注：${template.note || "无"}
可编辑参数：${paramBrief || "无"}
${workflowJson ? `工作流JSON(截断)：\n${workflowJson.slice(0, 6000)}` : ""}`;
    const resp = await invokeLLM({
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      model,
      maxTokens: 800,
    });
    const text = extractTextContent(resp);
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]) as { functionSummary?: unknown; capabilities?: unknown };
      if (typeof parsed.functionSummary === "string" && parsed.functionSummary.trim()) functionSummary = parsed.functionSummary.trim();
      if (Array.isArray(parsed.capabilities)) capabilities = parsed.capabilities.filter((c): c is string => typeof c === "string").slice(0, 12);
    }
  } catch { /* LLM failed → keep label/note-based summary */ }

  return {
    templateId: template.id,
    functionSummary,
    capabilities,
    outputType,
    hasVideoOutput: outputType !== "image",
    modelNames,
    maxFrames,
    fps,
    analysisVersion: CURRENT_ANALYSIS_VERSION,
    model,
    analyzedAt: new Date(),
  };
}

// Built-in comfyui_video template per-shot frames/fps (mirrors the defaults in
// comfyui.ts buildVideoWorkflow): Wan 81@16≈5s, LTXV 97@25≈3.9s, AnimateDiff/SVD 16@8=2s.
const BUILTIN_VIDEO_DEFAULTS: Record<string, { maxFrames: number; fps: number }> = {
  wan_t2v: { maxFrames: 81, fps: 16 },
  wan_i2v: { maxFrames: 81, fps: 16 },
  ltxv: { maxFrames: 97, fps: 25 },
  animatediff: { maxFrames: 16, fps: 8 },
  svd: { maxFrames: 16, fps: 8 },
};

function resolveVideoCaps(
  template: ComfyNodeTemplateRow,
  payload: Record<string, unknown>,
  fromWorkflow: { maxFrames: number; fps: number } | undefined,
  outputType: "image" | "video" | "mixed",
): { maxFrames: number | null; fps: number | null } {
  if (fromWorkflow) return { maxFrames: fromWorkflow.maxFrames, fps: fromWorkflow.fps };
  if (outputType === "image") return { maxFrames: null, fps: null };
  // Saved comfyui_video node payload carries frames/fps directly.
  const pf = payload.frames, pfps = payload.fps;
  if (typeof pf === "number" && typeof pfps === "number") return { maxFrames: pf, fps: pfps };
  const wt = payload.workflowTemplate;
  if (typeof wt === "string" && BUILTIN_VIDEO_DEFAULTS[wt]) return BUILTIN_VIDEO_DEFAULTS[wt];
  return { maxFrames: null, fps: null };
}

/**
 * Analyze the template library and persist results. Default = incremental
 * (never-analyzed / template updated since / out-of-version); `full` re-does all.
 * `max` caps how many are analyzed in one call (used by agent.chat so a planning
 * turn isn't blocked analyzing a huge backlog — the rest get done next turn).
 */
export async function runLibraryAnalysis(
  model: string,
  opts: { full?: boolean; max?: number } = {},
): Promise<{ total: number; analyzed: number; failed: number; skipped: number }> {
  const templates = await db.listComfyNodeTemplates();
  const analyses = await db.listComfyTemplateAnalysis();
  const byId = new Map(analyses.map((a) => [a.templateId, a]));

  let toAnalyze = templates.filter((t) => {
    if (opts.full) return true;
    const a = byId.get(t.id);
    if (!a) return true;
    if ((a.analysisVersion ?? 0) < CURRENT_ANALYSIS_VERSION) return true;
    const tplUpdated = t.updatedAt instanceof Date ? t.updatedAt : new Date(t.updatedAt);
    const analyzed = a.analyzedAt instanceof Date ? a.analyzedAt : new Date(a.analyzedAt);
    return tplUpdated > analyzed;
  });
  const pending = toAnalyze.length;
  if (opts.max != null && toAnalyze.length > opts.max) toAnalyze = toAnalyze.slice(0, opts.max);

  let analyzed = 0, failed = 0;
  for (const t of toAnalyze) {
    try { await db.upsertComfyTemplateAnalysis(await analyzeTemplate(t, model)); analyzed++; }
    catch { failed++; }
  }
  return { total: templates.length, analyzed, failed, skipped: templates.length - pending };
}
