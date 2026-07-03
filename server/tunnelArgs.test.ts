import { describe, it, expect } from "vitest";
import { tunnelErrorHint, buildTunnelArgs } from "./_core/tunnel";

describe("buildTunnelArgs（edge-bind 是 tunnel 级 flag：命名隧道放 run 之前，快速隧道放末尾）", () => {
  it("命名隧道 + 合法 edge-bind：放在 run 之前（本版 run 不认放其后的该 flag → usage 退出 530）", () => {
    const args = buildTunnelArgs({ named: true, token: "TOK", tunnelPort: 3001, bindIp: "192.168.12.24" });
    expect(args).toEqual(["tunnel", "--edge-bind-address", "192.168.12.24", "run", "--token", "TOK"]);
  });
  it("快速隧道 + 合法 edge-bind：末尾传该 flag", () => {
    const args = buildTunnelArgs({ named: false, token: "", tunnelPort: 3001, bindIp: "192.168.12.24" });
    expect(args).toEqual(["tunnel", "--no-autoupdate", "--url", "http://localhost:3001", "--edge-bind-address", "192.168.12.24"]);
  });
  it("空/非法 edge-bind：两种隧道都不传该 flag", () => {
    expect(buildTunnelArgs({ named: true, token: "TOK", tunnelPort: 3001, bindIp: "" })).toEqual(["tunnel", "run", "--token", "TOK"]);
    expect(buildTunnelArgs({ named: false, token: "", tunnelPort: 3001, bindIp: "not-an-ip" })).not.toContain("--edge-bind-address");
  });
});

describe("tunnelErrorHint（把 cloudflared 真实报错挑出来给面板显示）", () => {
  it("优先挑含错误关键词的行", () => {
    const log = [
      '{"level":"info","msg":"Starting tunnel"}',
      '{"level":"error","msg":"failed to bind to 192.168.12.24: cannot assign requested address"}',
    ].join("\n");
    const h = tunnelErrorHint(log);
    expect(h).toMatch(/failed to bind/);
    expect(h).toMatch(/cannot assign/);
  });

  it("识别 unknown flag（参数放错位置时 cloudflared 的典型报错）", () => {
    expect(tunnelErrorHint("Incorrect Usage: unknown flag --edge-bind-address")).toMatch(/unknown flag/);
  });

  it("无错误关键词时回退取末尾几行", () => {
    const h = tunnelErrorHint("line1\nline2\nline3\nline4");
    expect(h).toMatch(/line4/);
  });

  it("空日志 → 空串", () => {
    expect(tunnelErrorHint("")).toBe("");
    expect(tunnelErrorHint("   \n  ")).toBe("");
  });
});
