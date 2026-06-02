import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { writeAuditLog } from "../_core/auditLog";
import { EDITOR_DOC_VERSION, emptyEditorDoc, type EditorDoc } from "@shared/editorTypes";

// ── EDL validation ────────────────────────────────────────────────────────────
// Kept tolerant: unknown effect/transition keys are allowed through so the
// front-end can evolve the doc without a server lockstep, but the structural
// shape (tracks → clips with timing) is enforced.
const transformSchema = z.object({
  x: z.number().optional(), y: z.number().optional(), scale: z.number().optional(),
  opacity: z.number().optional(), rotation: z.number().optional(),
}).passthrough();

const clipSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["video", "image", "audio", "text"]),
  assetId: z.number().optional(),
  assetUrl: z.string().max(2048).optional(),
  start: z.number().min(0),
  trimIn: z.number().min(0),
  trimOut: z.number().min(0),
  speed: z.number().min(0.1).max(8).optional(),
  volume: z.number().min(0).max(4).optional(),
  fadeIn: z.number().min(0).optional(),
  fadeOut: z.number().min(0).optional(),
  transitionIn: z.object({ type: z.string().max(32), duration: z.number().min(0).max(10) }).optional(),
  effects: z.object({
    brightness: z.number().optional(), contrast: z.number().optional(),
    saturation: z.number().optional(), filter: z.string().max(64).optional(),
  }).passthrough().optional(),
  transform: transformSchema.optional(),
  text: z.object({
    content: z.string().max(2000),
    font: z.string().max(64).optional(), size: z.number().optional(),
    color: z.string().max(32).optional(), bgColor: z.string().max(32).optional(),
    motionStyle: z.string().max(32).optional(),
  }).passthrough().optional(),
}).passthrough();

const docSchema = z.object({
  version: z.literal(EDITOR_DOC_VERSION),
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(7680),
  fps: z.number().int().min(1).max(120),
  tracks: z.array(z.object({
    id: z.string().min(1).max(64),
    type: z.enum(["video", "audio", "text", "overlay"]),
    muted: z.boolean().optional(),
    hidden: z.boolean().optional(),
    clips: z.array(clipSchema).max(500),
  })).max(20),
});

export const editorRouter = router({
  // List the current user's editor sessions (most-recent first; soft-deleted hidden).
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.listEditSessions(ctx.user.id);
    return rows.map((s) => ({
      id: s.id, name: s.name, projectId: s.projectId,
      thumbnailUrl: s.thumbnailUrl, updatedAt: s.updatedAt, createdAt: s.createdAt,
    }));
  }),

  // Load one session (owner-scoped). Returns the full EDL doc to edit.
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const s = await db.getEditSession(input.id, ctx.user.id);
      if (!s) throw new TRPCError({ code: "NOT_FOUND" });
      return { id: s.id, name: s.name, projectId: s.projectId, thumbnailUrl: s.thumbnailUrl, doc: s.doc as EditorDoc, updatedAt: s.updatedAt };
    }),

  // Create a new (empty) session, optionally linked to a canvas project.
  create: protectedProcedure
    .input(z.object({
      name: z.string().max(255).optional(),
      projectId: z.number().optional(),
      width: z.number().int().min(16).max(7680).optional(),
      height: z.number().int().min(16).max(7680).optional(),
      fps: z.number().int().min(1).max(120).optional(),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const doc = emptyEditorDoc(input?.width, input?.height, input?.fps);
      const s = await db.createEditSession({
        userId: ctx.user.id,
        projectId: input?.projectId ?? null,
        name: input?.name ?? "未命名剪辑",
        doc,
      });
      if (!s) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "创建剪辑失败" });
      writeAuditLog({ ctx, action: "editor:create", detail: { sessionId: s.id, projectId: input?.projectId } });
      return { id: s.id };
    }),

  // Save the doc/name (autosave). Owner-scoped.
  save: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().max(255).optional(),
      doc: docSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getEditSession(input.id, ctx.user.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await db.updateEditSession(input.id, ctx.user.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.doc !== undefined ? { doc: input.doc } : {}),
      });
      return { success: true };
    }),

  // Soft-delete (hidden from the user; row kept).
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteEditSession(input.id, ctx.user.id);
      writeAuditLog({ ctx, action: "editor:delete", detail: { sessionId: input.id } });
      return { success: true };
    }),
});
