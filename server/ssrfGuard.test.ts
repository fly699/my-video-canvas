import { describe, it, expect } from "vitest";
import { isAllowedExternalUrl } from "./_core/ssrfGuard";

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
