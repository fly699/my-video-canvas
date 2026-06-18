import { describe, it, expect } from "vitest";
import { tunnelHostFromUrl, isTunnelRequest, isTunnelExemptPath, isTunnelAllowed, parseQuickTunnelUrl } from "./_core/tunnelGate";

describe("tunnelHostFromUrl", () => {
  it("提取 host（含无协议/端口）", () => {
    expect(tunnelHostFromUrl("https://abc-123.trycloudflare.com")).toBe("abc-123.trycloudflare.com");
    expect(tunnelHostFromUrl("video.example.com")).toBe("video.example.com");
    expect(tunnelHostFromUrl("https://h:8443/x")).toBe("h");
    expect(tunnelHostFromUrl(null)).toBe("");
  });
});

describe("isTunnelRequest — CF 边缘标记 或 Host 匹配", () => {
  const th = "abc.trycloudflare.com";
  it("有 Cloudflare 边缘标记 → true（不依赖 Host，cloudflared 改写 Host 也能识别）", () => {
    expect(isTunnelRequest({ host: "localhost:3000", "cf-ray": "abc123" }, th)).toBe(true);
    expect(isTunnelRequest({ "cdn-loop": "cloudflare; loops=1" }, "")).toBe(true);
    expect(isTunnelRequest({ "cf-connecting-ip": "203.0.113.5" }, "")).toBe(true);
  });
  it("无 CF 标记时回退 Host 匹配（external 反代模式）", () => {
    expect(isTunnelRequest({ host: "video.example.com:443" }, "video.example.com")).toBe(true);
    expect(isTunnelRequest({ host: "video.example.com" }, "")).toBe(false);
  });
  it("本地/局域网（无 CF 标记 + Host 不匹配）→ false", () => {
    expect(isTunnelRequest({ host: "localhost:3000" }, th)).toBe(false);
    expect(isTunnelRequest({ host: "192.168.1.10:3000" }, th)).toBe(false);
  });
});

describe("isTunnelExemptPath — 仅放行登录/静态", () => {
  it("放行 auth + 静态 SPA", () => {
    for (const p of ["/", "/login", "/assets/app.js", "/api/auth/login", "/api/auth/providers", "/api/trpc/auth.me"]) {
      expect(isTunnelExemptPath(p)).toBe(true);
    }
  });
  it("拦截一切应用 API", () => {
    for (const p of ["/api/trpc/canvas.list", "/api/trpc/comfyui.generateImage", "/manus-storage/x", "/api/image-proxy"]) {
      expect(isTunnelExemptPath(p)).toBe(false);
    }
  });
});

describe("isTunnelAllowed — 隧道白名单(IP 或 用户)", () => {
  const wl = { users: [7, 9], ips: ["1.2.3.4", "10.0.0.5"] };
  it("用户在名单 → 放行", () => expect(isTunnelAllowed("9.9.9.9", 7, wl)).toBe(true));
  it("IP 在名单（含 ::ffff: 归一）→ 放行", () => {
    expect(isTunnelAllowed("1.2.3.4", undefined, wl)).toBe(true);
    expect(isTunnelAllowed("::ffff:1.2.3.4", undefined, wl)).toBe(true);
  });
  it("都不在名单 → 拦截（空名单=谁都进不来）", () => {
    expect(isTunnelAllowed("9.9.9.9", 99, wl)).toBe(false);
    expect(isTunnelAllowed("9.9.9.9", undefined, { users: [], ips: [] })).toBe(false);
    expect(isTunnelAllowed("unknown", undefined, wl)).toBe(false);
  });
});

describe("parseQuickTunnelUrl", () => {
  it("从 cloudflared 日志抽 trycloudflare URL", () => {
    const log = `2024 INF |  Your quick Tunnel has been created! Visit it at:  |\n2024 INF |  https://random-words-1234.trycloudflare.com  |`;
    expect(parseQuickTunnelUrl(log)).toBe("https://random-words-1234.trycloudflare.com");
  });
  it("无 URL → null", () => expect(parseQuickTunnelUrl("starting...")).toBeNull());
});
