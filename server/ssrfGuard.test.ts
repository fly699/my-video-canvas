import { describe, it, expect } from "vitest";
import { isAllowedExternalUrl, assertPublicUrl, isCloudMetadataHost } from "./_core/ssrfGuard";

describe("isAllowedExternalUrl — SSRF guard", () => {
  it("allows normal public https hosts", () => {
    expect(isAllowedExternalUrl("https://poyo.ai/x.png")).toBe(true);
    expect(isAllowedExternalUrl("https://cdn.example.com/a.mp4")).toBe(true);
  });

  it("blocks non-https", () => {
    expect(isAllowedExternalUrl("http://example.com/x")).toBe(false);
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("ftp://example.com")).toBe(false);
  });

  it("blocks loopback in every form (the old gaps)", () => {
    for (const h of ["127.0.0.1", "127.0.0.2", "127.1.2.3", "0.0.0.0", "2130706433", "0x7f000001"]) {
      expect(isAllowedExternalUrl(`https://${h}/`)).toBe(false);
    }
  });

  it("blocks private / link-local / metadata", () => {
    for (const h of ["10.0.0.5", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "localhost", "metadata.google.internal", "foo.localhost"]) {
      expect(isAllowedExternalUrl(`https://${h}/`)).toBe(false);
    }
  });

  it("blocks internal IPv6 (loopback / ULA / link-local / mapped)", () => {
    for (const h of ["[::1]", "[::]", "[fc00::1]", "[fd12::3]", "[fe80::1]", "[::ffff:127.0.0.1]", "[::ffff:10.0.0.1]"]) {
      expect(isAllowedExternalUrl(`https://${h}/`)).toBe(false);
    }
  });

  it("allows public IPv6", () => {
    expect(isAllowedExternalUrl("https://[2606:4700::1111]/")).toBe(true);
  });
});

// assertPublicUrl is the shared throwing guard for download points that must also
// allow http:// (LAN storage / self-hosted media). Same strong host check, used
// on both the input URL and the post-redirect res.url.
describe("assertPublicUrl — http(s) 下载点强守卫", () => {
  const blocked = (u: string) => { try { assertPublicUrl(u); return false; } catch { return true; } };

  it("放行公网 http 与 https", () => {
    expect(blocked("https://example.com/a.mp4")).toBe(false);
    expect(blocked("http://cdn.example.com:8080/a.png")).toBe(false);
  });

  it("拦截内网/环回/元数据/整数·十六进制 IPv4/内网 IPv6（含 http）", () => {
    for (const u of [
      "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/",
      "http://192.168.1.1/", "http://localhost:3000/", "http://2130706433/", "http://0x7f000001/",
      "http://[::1]/", "http://[fd00::1]/", "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/",
    ]) expect(blocked(u)).toBe(true);
  });

  it("拒绝非 http(s) 协议与畸形 URL", () => {
    expect(blocked("file:///etc/passwd")).toBe(true);
    expect(blocked("gopher://x/")).toBe(true);
    expect(blocked("not a url")).toBe(true);
  });
});

describe("isCloudMetadataHost — 仅拦云元数据端点（保留内网放行，供 ComfyUI 等用）", () => {
  it("拦截 IMDS 的各种字面形式", () => {
    for (const h of [
      "169.254.169.254",        // AWS/GCP/Azure/Oracle/OpenStack IMDS（点分）
      "2852039166",             // 169.254.169.254 的十进制整数形式
      "0xa9fea9fe",             // 十六进制形式
      "metadata.google.internal", "foo.metadata.google.internal",
      "100.100.100.200",        // 阿里云
      "fd00:ec2::254",          // AWS IPv6 IMDS
    ]) expect(isCloudMetadataHost(h)).toBe(true);
  });

  it("放行普通内网/环回/公网主机（不破坏自建内网 ComfyUI）", () => {
    for (const h of [
      "127.0.0.1", "localhost", "10.0.0.5", "192.168.1.50", "172.16.0.9",
      "comfy.lan", "example.com", "169.254.1.1", // 链路本地但非 IMDS → 仍放行
    ]) expect(isCloudMetadataHost(h)).toBe(false);
  });
});
