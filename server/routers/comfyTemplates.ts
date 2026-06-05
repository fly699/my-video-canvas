import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { assertLLMAllowed } from "../_core/whitelist";
import { runLibraryAnalysis } from "../_core/templateAnalysis";
import {
  sanitizeComfyPayload, COMFY_TEMPLATE_LIMITS,
  type ComfyNodeType, type ComfyNodeTemplate,
} from "@shared/comfyNodeTemplate";
import type { ComfyNodeTemplateRow } from "../../drizzle/schema";

const nodeTypeSchema = z.enum(["comfyui_image", "comfyui_video", "comfyui_workflow"]);

function toClient(r: ComfyNodeTemplateRow): ComfyNodeTemplate {
  return {
    id: r.id,
    label: r.label,
    nodeType: r.nodeType as ComfyNodeType,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    note: r.note ?? undefined,
    thumbnail: r.thumbnail ?? undefined,
    useCloud: r.useCloud ?? undefined,
    userId: r.userId,
    creatorName: r.creatorName ?? undefined,
    createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
  };
}

export const comfyTemplatesRouter = router({
  // Shared library — every logged-in user sees all templates.
  list: protectedProcedure.query(async () => {
    const rows = await db.listComfyNodeTemplates();
    return rows.map(toClient);
  }),

  // Any logged-in user may contribute a template.
  create: protectedProcedure
    .input(z.object({
      label: z.string().trim().min(1).max(COMFY_TEMPLATE_LIMITS.MAX_LABEL_LEN),
      nodeType: nodeTypeSchema,
      payload: z.record(z.string(), z.unknown()),
      note: z.string().max(COMFY_TEMPLATE_LIMITS.MAX_NOTE_LEN).optional(),
      thumbnail: z.string().max(2048).optional(),
      useCloud: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Re-sanitize server-side (never trust the client to have stripped output/runtime).
      const payload = sanitizeComfyPayload(input.payload as Record<string, unknown>);
      if (JSON.stringify(payload).length > COMFY_TEMPLATE_LIMITS.MAX_JSON) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "模板内容过大" });
      }
      const row = await db.createComfyNodeTemplate({
        userId: ctx.user.id,
        creatorName: ctx.user.name ?? ctx.user.email ?? null,
        label: input.label.trim(),
        nodeType: input.nodeType,
        payload,
        note: input.note?.trim() || null,
        thumbnail: input.thumbnail || null,
        useCloud: input.nodeType === "comfyui_workflow" ? !!input.useCloud : null,
      });
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "保存失败" });
      return toClient(row);
    }),

  // Rename / edit note, or OVERWRITE the saved params (payload/thumbnail/useCloud)
  // from a node — creator or admin only.
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      label: z.string().trim().min(1).max(COMFY_TEMPLATE_LIMITS.MAX_LABEL_LEN).optional(),
      note: z.string().max(COMFY_TEMPLATE_LIMITS.MAX_NOTE_LEN).optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
      thumbnail: z.string().max(2048).optional(),
      useCloud: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getComfyNodeTemplate(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "只能修改自己创建的模板" });
      }
      let payload: Record<string, unknown> | undefined;
      if (input.payload !== undefined) {
        payload = sanitizeComfyPayload(input.payload as Record<string, unknown>);
        if (JSON.stringify(payload).length > COMFY_TEMPLATE_LIMITS.MAX_JSON) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "模板内容过大" });
        }
      }
      await db.updateComfyNodeTemplate(input.id, {
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.note !== undefined ? { note: input.note.trim() || null } : {}),
        ...(payload !== undefined ? { payload } : {}),
        ...(input.thumbnail !== undefined ? { thumbnail: input.thumbnail || null } : {}),
        ...(input.useCloud !== undefined ? { useCloud: existing.nodeType === "comfyui_workflow" ? !!input.useCloud : null } : {}),
      });
      // Overwriting the params invalidates the stored functional analysis — drop
      // it so the agent re-analyzes this template on next library analysis.
      if (payload !== undefined) await db.deleteComfyTemplateAnalysis(input.id);
      return { success: true };
    }),

  // Delete — creator or admin only.
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getComfyNodeTemplate(input.id);
      if (!existing) return { success: true };
      if (existing.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "只能删除自己创建的模板" });
      }
      await db.deleteComfyNodeTemplate(input.id);
      await db.deleteComfyTemplateAnalysis(input.id); // drop its analysis too (no orphan)
      return { success: true };
    }),

  // ── Template-library functional analysis (for the agent) ───────────────────
  // List stored analyses joined with template label (compact, for the agent's
  // system prompt and any UI).
  analysisList: protectedProcedure.query(async () => {
    const [templates, analyses] = await Promise.all([
      db.listComfyNodeTemplates(),
      db.listComfyTemplateAnalysis(),
    ]);
    const byId = new Map(templates.map((t) => [t.id, t]));
    return analyses
      .filter((a) => byId.has(a.templateId))
      .map((a) => ({
        id: a.templateId,
        label: byId.get(a.templateId)!.label,
        nodeType: byId.get(a.templateId)!.nodeType,
        functionSummary: a.functionSummary ?? "",
        capabilities: (a.capabilities as string[] | null) ?? [],
        outputType: a.outputType ?? undefined,
        hasVideoOutput: a.hasVideoOutput ?? undefined,
        analyzedAt: (a.analyzedAt instanceof Date ? a.analyzedAt : new Date(a.analyzedAt)).toISOString(),
      }));
  }),

  // Analyze the template library and persist results. Default = incremental
  // (only never-analyzed / updated / out-of-version templates); `full` re-does
  // all. LLM-gated (respects admin "open LLM" bypass); any editor may trigger.
  analyzeLibrary: protectedProcedure
    .input(z.object({ model: z.string().max(64).optional(), full: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertLLMAllowed(ctx);
      const model = input.model ?? "claude-sonnet-4-5-20250929";
      return runLibraryAnalysis(model, { full: input.full });
    }),
});
