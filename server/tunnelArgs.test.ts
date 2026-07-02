import { describe, it, expect } from "vitest";
import { buildCloudflaredArgs, tunnelErrorHint } from "./_core/tunnel";

// 回归：--edge-bind-address 是 `tunnel` 命令层的全局参数，必须在子命令 `run` 之前。
// 之前用 args.push() 加到末尾 → 命名隧道落到 `run --token X` 之后被拒 → 「一绑就连不上」；
// 快速隧道没有子命令，参数在 tunnel 层侥幸可用（所以临时隧道正常）。
describe("buildCloudflaredArgs", () => {
  it("命名隧道 · 无绑定", () => {
    expect(buildCloudflaredArgs(true, "TOK", 3001, "")).toEqual(["tunnel", "run", "--token", "TOK"]);
  });

  it("命名隧道 · 有绑定 → --edge-bind-address 在 run 之前", () => {
    const a = buildCloudflaredArgs(true, "TOK", 3001, "192.168.12.24");
    expect(a).toEqual(["tunnel", "--edge-bind-address", "192.168.12.24", "run", "--token", "TOK"]);
    // 关键断言：edge-bind 必须排在 run 前面
    expect(a.indexOf("--edge-bind-address")).toBeLessThan(a.indexOf("run"));
  });

  it("快速隧道 · 有绑定 → 在 tunnel 层（无 run 子命令）", () => {
    const a = buildCloudflaredArgs(false, "", 3001, "10.0.0.5");
    expect(a).toEqual(["tunnel", "--edge-bind-address", "10.0.0.5", "--no-autoupdate", "--url", "http://localhost:3001"]);
  });

  it("快速隧道 · 无绑定", () => {
    expect(buildCloudflaredArgs(false, "", 3001, "")).toEqual(["tunnel", "--no-autoupdate", "--url", "http://localhost:3001"]);
  });

  it("非法/空白绑定 IP 被忽略（不加参数）", () => {
    expect(buildCloudflaredArgs(true, "TOK", 3001, "not-an-ip")).toEqual(["tunnel", "run", "--token", "TOK"]);
    expect(buildCloudflaredArgs(true, "TOK", 3001, "   ")).toEqual(["tunnel", "run", "--token", "TOK"]);
  });

  it("支持 IPv6 绑定地址", () => {
    const a = buildCloudflaredArgs(true, "TOK", 3001, "2001:db8::1");
    expect(a).toEqual(["tunnel", "--edge-bind-address", "2001:db8::1", "run", "--token", "TOK"]);
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
})
