import { describe, it, expect } from "vitest";
import { bearerFromAuthHeader, sdk } from "./_core/sdk";
import { clientWantsToken } from "./_core/emailAuth";

describe("移动端鉴权：Bearer 令牌提取", () => {
  it("标准 Bearer 头 → 取出令牌", () => {
    expect(bearerFromAuthHeader("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });
  it("大小写不敏感 + 容忍空白", () => {
    expect(bearerFromAuthHeader("  bearer   tok123  ")).toBe("tok123");
  });
  it("数组头取第一个", () => {
    expect(bearerFromAuthHeader(["Bearer tok", "x"])).toBe("tok");
  });
  it("非 Bearer / 空 / undefined → undefined", () => {
    expect(bearerFromAuthHeader("Basic zzz")).toBeUndefined();
    expect(bearerFromAuthHeader("Bearer   ")).toBeUndefined();
    expect(bearerFromAuthHeader(undefined)).toBeUndefined();
    expect(bearerFromAuthHeader("")).toBeUndefined();
  });
});

describe("移动端鉴权：是否把令牌放进响应体（显式 opt-in）", () => {
  it("X-Auth-Mode: token → true（大小写/空白不敏感）", () => {
    expect(clientWantsToken("token", undefined)).toBe(true);
    expect(clientWantsToken(" Token ", undefined)).toBe(true);
    expect(clientWantsToken(["token"], undefined)).toBe(true);
  });
  it("body tokenInBody:true → true", () => {
    expect(clientWantsToken(undefined, true)).toBe(true);
  });
  it("Web 默认（不传）→ false，令牌不落响应体", () => {
    expect(clientWantsToken(undefined, undefined)).toBe(false);
    expect(clientWantsToken("cookie", false)).toBe(false);
    expect(clientWantsToken("", "true")).toBe(false); // 字符串 "true" 不算，须布尔 true
  });
});

describe("移动端鉴权：Bearer 令牌与 Cookie 是同一 JWT（round-trip）", () => {
  it("signSession 出的令牌，经 Bearer 提取后能被 verifySession 验证通过", async () => {
    const tok = await sdk.signSession({ openId: "email:m@e.com", appId: "", name: "M" });
    const extracted = bearerFromAuthHeader(`Bearer ${tok}`);
    expect(extracted).toBe(tok);
    const session = await sdk.verifySession(extracted);
    expect(session?.openId).toBe("email:m@e.com");
  });
});
