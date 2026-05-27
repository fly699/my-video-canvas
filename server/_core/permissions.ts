import { TRPCError } from "@trpc/server";
import { getProjectAccess, type EffectiveRole, type ProjectAccess } from "../db";

export const ROLE_RANK: Record<EffectiveRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

/**
 * Resolve and gate the caller's effective role on a project. Throws FORBIDDEN
 * if the user lacks `minRole`. Returns the access object so callers can reuse
 * it (e.g. for owner-id lookups, audit fields) without a second DB round-trip.
 */
export async function assertProjectAccess(
  projectId: number,
  userId: number,
  minRole: EffectiveRole,
): Promise<ProjectAccess> {
  const access = await getProjectAccess(projectId, userId);
  if (!access) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  if (ROLE_RANK[access.role] < ROLE_RANK[minRole]) {
    throw new TRPCError({ code: "FORBIDDEN", message: `需要 ${minRole} 权限` });
  }
  return access;
}

/** Convenience wrapper — owner-only operations. */
export async function assertProjectOwner(projectId: number, userId: number) {
  return assertProjectAccess(projectId, userId, "owner");
}
