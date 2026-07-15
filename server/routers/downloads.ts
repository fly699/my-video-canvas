import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, levelProcedure, router } from "../_core/trpc";

// 下载审批整体限「管理员 L3+」（查看+审批/授权/撤销都是）：查看员 L1、运营 L2 均无权。
// 注意：普通用户自己申请/查看自己授权的 config/checkAccess/request/myGrants 仍是 protectedProcedure。
const managerProc = levelProcedure(3);
import * as db from "../db";
import { writeAuditLog } from "../_core/auditLog";
import { toInternalStoragePath } from "../storage";
import { isDownloadAuthEnabled, getDownloadAuthBypassLevel } from "../_core/storageConfig";
import { userAdminLevel, isLevelExemptFromDownloadGate } from "../_core/downloadAuth";
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
  // 免控判定必须与服务端 gate（downloadAuth.authorizeDownload）完全一致——按「管理级别 >=
  // 免控阈值 bypassLevel」判，而非粗粒度的 role==="admin"。否则运营(L2)等 role=admin 但级别
  // 低于阈值的用户会被客户端误判为免控、跳过「申请下载」弹窗，直连服务端拿到 403 JSON 存成文件。
  config: protectedProcedure.query(async ({ ctx }) => ({
    enabled: await isDownloadAuthEnabled(),
    isAdmin: isLevelExemptFromDownloadGate(userAdminLevel(ctx.user), await getDownloadAuthBypassLevel()),
  })),

  // Can the current user download this file right now? Drives the client UI
  // (show "下载" vs "申请下载"). Admins / disabled feature → always allowed.
  checkAccess: protectedProcedure
    .input(z.object({ url: z.string().min(1).max(2048), assetId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      // 与服务端 gate 一致：按级别免控（role==="admin" 但级别不足者仍受控）。
      if (!(await isDownloadAuthEnabled())) return { allowed: true as const, reason: "open" as const };
      if (isLevelExemptFromDownloadGate(userAdminLevel(ctx.user), await getDownloadAuthBypassLevel())) return { allowed: true as const, reason: "open" as const };
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
  list: managerProc
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

  decide: managerProc
    .input(z.object({
      grantId: z.number(), approve: z.boolean(), note: z.string().max(500).optional(),
      // Validity, in priority order: `permanent` (no expiry) > `expiresAt` (epoch ms,
      // arbitrary) > `expiresHours` (legacy 1–72h, used by the quick-approve buttons
      // in the notifier/chat). Default when approving with none given: 1 hour.
      expiresHours: z.number().int().min(1).max(72).optional(),
      expiresAt: z.number().int().positive().optional(), // epoch ms; must be a real (future) time
      permanent: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const expiresAt = !input.approve
        ? null
        : input.permanent
          ? null
          // Use an explicit expiresAt only if it's in the future (a past time would
          // make the grant "approved but already expired" → silent failure).
          : (input.expiresAt != null && input.expiresAt > Date.now())
            ? new Date(input.expiresAt)
            : new Date(Date.now() + (input.expiresHours ?? 1) * 3600_000);
      await db.decideDownloadGrant(input.grantId, ctx.user.id, input.approve, input.note ?? null, expiresAt);
      writeAuditLog({ ctx, action: input.approve ? "download:approve" : "download:deny", detail: { grantId: input.grantId, note: input.note, expiresAt: expiresAt?.toISOString() ?? null } });
      return { success: true };
    }),

  // Admin-initiated batch grant: per file (assetId/storageKey) or per project.
  grant: managerProc
    .input(z.object({
      userId: z.number(),
      scope: z.enum(["asset", "project"]),
      storageKey: z.string().max(512).optional(),
      assetId: z.number().optional(),
      projectId: z.number().optional(),
      note: z.string().max(500).optional(),
      expiresAt: z.number().int().positive().optional(), // epoch ms (future)
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

  // Resolve a target user (by email) AND list every project they can access —
  // owned + projects they collaborate on — so the proactive-grant form can show a
  // checklist instead of asking for a project id.
  userProjects: managerProc
    .input(z.object({ email: z.string().max(200) }))
    .query(async ({ input }) => {
      const email = input.email.trim();
      if (!email) return { user: null, projects: [] as { id: number; name: string; role: "owner" | "collaborator" }[] };
      const user = await db.findUserByEmail(email);
      if (!user) return { user: null, projects: [] as { id: number; name: string; role: "owner" | "collaborator" }[] };
      const [owned, shared] = await Promise.all([
        db.getProjectsByUser(user.id),
        db.getProjectsSharedWithUser(user.id),
      ]);
      const projects = [
        ...owned.map((p) => ({ id: p.id, name: p.name, role: "owner" as const })),
        ...shared.map((p) => ({ id: p.id, name: p.name, role: "collaborator" as const })),
      ];
      return { user: { id: user.id, name: user.name ?? null, email: user.email ?? null }, projects };
    }),

  // Cheap count of un-handled requests — drives the global admin badge.
  pendingCount: managerProc.query(async () => (await db.listDownloadGrants({ status: "pending", limit: 500 })).length),

  revoke: managerProc
    .input(z.object({ grantId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.revokeDownloadGrant(input.grantId, ctx.user.id);
      writeAuditLog({ ctx, action: "download:revoke", detail: { grantId: input.grantId } });
      return { success: true };
    }),
});
