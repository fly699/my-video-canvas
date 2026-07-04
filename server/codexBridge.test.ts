import { describe, it, expect } from "vitest";
import { codexModelArg, isGptLocalModel, resolveCodexSpawn } from "./_core/codexBridge";

describe("isGptLocalModel（同端点按前缀分流）", () => {
  it("gpt-local / gpt-local:xxx → true；claude-local/其它 → false", () => {
    expect(isGptLocalModel("gpt-local")).toBe(true);
    expect(isGptLocalModel("gpt-local:gpt-5.3-codex")).toBe(true);
    expect(isGptLocalModel("claude-local")).toBe(false);
    expect(isGptLocalModel(undefined)).toBe(false);
  });
});

describe("codexModelArg", () => {
  it("gpt-local（默认）→ null；后缀 → 透传；非法/超长 → null 防注入", () => {
    expect(codexModelArg("gpt-local")).toBeNull();
    expect(codexModelArg("gpt-local:gpt-5.3-codex")).toBe("gpt-5.3-codex");
    expect(codexModelArg("gpt-local:a b")).toBeNull();
    expect(codexModelArg("gpt-local:" + "x".repeat(80))).toBeNull();
  });
});

describe("resolveCodexSpawn（Windows .cmd 坑，同 claude 方案）", () => {
  const A = ["exec", "-"];
  it("非 Windows：原样、不走 shell", () => {
    expect(resolveCodexSpawn("/usr/bin/codex", A, { platform: "linux" })).toEqual({ cmd: "/usr/bin/codex", args: A, shell: false });
  });
  it("Windows + .cmd + 找得到 codex.js → node 直跑、免 shell", () => {
    const r = resolveCodexSpawn("C:\\Users\\K\\AppData\\Roaming\\npm\\codex.cmd", A, { platform: "win32", exists: () => true });
    expect(r.cmd).toBe(process.execPath);
    expect(r.shell).toBe(false);
    expect(r.args[0]).toContain("codex.js");
  });
  it("Windows + .cmd + 找不到 → 兜底 shell", () => {
    expect(resolveCodexSpawn("C:\\x\\codex.cmd", A, { platform: "win32", exists: () => false }).shell).toBe(true);
  });
});
