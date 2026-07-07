import { describe, it, expect } from "vitest";
import { isBlockedIp, assertPublicHttpUrl } from "./_core/notifyWebhook";

describe("isBlockedIp — SSRF 私网/环回/元数据段守卫", () => {
  const blocked = [
    "127.0.0.1", "127.10.20.30", "0.0.0.0", "10.0.0.1", "10.255.255.255",
    "172.16.0.1", "172.31.255.255", "192.168.0.1", "192.168.255.255",
    "169.254.169.254", "169.254.0.1", "100.64.0.1", "100.127.255.255",
    "198.18.0.1", "198.19.255.255", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1",
    "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:10.0.0.1",
    "not-an-ip",
  ];
  for (const ip of blocked) it(`拒绝 ${ip}`, () => expect(isBlockedIp(ip)).toBe(true));

  const allowed = [
    "8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "100.63.255.255",
    "100.128.0.1", "11.0.0.1", "203.0.113.5", "2606:4700:4700::1111", "2001:4860:4860::8888",
  ];
  for (const ip of allowed) it(`放行公网 ${ip}`, () => expect(isBlockedIp(ip)).toBe(false));
});

describe("assertPublicHttpUrl — URL 级校验（无需 DNS 的路径）", () => {
  it("拒绝非 http(s) 协议", async () => {
    await expect(assertPublicHttpUrl("ftp://example.com/x")).rejects.toThrow();
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow();
  });
  it("拒绝 localhost / .local / .internal 主机名", async () => {
    await expect(assertPublicHttpUrl("http://localhost/hook")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://foo.local/hook")).rejects.toThrow();
    await expect(assertPublicHttpUrl("https://svc.internal/hook")).rejects.toThrow();
  });
  it("拒绝私网/环回/元数据 IP 字面量", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1/x")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://10.1.2.3/x")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://[::1]/x")).rejects.toThrow();
  });
  it("放行公网 IP 字面量", async () => {
    const u = await assertPublicHttpUrl("https://8.8.8.8/hook");
    expect(u.hostname).toBe("8.8.8.8");
  });
  it("非法 URL 抛错", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toThrow();
  });
});
