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

describe("isTunnelRequest — 专用回环端口 / CF 标记 / Host", () => {
  const th = "abc.trycloudflare.com", TP = 3101;
  it("命中专用隧道端口 → true（最可靠，不依赖任何头）", () => {
    expect(isTunnelRequest(TP, TP, { host: "localhost" }, th)).toBe(true);
  });
  it("主端口进来（本地/局域网）→ false", () => {
    expect(isTunnelRequest(3000, TP, { host: "localhost:3000" }, th)).toBe(false);
    expect(isTunnelRequest(3000, TP, { host: "192.168.1.10:3000" }, th)).toBe(false);
  });
  it("external 模式：无专用端口，回退 CF 标记 / Host", () => {
    expect(isTunnelRequest(3000, 0, { "cf-ray": "abc" }, th)).toBe(true);
    expect(isTunnelRequest(3000, 0, { host: "video.example.com:443" }, "video.example.com")).toBe(true);
    expect(isTunnelRequest(3000, 0, { host: "video.example.com" }, "")).toBe(false);
  });
});

describe("isTunnelExemptPath — 仅放行登录/静态", () => {
  it("放行 auth + 静态 SPA + 纯 auth 的 tRPC 批", () => {
    for (const p of ["/", "/login", "/assets/app.js", "/api/auth/login", "/api/auth/providers", "/api/trpc/auth.me", "/api/trpc/auth.me,auth.providers"]) {
      expect(isTunnelExemptPath(p)).toBe(true);
    }
  });
  it("拦截一切应用 API（含 batch 把 auth 和应用过程混在一起）", () => {
    for (const p of ["/api/trpc/canvas.list", "/api/trpc/comfyui.generateImage", "/manus-storage/x", "/api/image-proxy",
      "/api/trpc/auth.me,projects.list", "/api/trpc/auth.me,canvas.nodes.list,projects.list"]) {
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
