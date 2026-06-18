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

describe("isTunnelRequest — 精确按 Host 匹配", () => {
  const th = "abc.trycloudflare.com";
  it("Host 等于隧道主机 → true（忽略端口/大小写/逗号链）", () => {
    expect(isTunnelRequest("abc.trycloudflare.com", th)).toBe(true);
    expect(isTunnelRequest("ABC.trycloudflare.com:443", th)).toBe(true);
    expect(isTunnelRequest("abc.trycloudflare.com, edge", th)).toBe(true);
  });
  it("其它 Host / 未配置隧道 → false（不误伤本地/已在CF后的其它域名）", () => {
    expect(isTunnelRequest("localhost:3000", th)).toBe(false);
    expect(isTunnelRequest("video.example.com", th)).toBe(false);
    expect(isTunnelRequest("abc.trycloudflare.com", "")).toBe(false);
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
