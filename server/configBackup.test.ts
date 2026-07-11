import { describe, it, expect } from "vitest";
import { gzipSync } from "zlib";
import { encryptConfig, decryptConfig, CONFIG_BACKUP_VERSION } from "./_core/configBackup";

describe("configBackup 加密管线（#75）", () => {
  const sample = JSON.stringify({
    version: CONFIG_BACKUP_VERSION,
    exportedAt: "2026-07-11T00:00:00.000Z",
    sections: {
      auth: { smtpHost: "smtp.example.com", smtpUser: "admin", smtpPass: "S3cret!密码", smtpPort: 587 },
      whitelistEntries: [{ type: "ip", value: "10.0.0.1", note: "机房" }],
      adminPerms: '{"logs":{"view":4,"operate":5}}',
    },
  });

  it("加密→解密 往返一致（含中文与敏感字段）", () => {
    const enc = encryptConfig(sample, "correct horse 电池 staple");
    expect(typeof enc).toBe("string");
    const dec = decryptConfig(enc, "correct horse 电池 staple");
    expect(dec).toBe(sample);
    expect(JSON.parse(dec).sections.auth.smtpPass).toBe("S3cret!密码");
  });

  it("密文不含明文痕迹（密码/主机名都不可见）", () => {
    const enc = encryptConfig(sample, "pw123456");
    const raw = Buffer.from(enc, "base64").toString("latin1");
    expect(raw).not.toContain("S3cret");
    expect(raw).not.toContain("smtp.example.com");
    expect(raw).not.toContain("smtpPass");
  });

  it("确实经过压缩（大重复配置密文远小于明文）", () => {
    const big = JSON.stringify({ version: 1, sections: { x: "配置项 ".repeat(5000) } });
    const enc = encryptConfig(big, "pw123456");
    expect(Buffer.from(enc, "base64").length).toBeLessThan(Buffer.byteLength(big) / 5);
    // 对照：明文 gzip 后的量级一致（加密只加固定头开销）
    expect(Buffer.from(enc, "base64").length).toBeLessThan(gzipSync(big).length + 200);
  });

  it("错误口令 → 明确报错（GCM 认证失败）", () => {
    const enc = encryptConfig(sample, "right-pass");
    expect(() => decryptConfig(enc, "wrong-pass")).toThrow(/口令错误|篡改/);
  });

  it("密文被篡改 → 拒绝（认证标签校验）", () => {
    const enc = encryptConfig(sample, "pw123456");
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] ^= 0xff; // 翻转末字节
    expect(() => decryptConfig(buf.toString("base64"), "pw123456")).toThrow(/口令错误|篡改/);
  });

  it("非本系统文件（魔数不符）→ 明确报错", () => {
    const junk = Buffer.concat([Buffer.from("NOTCFG!!"), Buffer.alloc(64, 7)]).toString("base64");
    expect(() => decryptConfig(junk, "pw")).toThrow(/魔数不符/);
    expect(() => decryptConfig("dG9vc2hvcnQ=", "pw")).toThrow(/过短|损坏/);
  });

  it("每次加密盐/IV 随机（同文同口令密文不同）", () => {
    const a = encryptConfig(sample, "pw123456");
    const b = encryptConfig(sample, "pw123456");
    expect(a).not.toBe(b);
    expect(decryptConfig(a, "pw123456")).toBe(decryptConfig(b, "pw123456"));
  });
});
