import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { writeAuditLog } from "../_core/auditLog";
import { toInternalStoragePath } from "../storage";
import { isDownloadAuthEnabled } from "../_core/storageConfig";
import { notifyAdminsOfDownloadRequest } from "../_core/downloadNotify";
import { postDownloadRequestToChannel } from "./chat";

/** Bare storage key from a URL/path (own-storage → key; external → the URL). */
function keyOf(url: string): string {
  const internal = toInternalStoragePath(url);
  return internal ? internal.replace(/^\/manus-storage\//, "").split("?")[0] : url;
}

// ── User-facing download authorization ───────────────────────────────────────
export const downloadsRouter = router({
  // Whether strict download authorization is enforced in this deployment.
  config: protectedProcedure.query(async ({ ctx }) => ({
    enabled: await isDownloadAuthEnabled(),
    isAdmin: ctx.user.role === "admin",
  })),

  // Can the current user download this file right now? Drives the client UI
  // (show "下载" vs "申请下载"). Admins / disabled feature → always allowed.
  checkAccess: protectedProcedure
    .input(z.object({ url: z.string().min(1).max(2048), assetId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      if (!(await isDownloadAuthEnabled()) || ctx.user.role === "admin") return { allowed: true as const, reason: "open" as const };
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
      if (!(await isDownloadAuthEnabled())) throw new TRPCError({ code: "BAD_REQUEST", message: "未开启下载授权" });
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
      // Push to online admins for on-the-spot approval (best-effort).
      const meta = await db.getAssetMetaForGrant(asset?.id ?? input.assetId ?? null, storageKey).catch(() => null);
      const proj = meta?.projectId != null ? await db.getProjectByIdRaw(meta.projectId).catch(() => null) : null;
      const noticeBase = {
        grantId: grant.id, userId: ctx.user.id, requesterName: ctx.user.name ?? null,
        fileName: meta?.name ?? storageKey.split("/").pop() ?? null, fileType: meta?.type ?? null,
        projectName: proj?.name ?? null, reason: input.reason ?? null,
      };
      notifyAdminsOfDownloadRequest({ ...noticeBase, createdAt: Date.now() });
      void postDownloadRequestToChannel(noticeBase); // also log into the chat "下载审批" channel
      return grant;
    }),

  // The current user's own grants/requests (pending + decided).
  myGrants: protectedProcedure.query(({ ctx }) => db.listDownloadGrants({ userId: ctx.user.id, limit: 200 })),
});

// ── Admin: review requests, grant, revoke ─────────────────────────────────────
export const adminDownloadsRouter = router({
  list: adminProcedure
    .input(z.object({ status: z.enum(["pending", "active", "revoked", "denied"]).optional(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional() }).optional())
    .query(async ({ input }) => {
      const grants = await db.listDownloadGrants(input ?? {});
      // Enrich each grant so the admin can verify WHAT and WHO without guessing
      // from a raw storage key: file name/url/type (preview), requester, project.
      return Promise.all(grants.map(async (g) => {
        const [file, requester, project] = await Promise.all([
          db.getAssetMetaForGrant(g.assetId, g.storageKey),
          db.getUserById(g.userId).catch(() => null),
          g.projectId != null ? db.getProjectByIdRaw(g.projectId).catch(() => null) : Promise.resolve(null),
        ]);
        return {
          ...g,
          fileName: file?.name ?? null,
          fileUrl: file?.url ?? null,
          fileType: file?.type ?? null,
          requesterName: requester?.name ?? null,
          requesterEmail: requester?.email ?? null,
          projectName: project?.name ?? null,
        };
      }));
    }),

  decide: adminProcedure
    .input(z.object({ grantId: z.number(), approve: z.boolean(), note: z.string().max(500).optional(), expiresHours: z.number().int().min(1).max(24).optional() }))
    .mutation(async ({ ctx, input }) => {
      // Approved grants expire (default 1 hour, 1–24h) so a one-time download
      // must be used promptly — a stale approval can't be redeemed later.
      const expiresAt = input.approve ? new Date(Date.now() + (input.expiresHours ?? 1) * 3600_000) : null;
      await db.decideDownloadGrant(input.grantId, ctx.user.id, input.approve, input.note ?? null, expiresAt);
      writeAuditLog({ ctx, action: input.approve ? "download:approve" : "download:deny", detail: { grantId: input.grantId, note: input.note, expiresAt: expiresAt?.toISOString() } });
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

  // Cheap count of un-handled requests — drives the global admin badge.
  pendingCount: adminProcedure.query(async () => (await db.listDownloadGrants({ status: "pending", limit: 500 })).length),

  revoke: adminProcedure
    .input(z.object({ grantId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.revokeDownloadGrant(input.grantId, ctx.user.id);
      writeAuditLog({ ctx, action: "download:revoke", detail: { grantId: input.grantId } });
      return { success: true };
    }),
});
