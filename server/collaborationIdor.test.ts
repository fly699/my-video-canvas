import { describe, it, expect } from "vitest";
import {
  devUpsertCollaborator, devUpdateCollaboratorRole, devRemoveCollaborator,
  devListCollaborators, devCreateShareLink, devRevokeShareLink, devListShareLinks,
} from "./_core/devStore";

// Regression for the cross-tenant IDOR: collaborator-role/remove/share-revoke
// helpers must scope mutations by projectId, not just the row id. An admin who
// only proved access to project A must not be able to mutate project B's rows
// by passing a raw memberId/linkId.
describe("协作操作 projectId 归属约束（IDOR 回归）", () => {
  it("updateCollaboratorRole 用错误 projectId → 不改动、返回 false", () => {
    const victim = devUpsertCollaborator({ projectId: 1001, userId: 7, role: "editor", invitedBy: 1, status: "active" });
    // attacker is admin of project 2002, tries to demote a member of project 1001
    const ok = devUpdateCollaboratorRole(victim.id, 2002, "viewer");
    expect(ok).toBe(false);
    expect(devListCollaborators(1001).find((c) => c.id === victim.id)!.role).toBe("editor"); // unchanged
    // correct projectId still works
    expect(devUpdateCollaboratorRole(victim.id, 1001, "viewer")).toBe(true);
    expect(devListCollaborators(1001).find((c) => c.id === victim.id)!.role).toBe("viewer");
  });

  it("removeCollaborator 用错误 projectId → 不删除、返回 false", () => {
    const victim = devUpsertCollaborator({ projectId: 1003, userId: 8, role: "editor", invitedBy: 1, status: "active" });
    expect(devRemoveCollaborator(victim.id, 9999)).toBe(false);
    expect(devListCollaborators(1003).some((c) => c.id === victim.id)).toBe(true); // still there
    expect(devRemoveCollaborator(victim.id, 1003)).toBe(true);
    expect(devListCollaborators(1003).some((c) => c.id === victim.id)).toBe(false);
  });

  it("revokeShareLink 用错误 projectId → 不吊销、返回 false", () => {
    const link = devCreateShareLink({ token: "tkn-idor", projectId: 1005, role: "viewer", maxUses: 1, usesCount: 0, expiresAt: new Date(Date.now() + 86400_000), createdBy: 1 });
    expect(devRevokeShareLink(link.id, 4242)).toBe(false);
    expect(devListShareLinks(1005).find((l) => l.id === link.id)!.revokedAt).toBeFalsy(); // not revoked
    expect(devRevokeShareLink(link.id, 1005)).toBe(true);
    expect(devListShareLinks(1005).find((l) => l.id === link.id)!.revokedAt).toBeTruthy();
  });
});
