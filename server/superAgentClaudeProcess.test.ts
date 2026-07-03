import { describe, it, expect, afterEach } from "vitest";
import {
  isCodeAgentEnabled,
  isBashAllowed,
  resolveClaudeBin,
  resolveToolPolicy,
  streamClaudeCode,
} from "./_core/superAgent/claudeProcess";

const ORIG = { ...process.env };
afterEach(() => {
  process.env.SUPER_AGENT_CODE_ENABLED = ORIG.SUPER_AGENT_CODE_ENABLED;
  process.env.SUPER_AGENT_CODE_ALLOW_BASH = ORIG.SUPER_AGENT_CODE_ALLOW_BASH;
  process.env.CLAUDE_BIN = ORIG.CLAUDE_BIN;
});

describe("代码智能体 env 门控", () => {
  it("默认关闭（未设 env）", () => {
    delete process.env.SUPER_AGENT_CODE_ENABLED;
    expect(isCodeAgentEnabled()).toBe(false);
    delete process.env.SUPER_AGENT_CODE_ALLOW_BASH;
    expect(isBashAllowed()).toBe(false);
  });
  it("SUPER_AGENT_CODE_ENABLED=1 才启用", () => {
    process.env.SUPER_AGENT_CODE_ENABLED = "1";
    expect(isCodeAgentEnabled()).toBe(true);
    process.env.SUPER_AGENT_CODE_ENABLED = "true"; // 只有 "1" 算数
    expect(isCodeAgentEnabled()).toBe(false);
  });
  it("CLAUDE_BIN 可覆盖，缺省 claude", () => {
    delete process.env.CLAUDE_BIN;
    expect(resolveClaudeBin()).toBe("claude");
    process.env.CLAUDE_BIN = "/opt/node22/bin/claude";
    expect(resolveClaudeBin()).toBe("/opt/node22/bin/claude");
  });
});

describe("双钥工具策略", () => {
  it("未放行 Bash：只 Read/Edit/Write，无 Bash", () => {
    delete process.env.SUPER_AGENT_CODE_ALLOW_BASH;
    const p = resolveToolPolicy();
    expect(p.allowedTools).toEqual(["Read", "Edit", "Write"]);
    expect(p.allowedTools).not.toContain("Bash");
    expect(p.permissionMode).toBe("acceptEdits");
  });
  it("放行 Bash：加入 Bash 且显式 disallow 高危 shape", () => {
    process.env.SUPER_AGENT_CODE_ALLOW_BASH = "1";
    const p = resolveToolPolicy();
    expect(p.allowedTools).toContain("Bash");
    expect(p.disallowedTools).toContain("Bash(rm *)");
    expect(p.disallowedTools).toContain("Bash(sudo *)");
  });
});

describe("streamClaudeCode 门控", () => {
  it("未启用时直接抛错，不 spawn", () => {
    delete process.env.SUPER_AGENT_CODE_ENABLED;
    expect(() => streamClaudeCode({ task: "hi", cwd: "/tmp", timeoutMs: 1000, argsBuilder: () => [] }))
      .toThrow(/未启用/);
  });
});
