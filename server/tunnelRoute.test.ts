import { describe, it, expect } from "vitest";
import { CF_EDGE_ROUTES, edgeCidrsFromLog, logHasIpv6Edge, manualRouteCommands } from "./_core/tunnelRoute";

describe("tunnelRoute · 边缘网段与命令生成", () => {
  it("内置 CF 边缘 = cloudflared 实际连接的两段", () => {
    expect(CF_EDGE_ROUTES.map((r) => r.prefix)).toEqual(["198.41.192.0/24", "198.41.200.0/24"]);
  });

  it("edgeCidrsFromLog：从日志解析实际边缘 IP、收敛为 /24、与内置合并去重", () => {
    const log = [
      "Registered tunnel connection ip=198.41.200.43 location=sea07",
      "Registered tunnel connection ip=198.41.192.227 location=sea01",
      "Registered tunnel connection ip=198.41.210.9 location=xxx", // 内置外的新段 → 应被覆盖
    ].join("\n");
    const prefixes = edgeCidrsFromLog(log).map((c) => c.prefix).sort();
    expect(prefixes).toContain("198.41.192.0/24");
    expect(prefixes).toContain("198.41.200.0/24");
    expect(prefixes).toContain("198.41.210.0/24"); // 自适应到日志里的新段
  });

  it("edgeCidrsFromLog：空日志 → 只有内置两段", () => {
    expect(edgeCidrsFromLog("").map((c) => c.prefix).sort()).toEqual(["198.41.192.0/24", "198.41.200.0/24"]);
  });

  it("edgeCidrsFromLog：绝不产生默认路由/非法段", () => {
    const cidrs = edgeCidrsFromLog("ip=0.0.0.0 ip=999.1.1.1 ip=abc");
    expect(cidrs.every((c) => c.net !== "0.0.0.0")).toBe(true);
    expect(cidrs.map((c) => c.prefix)).not.toContain("0.0.0.0/24");
  });

  it("logHasIpv6Edge：识别 IPv6 边缘连接", () => {
    expect(logHasIpv6Edge("ip=2606:4700:a0::1 location=sea")).toBe(true);
    expect(logHasIpv6Edge("ip=198.41.200.43 location=sea")).toBe(false);
  });

  it("manualRouteCommands：每段一条、含网关、不含默认路由", () => {
    const cmds = manualRouteCommands("192.168.12.1");
    expect(cmds).toContain("192.168.12.1");
    expect(cmds).toContain("198.41.192.0");
    expect(cmds).toContain("198.41.200.0");
    expect(cmds).not.toContain("0.0.0.0");
    expect(cmds.split(/\r?\n/).filter(Boolean).length).toBe(2);
  });
});
