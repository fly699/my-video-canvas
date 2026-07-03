import { describe, it, expect } from "vitest";
import { CF_EDGE_ROUTES, edgeCidrsFromLog, logHasIpv6Edge, manualRouteCommands, manualRemoveCommands, routeCommand, localInterfaceIps, isLocalInterfaceIp, tunnelEgressInfo, parseTraceIp } from "./_core/tunnelRoute";

describe("tunnelRoute · 边缘网段与命令生成", () => {
  it("内置 CF 边缘 = cloudflared 实际连接的两段", () => {
    expect(CF_EDGE_ROUTES.map((r) => r.prefix)).toEqual(["198.41.192.0/24", "198.41.200.0/24"]);
  });

  it("edgeCidrsFromLog：只纳入 CF 边缘块(198.41.192.0/20)内的 IP；块外/局域网一律忽略（只针对隧道）", () => {
    const log = [
      "Registered tunnel connection ip=198.41.200.43 location=sea07",
      "Registered tunnel connection ip=198.41.192.227 location=sea01",
      "Registered tunnel connection ip=198.41.196.9 location=sea02",  // 块内 → 自适应纳入
      "Registered tunnel connection ip=198.41.210.9 location=xxx",    // 块外 → 忽略
      "some noise ip=192.168.12.5",                                    // 局域网 → 绝不纳入
    ].join("\n");
    const prefixes = edgeCidrsFromLog(log).map((c) => c.prefix);
    expect(prefixes).toContain("198.41.192.0/24");
    expect(prefixes).toContain("198.41.200.0/24");
    expect(prefixes).toContain("198.41.196.0/24");     // 块内自适应
    expect(prefixes).not.toContain("198.41.210.0/24"); // 块外忽略
    expect(prefixes).not.toContain("192.168.12.0/24"); // 局域网绝不误伤
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

  it("localInterfaceIps：返回 v4/v6 数组且排除回环", () => {
    const { v4, v6 } = localInterfaceIps();
    expect(Array.isArray(v4)).toBe(true);
    expect(Array.isArray(v6)).toBe(true);
    expect(v4).not.toContain("127.0.0.1"); // 内部/回环已排除
    expect(v6).not.toContain("::1");
  });

  it("isLocalInterfaceIp：非本机地址（TEST-NET RFC5737）返回 false", () => {
    expect(isLocalInterfaceIp("192.0.2.111")).toBe(false); // 保留测试网段，绝不会是本机网卡地址
  });

  it("tunnelEgressInfo：快速隧道+绑定 → 源 IP 即绑定 IP，dest 取日志边缘 IP", async () => {
    const r = await tunnelEgressInfo("203.0.113.9", true, "conn ip=198.41.200.5 loc=sea");
    expect(r.via).toBe("bind");
    expect(r.sourceIp).toBe("203.0.113.9");
    expect(r.dest).toBe("198.41.200.5");
  });

  it("tunnelEgressInfo：无日志时 dest 用内置代表边缘 IP", async () => {
    const r = await tunnelEgressInfo("203.0.113.9", true, "");
    expect(r.dest).toBe("198.41.192.227");
  });

  it("routeCommand：把路由钉到所选专线网卡（Windows IF / Linux dev）+ metric 1", () => {
    const r = { net: "198.41.192.0", mask: "255.255.255.0", prefix: "198.41.192.0/24" };
    expect(routeCommand("win32", "add", r, "192.168.12.1", { ifIndex: 12, ifName: "WLAN" }))
      .toBe("route add 198.41.192.0 mask 255.255.255.0 192.168.12.1 metric 1 IF 12");
    expect(routeCommand("win32", "add", r, "192.168.12.1", { ifIndex: 12, ifName: "WLAN" }, true)).toContain("route -p add");
    expect(routeCommand("win32", "add", r, "192.168.12.1", { ifIndex: null, ifName: null }))
      .toBe("route add 198.41.192.0 mask 255.255.255.0 192.168.12.1 metric 1"); // 无接口号则不带 IF
    expect(routeCommand("linux", "add", r, "192.168.12.1", { ifIndex: null, ifName: "wlan0" }))
      .toBe("ip route replace 198.41.192.0/24 via 192.168.12.1 dev wlan0");
    expect(routeCommand("win32", "del", r, "", { ifIndex: 12, ifName: "WLAN" })).toBe("route delete 198.41.192.0");
    expect(routeCommand("linux", "del", r, "", { ifIndex: null, ifName: "wlan0" })).toBe("ip route del 198.41.192.0/24");
  });

  it("manualRemoveCommands：每段一条删除命令", () => {
    const cmds = manualRemoveCommands();
    expect(cmds.split(/\r?\n/).filter(Boolean).length).toBe(2);
    expect(cmds).toContain("198.41.192.0");
    expect(cmds).toContain("198.41.200.0");
  });

  it("parseTraceIp：从 CF trace 响应取公网出口 IP", () => {
    const body = "fl=123\nh=www.cloudflare.com\nip=203.0.113.7\nts=1.0\nvisit_scheme=https";
    expect(parseTraceIp(body)).toBe("203.0.113.7");
    expect(parseTraceIp("ip=2606:4700::1\n")).toBe("2606:4700::1");
    expect(parseTraceIp("no ip here")).toBeNull();
    expect(parseTraceIp("ip=not-an-ip")).toBeNull();
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
