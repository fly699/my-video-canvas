import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { randomBytes } from "crypto";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getProjectAccess,
  setProjectPublicAccess,
  listCollaborators,
  findCollaboratorByUserId,
  findCollaboratorByEmail,
  upsertCollaborator,
  updateCollaboratorRole,
  removeCollaborator,
  createShareLink,
  listShareLinks,
  getShareLinkByToken,
  incrementShareLinkUses,
  revokeShareLink,
  findUserByEmail,
  type EffectiveRole,
} from "../db";
import { writeAuditLog } from "../_core/auditLog";

const ROLE_RANK: Record<EffectiveRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

async function assertProjectAdmin(projectId: number, userId: number) {
  const access = await getProjectAccess(projectId, userId);
  if (!access || ROLE_RANK[access.role] < ROLE_RANK["admin"]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
  }
  return access;
}

const roleSchema = z.enum(["viewer", "editor", "admin"]);
const emailSchema = z.string().email().max(320);

export const collaborationRouter = router({
  // ── Member listing ───────────────────────────────────────────────────────
  listMembers: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Any member can see the roster (so viewers know who else is collaborating)
      const access = await getProjectAccess(input.projectId, ctx.user.id);
      if (!access) throw new TRPCError({ code: "FORBIDDEN" });
      return listCollaborators(input.projectId);
    }),

  // ── Email invitation ─────────────────────────────────────────────────────
  // If the email belongs to a registered user, immediately add them as an
  // active collaborator. Otherwise insert a pending row to be claimed on
  // signup.
  inviteByEmail: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      email: emailSchema,
      role: roleSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAdmin(input.projectId, ctx.user.id);
      const target = await findUserByEmail(input.email);
      const access = await getProjectAccess(input.projectId, ctx.user.id);
      if (target && target.id === access!.project.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "项目所有者无需邀请" });
      }
      const row = await upsertCollaborator({
        projectId: input.projectId,
        userId: target?.id ?? null,
        email: input.email,
        role: input.role,
        invitedBy: ctx.user.id,
        status: target ? "active" : "pending",
      });
      writeAuditLog({ ctx, action: "collab:invite_email", detail: {
        projectId: input.projectId,
        email: input.email,
        role: input.role,
        status: target ? "active" : "pending",
      } });
      return row;
    }),

  // ── Role management ──────────────────────────────────────────────────────
  updateMemberRole: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      memberId: z.number(),
      role: roleSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAdmin(input.projectId, ctx.user.id);
      await updateCollaboratorRole(input.memberId, input.role);
      writeAuditLog({ ctx, action: "collab:update_role", detail: input });
      return { success: true };
    }),

  // ── Removal ──────────────────────────────────────────────────────────────
  removeMember: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      memberId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAdmin(input.projectId, ctx.user.id);
      await removeCollaborator(input.memberId);
      writeAuditLog({ ctx, action: "collab:remove", detail: input });
      return { success: true };
    }),

  // ── Self-leave (any non-owner member can call) ───────────────────────────
  leaveProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const access = await getProjectAccess(input.projectId, ctx.user.id);
      if (!access || access.source === "owner") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "项目所有者不能离开自己的项目" });
      }
      const member = await findCollaboratorByUserId(input.projectId, ctx.user.id);
      if (member) await removeCollaborator(member.id);
      writeAuditLog({ ctx, action: "collab:leave", detail: { projectId: input.projectId } });
      return { success: true };
    }),

  // ── Public read toggle ──────────────────────────────────────────────────
  // Only the owner may toggle public access (it widens the reach of the URL).
  setPublicAccess: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      publicReadAccess: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await getProjectAccess(input.projectId, ctx.user.id);
      if (!access || access.source !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅项目所有者可设置公开只读" });
      }
      await setProjectPublicAccess(input.projectId, input.publicReadAccess);
      writeAuditLog({ ctx, action: "collab:public_toggle", detail: input });
      return { success: true };
    }),

  // ── Share links ──────────────────────────────────────────────────────────
  listShareLinks: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAdmin(input.projectId, ctx.user.id);
      const all = await listShareLinks(input.projectId);
      // Hide revoked / exhausted / expired links from the active list.
      const now = Date.now();
      return all.map((l) => ({
        ...l,
        active: !l.revokedAt && l.usesCount < l.maxUses && l.expiresAt.getTime() > now,
      }));
    }),

  createShareLink: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      role: roleSchema,
      maxUses: z.number().int().min(1).max(100).default(1),
      expiresInDays: z.number().int().min(1).max(30).default(7),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAdmin(input.projectId, ctx.user.id);
      const token = randomBytes(24).toString("base64url");
      const expiresAt = new Date(Date.now() + input.expiresInDays * 86400_000);
      const link = await createShareLink({
        token,
        projectId: input.projectId,
        role: input.role,
        maxUses: input.maxUses,
        usesCount: 0,
        expiresAt,
        createdBy: ctx.user.id,
      });
      writeAuditLog({ ctx, action: "collab:create_link", detail: {
        projectId: input.projectId,
        role: input.role,
        maxUses: input.maxUses,
        expiresInDays: input.expiresInDays,
      } });
      return link;
    }),

  revokeShareLink: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      linkId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAdmin(input.projectId, ctx.user.id);
      await revokeShareLink(input.linkId);
      writeAuditLog({ ctx, action: "collab:revoke_link", detail: input });
      return { success: true };
    }),

  // ── Share link consumption ──────────────────────────────────────────────
  // Any authenticated user can call this. It atomically validates and increments
  // the link's use count, then upserts the caller as a collaborator with the
  // link's role. Returns the projectId on success.
  acceptShareLink: protectedProcedure
    .input(z.object({ token: z.string().min(8).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const link = await getShareLinkByToken(input.token);
      if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "邀请链接无效" });
      if (link.revokedAt) throw new TRPCError({ code: "FORBIDDEN", message: "邀请链接已撤销" });
      if (link.expiresAt.getTime() <= Date.now()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "邀请链接已过期" });
      }
      if (link.usesCount >= link.maxUses) {
        throw new TRPCError({ code: "FORBIDDEN", message: "邀请链接已达使用上限" });
      }

      // Owner doesn't need a collaborator row; just succeed silently
      const access = await getProjectAccess(link.projectId, ctx.user.id);
      if (access?.source === "owner") {
        return { projectId: link.projectId, alreadyMember: true };
      }
      // If already a non-owner member, upgrade role only if the link offers higher
      const existing = await findCollaboratorByUserId(link.projectId, ctx.user.id);
      const desiredRank = ROLE_RANK[link.role];
      const existingRank = existing ? ROLE_RANK[existing.role] : -1;
      if (existingRank < desiredRank) {
        await upsertCollaborator({
          projectId: link.projectId,
          userId: ctx.user.id,
          email: ctx.user.email ?? null,
          role: link.role,
          invitedBy: link.createdBy,
          status: "active",
        });
      }
      await incrementShareLinkUses(link.id);
      writeAuditLog({ ctx, action: "collab:accept_link", detail: {
        projectId: link.projectId,
        linkId: link.id,
        role: link.role,
      } });
      return { projectId: link.projectId, alreadyMember: !!existing };
    }),
});
