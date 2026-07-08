import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module (whitelist.ts imports `../db` → resolves to ./db here).
vi.mock("./db", () => ({
  getWhitelistSettings: vi.fn(),
  isWhitelisted: vi.fn(async () => false),
}));

import { assertWhitelisted, invalidateWhitelistCache } from "./_core/whitelist";
import * as db from "./db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = (adminLevel = 0): any => ({ user: { id: 999, adminLevel }, clientIp: "203.0.113.9" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getWL = db.getWhitelistSettings as any;

describe("assertWhitelisted — DB 出错时 stale-while-error（不 fail-open）", () => {
  beforeEach(() => { invalidateWhitelistCache(); vi.clearAllMocks(); (db.isWhitelisted as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false); });

  it("白名单开启且用户不在内 → 拒绝", async () => {
    getWL.mockResolvedValue({ enabled: true });
    await expect(assertWhitelisted(ctx())).rejects.toThrow();
  });

  it("白名单关闭 → 放行", async () => {
    getWL.mockResolvedValue({ enabled: false });
    await expect(assertWhitelisted(ctx())).resolves.toBeUndefined();
  });

  it("DB 抖动：曾成功读到 enabled 后 DB 报错 → 门控仍拒绝（关键：不因 DB 错而 fail-open 放行）", async () => {
    getWL.mockResolvedValueOnce({ enabled: true });
    await expect(assertWhitelisted(ctx())).rejects.toThrow(); // 缓存 enabled:true
    invalidateWhitelistCache();                                // 迫使下次重读
    getWL.mockRejectedValue(new Error("db down"));
    await expect(assertWhitelisted(ctx())).rejects.toThrow();  // stale enabled:true → 仍拒绝
  });

  it("超级管理员(L4) 始终放行", async () => {
    getWL.mockResolvedValue({ enabled: true });
    await expect(assertWhitelisted(ctx(4))).resolves.toBeUndefined();
  });
});
