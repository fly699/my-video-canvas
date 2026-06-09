import { describe, it, expect } from "vitest";
import type { TrpcContext } from "./_core/context";
import { resolveKieKey, resolveKieKeyOrNull } from "./_core/kie";

// In the test env there is no DATABASE_URL, so db.* uses the in-memory dev
// fallbacks (no bindings, whitelist kieEnabled=false) and no real network.
const userCtx = { user: { id: 1, role: "user" }, clientIp: "1.2.3.4" } as unknown as TrpcContext;
const adminCtx = { user: { id: 2, role: "admin" }, clientIp: "1.2.3.4" } as unknown as TrpcContext;

describe("resolveKieKey 优先级", () => {
  it("临时 key 最高优先：直接返回，不查 DB/白名单", async () => {
    const r = await resolveKieKey(userCtx, "  temp-abc  ");
    expect(r).toEqual({ key: "temp-abc", source: "temp", label: "临时" });
  });

  it("无临时/无分配 + 非管理员 + kie 开关关 → 拒绝（house 不可用）", async () => {
    await expect(resolveKieKey(userCtx, "   ")).rejects.toBeTruthy();
    expect(await resolveKieKeyOrNull(userCtx)).toBeNull();
  });

  it("管理员无分配 key 时落到 house；house 未配置（无 KIE_API_KEY）则拒绝", async () => {
    // 测试环境通常未设 KIE_API_KEY → 管理员通过 house 闸门后因 key 未配置而被拒。
    await expect(resolveKieKey(adminCtx)).rejects.toBeTruthy();
  });
});
