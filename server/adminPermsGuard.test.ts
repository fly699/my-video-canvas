// 权限矩阵 + 提权守卫的「对抗测试」：构造各管理员级别的真实 tRPC 调用者，攻击后台端点，
// 断言越权被拒、合法放行。覆盖 setLevel 夺权、矩阵后端强制、perms 站长独占、broadcast 豁免。
import { describe, it, expect, beforeEach, vi } from "vitest";

// db 部分 mock：保留真实 devStore（矩阵状态、日志等走内存），仅覆盖 setLevel 攻击需要的
// 「按 id 返回指定级别目标用户」与「写级别」——devStore 的 getUserById 只合成非管理员。
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, getUserById: vi.fn(actual.getUserById), setUserAdminLevel: vi.fn(async () => {}) };
});

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import { invalidateAdminPermsCache } from "./_core/adminPerms";

function ctxAt(level: number, id = 100): TrpcContext {
  const isAdmin = level >= 1;
  return {
    user: {
      id, openId: `u${id}`, name: `L${level}`, email: `l${level}@x.com`, loginMethod: "manus",
      passwordHash: null, role: isAdmin ? "admin" : "user", adminLevel: level,
      disabled: false, emailVerified: true, approved: true, verifyCode: null, verifyCodeExpiresAt: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    clientIp: "127.0.0.1",
  };
}
const call = (level: number) => appRouter.createCaller(ctxAt(level));
/** 断言抛 FORBIDDEN。 */
async function denied(p: Promise<unknown>) {
  await expect(p).rejects.toMatchObject({ code: "FORBIDDEN" });
}

beforeEach(async () => {
  await db.setAdminPermsJson("{}"); // 恢复默认矩阵
  invalidateAdminPermsCache();
  vi.mocked(db.getUserById).mockReset();
});

describe("对抗①：日志/聊天页默认 L4 后端强制（低级管理员经 API 绕过也被拒）", () => {
  it("L3 管理员直调日志/聊天查询接口 → 全部 FORBIDDEN", async () => {
    await denied(call(3).admin.logs.list({ limit: 10, offset: 0 }));
    await denied(call(3).admin.comfyLogs.list({ limit: 10, offset: 0 }));
    await denied(call(3).admin.llmLogs.list({ limit: 10, offset: 0 }));
    await denied(call(3).admin.llmLogs.detail({ id: 1 }));          // 含完整 prompt，最敏感
    await denied(call(3).admin.chat.listConversations({}));
    await denied(call(3).admin.chat.searchMessages({}));
    await denied(call(3).admin.chat.listFiles({}));                 // 聊天附件浏览
  });
  it("L2 管理员清空日志 → FORBIDDEN（矩阵 L4 高于静态 L2）", async () => {
    await denied(call(2).admin.logs.clear());
    await denied(call(2).admin.llmLogs.clear());
  });
  it("L4 超管读日志 → 放行（不抛 FORBIDDEN）", async () => {
    await expect(call(4).admin.logs.list({ limit: 5, offset: 0 })).resolves.toBeDefined();
    await expect(call(4).admin.llmLogs.summary({})).resolves.toBeDefined();
    await expect(call(4).admin.chat.listConversations({})).resolves.toBeDefined();
  });
});

describe("对抗②：矩阵收紧后端即时生效", () => {
  it("站长把「存储设置」设为 L5 → L3 原本可读的接口变 FORBIDDEN，L5 仍可读", async () => {
    await expect(call(3).admin.storage.getSettings()).resolves.toBeDefined(); // 默认 storage=L1
    await db.setAdminPermsJson(JSON.stringify({ storage: 5 }));
    invalidateAdminPermsCache();
    await denied(call(3).admin.storage.getSettings());
    await denied(call(4).admin.storage.getSettings());
    await expect(call(5).admin.storage.getSettings()).resolves.toBeDefined();
  });
});

describe("对抗③：广播豁免矩阵（聊天室 L3 功能不被 chat 页 L4 误伤）", () => {
  it("broadcastTargets：L3 放行、L2 拒绝（靠 managerProc，不受 chat 矩阵 L4 约束）", async () => {
    await expect(call(3).admin.chat.broadcastTargets()).resolves.toBeDefined();
    await denied(call(2).admin.chat.broadcastTargets());
  });
});

describe("对抗④：权限矩阵管理站长独占", () => {
  it("perms.set：L4 超管 FORBIDDEN、L5 站长放行", async () => {
    await denied(call(4).admin.perms.set({ access: { logs: { view: 1, operate: 1 } } }));
    await expect(call(5).admin.perms.set({ access: { logs: { view: 4, operate: 4 } } })).resolves.toBeDefined();
    await db.setAdminPermsJson("{}"); invalidateAdminPermsCache();
  });
  it("perms.get：任意管理员可读（供前端过滤 tab），非管理员 FORBIDDEN", async () => {
    await expect(call(1).admin.perms.get()).resolves.toBeDefined();
    await denied(call(0).admin.perms.get());
  });
});

describe("对抗⑤：setLevel 夺权/提权守卫", () => {
  const target = (id: number, level: number, role: "admin" | "user" = level >= 1 ? "admin" : "user") =>
    vi.mocked(db.getUserById).mockResolvedValue({ id, role, adminLevel: level } as Awaited<ReturnType<typeof db.getUserById>>);

  it("L4 超管企图把 L5 站长降为普通用户 → FORBIDDEN（不能操作更高级别）", async () => {
    target(200, 5);
    await denied(call(4).admin.users.setLevel({ userId: 200, level: 0 }));
  });
  it("L4 超管企图改另一个 L4 → FORBIDDEN（不能操作同级）", async () => {
    target(200, 4);
    await denied(call(4).admin.users.setLevel({ userId: 200, level: 0 }));
  });
  it("L4 超管企图把普通用户提到 L5 → FORBIDDEN（不能授予高于自己）", async () => {
    target(200, 0);
    await denied(call(4).admin.users.setLevel({ userId: 200, level: 5 }));
  });
  it("L4 超管把普通用户设为 L2 运营 → 放行", async () => {
    target(200, 0);
    await expect(call(4).admin.users.setLevel({ userId: 200, level: 2 })).resolves.toMatchObject({ success: true });
  });
  it("L5 站长把 L4 超管降级 → 放行（站长可管超管）", async () => {
    target(200, 4);
    await expect(call(5).admin.users.setLevel({ userId: 200, level: 1 })).resolves.toMatchObject({ success: true });
  });
  it("站长企图改另一个站长(L5) → FORBIDDEN（同级不可夺权）", async () => {
    target(200, 5);
    await denied(call(5).admin.users.setLevel({ userId: 200, level: 0 }));
  });
  it("改自己的级别 → 拒绝（防自我锁死/自提升）", async () => {
    target(100, 5);
    await expect(call(5).admin.users.setLevel({ userId: 100, level: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("对抗⑥：跨页共享的非敏感只读端点豁免（不误伤），但敏感数据/写仍受矩阵强制", () => {
  // whitelist.getSettings 只回 4 个功能布尔标志，被 KiePanel(kie 页 L1) 与白名单页共同只读引用，
  // 豁免矩阵——否则 L1/L2 管理员打开 KIE 页就 403。而真正敏感的 listEntries（IP 明细）与写开关
  // 仍是 managerProc + whitelist 页矩阵，绝不豁免（否则就是「前端藏、API 通」的自欺欺人）。
  it("getSettings：L1 查看员可读（默认），豁免生效", async () => {
    await expect(call(1).admin.whitelist.getSettings()).resolves.toBeDefined();
  });
  it("站长把「白名单」收紧到 L5 后，getSettings 仍 L1 可读（豁免不随页面收紧误伤 KIE 页）", async () => {
    await db.setAdminPermsJson(JSON.stringify({ whitelist: 5 }));
    invalidateAdminPermsCache();
    await expect(call(1).admin.whitelist.getSettings()).resolves.toBeDefined();
    await expect(call(3).admin.whitelist.getSettings()).resolves.toBeDefined();
  });
  it("敏感的 listEntries（IP 明细）：默认受静态 managerProc L3 拦 L1/L2", async () => {
    await denied(call(1).admin.whitelist.listEntries());
    await denied(call(2).admin.whitelist.listEntries());
    await expect(call(3).admin.whitelist.listEntries()).resolves.toBeDefined();
  });
  it("站长把「白名单」收紧到 L5 → 敏感 listEntries 对 L3/L4 变 FORBIDDEN（矩阵强制，无 API 绕过）", async () => {
    await db.setAdminPermsJson(JSON.stringify({ whitelist: 5 }));
    invalidateAdminPermsCache();
    await denied(call(3).admin.whitelist.listEntries());
    await denied(call(4).admin.whitelist.listEntries());
    await expect(call(5).admin.whitelist.listEntries()).resolves.toBeDefined();
  });
  it("站长把「白名单」收紧到 L5 → 敏感写开关 setEnabled 对 L4 变 FORBIDDEN", async () => {
    await db.setAdminPermsJson(JSON.stringify({ whitelist: 5 }));
    invalidateAdminPermsCache();
    await denied(call(4).admin.whitelist.setEnabled({ enabled: false }));
  });
});

describe("对抗⑦：双级别矩阵（view 门控读 / operate 门控写），只读层生效且写不被绕过", () => {
  // 站长把「操作日志」页设为 view=2 / operate=4：L2/L3 可只读查看日志，但清空(写)仍需 L4。
  it("logs view=2/operate=4：L2 可读 list（query 走 view），但清空(mutation 走 operate)被拒", async () => {
    await db.setAdminPermsJson(JSON.stringify({ logs: { view: 2, operate: 4 } }));
    invalidateAdminPermsCache();
    await expect(call(2).admin.logs.list({ limit: 5, offset: 0 })).resolves.toBeDefined(); // 只读放行
    await expect(call(3).admin.logs.list({ limit: 5, offset: 0 })).resolves.toBeDefined();
    await denied(call(2).admin.logs.clear()); // 写：operate=4，L2 拒
    await denied(call(3).admin.logs.clear()); // 写：operate=4，L3 拒
    await expect(call(4).admin.logs.clear()).resolves.toBeDefined(); // L4 放行
  });
  it("logs view=1：L1 查看员可只读读取日志（view 权威可降到 L1）", async () => {
    await db.setAdminPermsJson(JSON.stringify({ logs: { view: 1, operate: 4 } }));
    invalidateAdminPermsCache();
    await expect(call(1).admin.logs.list({ limit: 5, offset: 0 })).resolves.toBeDefined();
    await denied(call(1).admin.logs.clear());
  });
  it("view 不得高于 operate：给 view>operate 会被钳制（chat view=5/operate=2 → 实际 2/2）", async () => {
    await db.setAdminPermsJson(JSON.stringify({ chat: { view: 5, operate: 2 } }));
    invalidateAdminPermsCache();
    // 钳制后 view=2：L2 可读 listConversations
    await expect(call(2).admin.chat.listConversations({})).resolves.toBeDefined();
  });
});

describe("对抗⑧：非管理员/未登录彻底挡在门外", () => {
  it("普通用户 & 未登录访问 admin 端点 → FORBIDDEN / UNAUTHORIZED", async () => {
    await denied(call(0).admin.logs.list({ limit: 1, offset: 0 }));
    const anon = appRouter.createCaller({ ...ctxAt(0), user: null });
    await expect(anon.admin.perms.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
