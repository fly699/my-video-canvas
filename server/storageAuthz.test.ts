import { describe, it, expect, vi } from "vitest";
import { authorizeStorageKeyRead } from "./_core/storageProxy";

// 攻击核查：模拟「已入库产物」+「项目访问」+「会话成员」三类映射，验证 IDOR 被堵、正当访问不误伤。
const mkDeps = (opts: {
  members?: Array<[number, number]>;                       // [convId, userId] 成员对
  assets?: Record<string, { userId: number; projectId: number | null }>; // storageKey → 产物
  projectAccess?: Array<[number, number]>;                 // [projectId, userId] 有访问权
}) => ({
  isChatMember: vi.fn(async (c: number, u: number) => (opts.members ?? []).some(([cc, uu]) => cc === c && uu === u)),
  getAssetByStorageKey: vi.fn(async (k: string) => opts.assets?.[k] ?? null),
  getProjectAccess: vi.fn(async (p: number, u: number) => ((opts.projectAccess ?? []).some(([pp, uu]) => pp === p && uu === u) ? { role: "viewer" } : null)),
});

const alice = { id: 1, role: "user" };
const bob = { id: 2, role: "user" };
const admin = { id: 9, role: "admin" };

describe("authorizeStorageKeyRead — IDOR 收敛（#93）", () => {
  it("未登录一律拒绝", async () => {
    expect(await authorizeStorageKeyRead("u/1/x", null, mkDeps({}))).toBe(false);
  });

  it("管理员放行（审核）", async () => {
    expect(await authorizeStorageKeyRead("u/1/uploads/x", admin, mkDeps({}))).toBe(true);
  });

  it("攻击：Bob 拿到 Alice 已入库产物的 key（无项目访问）→ 拒绝", async () => {
    const deps = mkDeps({ assets: { "u/1/gen/vid.mp4": { userId: 1, projectId: 5 } } });
    expect(await authorizeStorageKeyRead("u/1/gen/vid.mp4", bob, deps)).toBe(false);
  });

  it("攻击：Bob 读 generated-videos/ 下 Alice 的产物（无项目访问）→ 拒绝", async () => {
    const deps = mkDeps({ assets: { "generated-videos/x.mp4": { userId: 1, projectId: 5 } } });
    expect(await authorizeStorageKeyRead("generated-videos/x.mp4", bob, deps)).toBe(false);
  });

  it("属主读自己的 u/ 对象 → 放行（含未入库上传）", async () => {
    expect(await authorizeStorageKeyRead("u/1/uploads/ref.png", alice, mkDeps({}))).toBe(true);
  });

  it("产物属主本人（按 assets 反查）→ 放行", async () => {
    const deps = mkDeps({ assets: { "generated-videos/x.mp4": { userId: 1, projectId: 5 } } });
    expect(await authorizeStorageKeyRead("generated-videos/x.mp4", alice, deps)).toBe(true);
  });

  it("项目协作者读共享画布里他人的已入库产物 → 放行（不断协作）", async () => {
    const deps = mkDeps({ assets: { "u/1/gen/img.png": { userId: 1, projectId: 5 } }, projectAccess: [[5, 2]] });
    expect(await authorizeStorageKeyRead("u/1/gen/img.png", bob, deps)).toBe(true);
  });

  it("未入库 key（如他人上传的参考图，assets 查不到）→ 保持放行（零回归）", async () => {
    expect(await authorizeStorageKeyRead("u/1/uploads/ref.png", bob, mkDeps({}))).toBe(true);
  });

  it("聊天附件：非成员拒绝、成员放行", async () => {
    const deps = mkDeps({ members: [[7, 1]] });
    expect(await authorizeStorageKeyRead("chat/7/2024/a.png", bob, deps)).toBe(false);
    expect(await authorizeStorageKeyRead("chat/7/2024/a.png", alice, deps)).toBe(true);
  });

  it("产物有 projectId 但为 null（无项目）→ 非属主一律拒绝", async () => {
    const deps = mkDeps({ assets: { "generated-videos/x.mp4": { userId: 1, projectId: null } } });
    expect(await authorizeStorageKeyRead("generated-videos/x.mp4", bob, deps)).toBe(false);
  });
});
