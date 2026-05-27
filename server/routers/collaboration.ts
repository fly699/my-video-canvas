import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { randomBytes } from "crypto";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getProjectAccess,
  setProjectPublicAccess,
  listCollaborators,
  findCollaboratorByUserId,
  upsertCollaborator,
  updateCollaboratorRole,
  removeCollaborator,
  createShareLink,
  listShareLinks,
  getShareLinkByToken,
  consumeShareLink,
  revokeShareLink,
  findUserByEmail,
} from "../db";
import { writeAuditLog } from "../_core/auditLog";
import { assertProjectAccess, ROLE_RANK } from "../_core/permissions";
import { collabBus } from "../_core/collabBus";

const roleSchema = z.enum(["viewer", "editor", "admin"]);
// Normalize email at the edge so case + whitespace mismatches between invite
// and claim (signup lowercases + trims, but inviteByEmail used to store raw
// input) can never orphan a pending invite.
const emailSchema = z.string().email().max(320).transform((s) => s.trim().toLowerCase());

export const collaborationRouter = router({
  // ── Member listing ───────────────────────────────────────────────────────
  listMembers: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Any member can see the roster (so viewers know who else is collaborating)
      await assertProjectAccess(input.projectId, ctx.user.id, "viewer");
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
      // Reuse the access object so we don't pay a second DB round-trip.
      const access = await assertProjectAccess(input.projectId, ctx.user.id, "admin");
      const target = await findUserByEmail(input.email);
      if (target && target.id === access.project.userId) {
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
      await assertProjectAccess(input.projectId, ctx.user.id, "admin");
      await updateCollaboratorRole(input.memberId, input.role);
      writeAuditLog({ ctx, action: "collab:update_role", detail: input });
      // Invalidate any cached socket role for users in this project so a
      // demoted editor immediately loses mutating-event privileges.
      collabBus.emitRoleInvalidated({ projectId: input.projectId });
      return { success: true };
    }),

  // ── Removal ──────────────────────────────────────────────────────────────
  removeMember: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      memberId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "admin");
      await removeCollaborator(input.memberId);
      writeAuditLog({ ctx, action: "collab:remove", detail: input });
      collabBus.emitRoleInvalidated({ projectId: input.projectId });
      return { success: true };
    }),

  // ── Self-leave (any non-owner member can call) ───────────────────────────
  leaveProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user.id, "viewer");
      if (access.source === "owner") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "项目所有者不能离开自己的项目" });
      }
      const member = await findCollaboratorByUserId(input.projectId, ctx.user.id);
      if (member) await removeCollaborator(member.id);
      writeAuditLog({ ctx, action: "collab:leave", detail: { projectId: input.projectId } });
      collabBus.emitRoleInvalidated({ projectId: input.projectId, userId: ctx.user.id });
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
      // owner-only — widening reach belongs to the owner alone
      await assertProjectAccess(input.projectId, ctx.user.id, "owner");
      await setProjectPublicAccess(input.projectId, input.publicReadAccess);
      writeAuditLog({ ctx, action: "collab:public_toggle", detail: input });
      // Toggling public access changes the access rules for non-members,
      // invalidate all socket caches in case any public-read viewer is online.
      collabBus.emitRoleInvalidated({ projectId: input.projectId });
      return { success: true };
    }),

  // ── Share links ──────────────────────────────────────────────────────────
  listShareLinks: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user.id, "admin");
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
      await assertProjectAccess(input.projectId, ctx.user.id, "admin");
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
      await assertProjectAccess(input.projectId, ctx.user.id, "admin");
      await revokeShareLink(input.linkId);
      writeAuditLog({ ctx, action: "collab:revoke_link", detail: input });
      return { success: true };
    }),

  // ── Share link consumption ──────────────────────────────────────────────
  // Any authenticated user can call this. The validate+increment step uses a
  // single conditional UPDATE so concurrent acceptances on a maxUses=1 link
  // can't both pass the gate. The owner shortcut runs first to skip claiming
  // a slot when the caller is already the project owner.
  acceptShareLink: protectedProcedure
    .input(z.object({ token: z.string().min(8).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const link = await getShareLinkByToken(input.token);
      if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "邀请链接无效" });

      // Cheap owner shortcut — owners don't need to claim a slot
      const access = await getProjectAccess(link.projectId, ctx.user.id);
      if (access?.source === "owner") {
        return { projectId: link.projectId, alreadyMember: true };
      }
      // Re-using an already-granted role doesn't burn a slot either
      const existing = access?.source === "collaborator" ? access : null;
      if (existing && ROLE_RANK[existing.role] >= ROLE_RANK[link.role]) {
        return { projectId: link.projectId, alreadyMember: true };
      }

      // Atomic gate: only the row that wins the conditional UPDATE proceeds.
      const consumed = await consumeShareLink(link.id);
      if (!consumed) {
        // Some other request raced us, or the link expired / was revoked / hit limit
        const fresh = await getShareLinkByToken(input.token);
        if (!fresh || fresh.revokedAt) throw new TRPCError({ code: "FORBIDDEN", message: "邀请链接已撤销" });
        if (fresh.expiresAt.getTime() <= Date.now()) throw new TRPCError({ code: "FORBIDDEN", message: "邀请链接已过期" });
        throw new TRPCError({ code: "FORBIDDEN", message: "邀请链接已达使用上限" });
      }

      await upsertCollaborator({
        projectId: link.projectId,
        userId: ctx.user.id,
        email: ctx.user.email ?? null,
        role: link.role,
        invitedBy: link.createdBy,
        status: "active",
      });
      writeAuditLog({ ctx, action: "collab:accept_link", detail: {
        projectId: link.projectId,
        linkId: link.id,
        role: link.role,
      } });
      // If this user already had a socket connected (e.g. they were a
      // public-read viewer or already a collaborator with a lower role),
      // their cached socket role would stay stale until reconnect — drop
      // the cache so the next mutating event re-derives access from the DB.
      collabBus.emitRoleInvalidated({ projectId: link.projectId, userId: ctx.user.id });
      return { projectId: link.projectId, alreadyMember: !!existing };
    }),
});
