import { describe, it, expect } from "vitest";
import { CF_EDGE_ROUTES, manualRouteCommands } from "./_core/tunnelRoute";

describe("tunnelRoute", () => {
  it("CF 边缘网段 = cloudflared 实际连接的两段（见运行日志 198.41.x）", () => {
    expect(CF_EDGE_ROUTES.map((r) => r.prefix)).toEqual(["198.41.192.0/24", "198.41.200.0/24"]);
  });

  it("manualRouteCommands 为每段生成一条、含网关、覆盖两段", () => {
    const cmds = manualRouteCommands("192.168.12.1");
    expect(cmds).toContain("192.168.12.1");
    expect(cmds).toContain("198.41.192.0");
    expect(cmds).toContain("198.41.200.0");
    // 两段 → 两条命令
    expect(cmds.split(/\r?\n/).filter(Boolean).length).toBe(2);
  });

  it("命令只针对 CF 两段，绝不含默认路由 0.0.0.0", () => {
    expect(manualRouteCommands("10.0.0.1")).not.toContain("0.0.0.0");
  });
});
