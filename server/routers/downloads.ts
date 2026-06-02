import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { writeAuditLog } from "../_core/auditLog";
import { toInternalStoragePath } from "../storage";
import { ENV } from "../_core/env";

/** Bare storage key from a URL/path (own-storage → key; external → the URL). */
function keyOf(url: string): string {
  const internal = toInternalStoragePath(url);
  return internal ? internal.replace(/^\/manus-storage\//, "").split("?")[0] : url;
}

// ── User-facing download authorization ───────────────────────────────────────
export const downloadsRouter = router({
  // Whether strict download authorization is enforced in this deployment.
  config: protectedProcedure.query(({ ctx }) => ({
    enabled: ENV.downloadAuthEnabled,
    isAdmin: ctx.user.role === "admin",
  })),

  // Can the current user download this file right now? Drives the client UI
  // (show "下载" vs "申请下载"). Admins / disabled feature → always allowed.
  checkAccess: protectedProcedure
    .input(z.object({ url: z.string().min(1).max(2048), assetId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      if (!ENV.downloadAuthEnabled || ctx.user.role === "admin") return { allowed: true as const, reason: "open" as const };
      const storageKey = keyOf(input.url);
      let assetId = input.assetId ?? null;
      let projectId: number | null = null;
      const asset = await db.getAssetByStorageKey(storageKey);
      if (asset) { assetId = asset.id; projectId = asset.projectId; }
      const grant = await db.findUsableDownloadGrant({ userId: ctx.user.id, storageKey, assetId, projectId });
      return { allowed: !!grant, reason: grant ? ("granted" as const) : ("need-request" as const) };
    }),

  // Submit a download request for an admin to approve. De-dupes against an
  // existing pending request for the same file.
  request: protectedProcedure
    .input(z.object({
      url: z.string().min(1).max(2048),
      assetId: z.number().optional(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ENV.downloadAuthEnabled) throw new TRPCError({ code: "BAD_REQUEST", message: "本部署未开启下载授权" });
      const storageKey = keyOf(input.url);
      const asset = await db.getAssetByStorageKey(storageKey);
      // Reuse an existing pending request for the same file by this user.
      const mine = await db.listDownloadGrants({ userId: ctx.user.id, limit: 500 });
      const dup = mine.find((g) => g.status === "pending" && g.scope === "asset" && (g.storageKey === storageKey || (asset && g.assetId === asset.id)));
      if (dup) return dup;
      const grant = await db.createDownloadRequest({
        userId: ctx.user.id, scope: "asset", storageKey,
        assetId: asset?.id ?? input.assetId ?? null, projectId: asset?.projectId ?? null,
        reason: input.reason ?? null,
      });
      if (!grant) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "提交申请失败" });
      writeAuditLog({ ctx, action: "download:request", detail: { storageKey, reason: input.reason, grantId: grant.id } });
      return grant;
    }),

  // The current user's own grants/requests (pending + decided).
  myGrants: protectedProcedure.query(({ ctx }) => db.listDownloadGrants({ userId: ctx.user.id, limit: 200 })),
});

// ── Admin: review requests, grant, revoke ─────────────────────────────────────
export const adminDownloadsRouter = router({
  list: adminProcedure
    .input(z.object({ status: z.enum(["pending", "active", "revoked", "denied"]).optional(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional() }).optional())
    .query(({ input }) => db.listDownloadGrants(input ?? {})),

  decide: adminProcedure
    .input(z.object({ grantId: z.number(), approve: z.boolean(), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      await db.decideDownloadGrant(input.grantId, ctx.user.id, input.approve, input.note ?? null);
      writeAuditLog({ ctx, action: input.approve ? "download:approve" : "download:deny", detail: { grantId: input.grantId, note: input.note } });
      return { success: true };
    }),

  // Admin-initiated batch grant: per file (assetId/storageKey) or per project.
  grant: adminProcedure
    .input(z.object({
      userId: z.number(),
      scope: z.enum(["asset", "project"]),
      storageKey: z.string().max(512).optional(),
      assetId: z.number().optional(),
      projectId: z.number().optional(),
      note: z.string().max(500).optional(),
      expiresAt: z.number().optional(), // epoch ms
    }).refine((d) => d.scope === "asset" ? (!!d.storageKey || d.assetId != null) : d.projectId != null, { message: "asset 授权需 storageKey/assetId；project 授权需 projectId" }))
    .mutation(async ({ ctx, input }) => {
      const grant = await db.adminCreateGrant({
        userId: input.userId, scope: input.scope,
        storageKey: input.storageKey ?? null, assetId: input.assetId ?? null, projectId: input.projectId ?? null,
        note: input.note ?? null, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, createdBy: ctx.user.id,
      });
      if (!grant) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "授权失败" });
      writeAuditLog({ ctx, action: "download:grant", detail: { grantId: grant.id, userId: input.userId, scope: input.scope } });
      return grant;
    }),

  revoke: adminProcedure
    .input(z.object({ grantId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.revokeDownloadGrant(input.grantId, ctx.user.id);
      writeAuditLog({ ctx, action: "download:revoke", detail: { grantId: input.grantId } });
      return { success: true };
    }),
});
