import { describe, it, expect } from "vitest";
import {
  devUpsertCollaborator, devUpdateCollaboratorRole, devRemoveCollaborator,
  devListCollaborators, devCreateShareLink, devRevokeShareLink, devListShareLinks,
  devConsumeShareLink, devRefundShareLink, devFindCollaborator,
} from "./_core/devStore";
import { redactRosterFor } from "./routers/collaboration";

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

describe("listMembers 名册脱敏（PII 泄露回归）", () => {
  const rows = [
    { id: 1, email: "owner@x.com" as string | null, status: "active" },
    { id: 2, email: "pending@x.com" as string | null, status: "pending" },
  ];
  it("公开只读访客：看不到任何邮箱，且看不到待激活邀请", () => {
    const out = redactRosterFor("viewer", "public", rows);
    expect(out).toHaveLength(1); // pending 被隐藏
    expect(out[0].email).toBeNull(); // active 邮箱被置空
  });
  it("普通协作者(viewer/editor)：保留 active 邮箱，但隐藏待激活邀请", () => {
    const out = redactRosterFor("editor", "collaborator", rows);
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("owner@x.com");
  });
  it("owner/admin：完整名册（含 pending 与邮箱）", () => {
    expect(redactRosterFor("owner", "owner", rows)).toHaveLength(2);
    expect(redactRosterFor("admin", "collaborator", rows).find((r) => r.status === "pending")?.email).toBe("pending@x.com");
  });
});

describe("share-link 名额：同一用户并发双击只净扣 1（refund 回归）", () => {
  // Mirrors acceptLinkRow accounting: each accept consumes a slot, then refunds it
  // when the upsert was NOT a new membership (a concurrent same-user accept won the
  // race). Without the refund, one user double-clicking would burn two link uses.
  const upsertWithWasNew = (projectId: number, userId: number) => {
    const before = devFindCollaborator(projectId, userId);
    const row = devUpsertCollaborator({ projectId, userId, email: `u${userId}@x.com`, role: "viewer", invitedBy: 1, status: "active" });
    return { row, wasNew: !before };
  };

  it("两次并发接受（maxUses=2）→ usesCount 净=1、协作者 1 行", () => {
    const link = devCreateShareLink({ token: "tok-refund", projectId: 7000, role: "viewer", maxUses: 2, usesCount: 0, expiresAt: new Date(Date.now() + 86400_000), createdBy: 1 });
    // 两个并发请求都先扣名额（各成功），再各自 upsert
    expect(devConsumeShareLink(link.id)).toBe(true);
    expect(devConsumeShareLink(link.id)).toBe(true);
    const a = upsertWithWasNew(7000, 42);
    const b = upsertWithWasNew(7000, 42);
    if (!a.wasNew) devRefundShareLink(link.id);
    if (!b.wasNew) devRefundShareLink(link.id);
    expect([a.wasNew, b.wasNew]).toEqual([true, false]);
    expect(devListShareLinks(7000).find((l) => l.id === link.id)!.usesCount).toBe(1); // 净扣 1
    expect(devListCollaborators(7000).filter((c) => c.userId === 42)).toHaveLength(1);
  });

  it("正常单次接受仍扣 1；refund 不会把 usesCount 压到负数", () => {
    const link = devCreateShareLink({ token: "tok-solo", projectId: 7001, role: "viewer", maxUses: 2, usesCount: 0, expiresAt: new Date(Date.now() + 86400_000), createdBy: 1 });
    devConsumeShareLink(link.id);
    const a = upsertWithWasNew(7001, 50);
    if (!a.wasNew) devRefundShareLink(link.id);
    expect(devListShareLinks(7001).find((l) => l.id === link.id)!.usesCount).toBe(1);
    // 越界保护：usesCount 已是 1，连退两次也不会变负
    expect(devRefundShareLink(link.id)).toBe(true);
    expect(devRefundShareLink(link.id)).toBe(false);
    expect(devListShareLinks(7001).find((l) => l.id === link.id)!.usesCount).toBe(0);
  });
});
