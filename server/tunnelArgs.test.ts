import { describe, it, expect } from "vitest";
import { buildCloudflaredArgs } from "./_core/tunnel";

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
