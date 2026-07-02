import { describe, it, expect } from "vitest";
import { tunnelErrorHint } from "./_core/tunnel";

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
