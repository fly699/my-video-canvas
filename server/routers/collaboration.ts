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
  getShareLinkById,
  consumeShareLink,
  revokeShareLink,
  findUserByEmail,
} from "../db";
import { writeAuditLog } from "../_core/auditLog";
import { assertProjectAccess, ROLE_RANK } from "../_core/permissions";
import { collabBus } from "../_core/collabBus";
import type { TrpcContext } from "../_core/context";
import type { User } from "../../drizzle/schema";

const roleSchema = z.enum(["viewer", "editor", "admin"]);

/** Format the short alias: {id}.{first6CharsOfToken}. The dot separator
 *  is safe in URL paths and unambiguous because the token is base64url
 *  (only A–Z, a–z, 0–9, -, _) — no dots in the token itself. */
function buildShortCode(id: number, token: string): string {
  return `${id}.${token.slice(0, 6)}`;
}

/** Parse {id}.{prefix}. Returns null on malformed input rather than
 *  throwing — callers convert to NOT_FOUND for consistency with token. */
function parseShortCode(code: string): { id: number; prefix: string } | null {
  const m = /^(\d+)\.([A-Za-z0-9_-]{4,32})$/.exec(code);
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { id, prefix: m[2] };
}
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
        // Short alias: {id}.{first6CharsOfToken}. Combined with the row's id
        // lookup, the 6-char prefix gives ~36 bits of extra entropy — enough
        // to defeat brute-force on time-limited share links while keeping
        // the URL ~3× shorter than the full /invite/{token} form.
        shortCode: buildShortCode(l.id, l.token),
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
      return { ...link, shortCode: buildShortCode(link.id, link.token) };
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
      return acceptLinkRow(ctx, link);
    }),

  // Short-link variant: code = "{id}.{tokenPrefix6}". The id lookup + 6-char
  // prefix check is enough to authenticate without exposing the full token
  // in places where URL length matters (SMS, WeChat, QR codes).
  acceptShareLinkShort: protectedProcedure
    .input(z.object({ code: z.string().min(3).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const parsed = parseShortCode(input.code);
      if (!parsed) throw new TRPCError({ code: "NOT_FOUND", message: "邀请链接无效" });
      const link = await getShareLinkById(parsed.id);
      if (!link || !link.token.startsWith(parsed.prefix)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "邀请链接无效" });
      }
      return acceptLinkRow(ctx, link);
    }),
});

// Shared body — extracted so the long-token and short-code procedures stay
// in sync on the race-safe consume / owner shortcut / upsert flow.
async function acceptLinkRow(
  ctx: TrpcContext & { user: User },
  link: NonNullable<Awaited<ReturnType<typeof getShareLinkByToken>>>,
) {
  const access = await getProjectAccess(link.projectId, ctx.user.id);
  if (access?.source === "owner") {
    return { projectId: link.projectId, alreadyMember: true };
  }
  const existing = access?.source === "collaborator" ? access : null;
  if (existing && ROLE_RANK[existing.role] >= ROLE_RANK[link.role]) {
    return { projectId: link.projectId, alreadyMember: true };
  }

  const consumed = await consumeShareLink(link.id);
  if (!consumed) {
    const fresh = await getShareLinkById(link.id);
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
  collabBus.emitRoleInvalidated({ projectId: link.projectId, userId: ctx.user.id });
  return { projectId: link.projectId, alreadyMember: !!existing };
}
