import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.KIE_KEY_SECRET = "unit-test-secret-please-ignore-1234567890";
});

// Import after env is set (the helper falls back to process.env.KIE_KEY_SECRET).
const { encryptKieKey, decryptKieKey, kieKeyHash, kieKeyLast4, isKieCryptoConfigured } = await import("./_core/kieCrypto");

describe("kieCrypto", () => {
  it("加解密往返一致", () => {
    const plain = "kie-sk-abcdef1234567890XYZ";
    const enc = encryptKieKey(plain);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain(plain); // 密文不含明文
    expect(decryptKieKey(enc)).toBe(plain);
  });
  it("同一明文两次加密得到不同密文（随机 salt/iv）", () => {
    expect(encryptKieKey("same-key")).not.toBe(encryptKieKey("same-key"));
  });
  it("篡改密文导致解密失败（GCM 认证）", () => {
    const enc = encryptKieKey("tamper-me");
    const parts = enc.split(":");
    parts[4] = Buffer.from("totally-different-bytes").toString("base64");
    expect(() => decryptKieKey(parts.join(":"))).toThrow();
  });
  it("格式非法报错", () => {
    expect(() => decryptKieKey("not-a-valid-payload")).toThrow();
    expect(() => decryptKieKey("v2:a:b:c:d")).toThrow();
  });
  it("hash 稳定且与明文不同；last4 取末四位", () => {
    expect(kieKeyHash("abc")).toBe(kieKeyHash("abc"));
    expect(kieKeyHash("abc")).toHaveLength(64);
    expect(kieKeyLast4("kie-sk-7788")).toBe("7788");
    expect(kieKeyLast4("ab")).toBe("ab");
  });
  it("配置检测为真（已设 secret）", () => {
    expect(isKieCryptoConfigured()).toBe(true);
  });
});
