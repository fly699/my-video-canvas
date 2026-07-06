import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isCodeAgentEnabled,
  isBashAllowed,
  resolveClaudeBin,
  resolvePermissionWiring,
  resolveClaudeSpawn,
  maybeMaterializeMcpConfig,
  streamClaudeCode,
} from "./_core/superAgent/claudeProcess";

const ORIG = { ...process.env };
afterEach(() => {
  process.env.SUPER_AGENT_CODE_ENABLED = ORIG.SUPER_AGENT_CODE_ENABLED;
  process.env.SUPER_AGENT_CODE_ALLOW_BASH = ORIG.SUPER_AGENT_CODE_ALLOW_BASH;
  process.env.CLAUDE_BIN = ORIG.CLAUDE_BIN;
  process.env.SUPER_AGENT_PERMISSION_CMD = ORIG.SUPER_AGENT_PERMISSION_CMD;
  process.env.SUPER_AGENT_PERMISSION_ARGS = ORIG.SUPER_AGENT_PERMISSION_ARGS;
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

describe("双钥 + 执行前审批 权限接线", () => {
  it("未放行 Bash：只 Read/Edit/Write/Skill，无 Bash，无审批 MCP", () => {
    delete process.env.SUPER_AGENT_CODE_ALLOW_BASH;
    const p = resolvePermissionWiring();
    expect(p.allowedTools).toEqual(["Read", "Edit", "Write", "Skill"]);
    expect(p.allowedTools).not.toContain("Bash");
    expect(p.permissionMode).toBe("acceptEdits");
    expect(p.permissionPromptTool).toBeUndefined();
  });
  it("放行 Bash 但未配审批 MCP：预授 Bash + 高危 disallow（靠事后监控）", () => {
    process.env.SUPER_AGENT_CODE_ALLOW_BASH = "1";
    delete process.env.SUPER_AGENT_PERMISSION_CMD;
    const p = resolvePermissionWiring();
    expect(p.allowedTools).toContain("Bash");
    expect(p.disallowedTools).toContain("Bash(rm *)");
    expect(p.permissionMode).toBe("acceptEdits");
    expect(p.permissionPromptTool).toBeUndefined();
  });
  it("放行 Bash + 配审批 MCP：不预授 Bash，default 模式 + prompt-tool + strict mcpConfig", () => {
    process.env.SUPER_AGENT_CODE_ALLOW_BASH = "1";
    process.env.SUPER_AGENT_PERMISSION_CMD = "node";
    process.env.SUPER_AGENT_PERMISSION_ARGS = JSON.stringify(["/app/permissionMcpServer.js"]);
    const p = resolvePermissionWiring();
    expect(p.allowedTools).not.toContain("Bash"); // 不预授 → 落到审批工具
    expect(p.allowedTools).toContain("Skill"); // 技能始终放行（Higgsfield 等 CLI 型技能靠 Bash 审批）
    expect(p.permissionMode).toBe("default");
    expect(p.strictMcp).toBe(true);
    expect(p.permissionPromptTool).toBe("mcp__policy__approve_tool_use");
    const cfg = JSON.parse(p.mcpConfig!);
    expect(cfg.mcpServers.policy.command).toBe("node");
    expect(cfg.mcpServers.policy.args).toEqual(["/app/permissionMcpServer.js"]);
  });
});

describe("resolveClaudeSpawn（Windows .cmd 坑）", () => {
  const A = ["-p", "--output-format", "stream-json"];
  it("非 Windows：原样 spawn，不走 shell", () => {
    expect(resolveClaudeSpawn("/opt/node22/bin/claude", A, { platform: "linux" })).toEqual({ cmd: "/opt/node22/bin/claude", args: A, shell: false });
  });
  it("Windows + .cmd + 找得到 cli.js：改用 node 跑底层 cli.js，免 shell、参数原样", () => {
    const r = resolveClaudeSpawn("C:\\Users\\K\\AppData\\Roaming\\npm\\claude.cmd", A, { platform: "win32", exists: () => true });
    expect(r.cmd).toBe(process.execPath);
    expect(r.shell).toBe(false);
    expect(r.args[0]).toContain("cli.js");
    expect(r.args.slice(1)).toEqual(A);
  });
  it("Windows + .cmd + 找不到 cli.js：兜底走 shell", () => {
    const r = resolveClaudeSpawn("C:\\x\\claude.cmd", A, { platform: "win32", exists: () => false });
    expect(r).toEqual({ cmd: "C:\\x\\claude.cmd", args: A, shell: true });
  });
  it("Windows + .exe：原样 spawn 不走 shell", () => {
    expect(resolveClaudeSpawn("C:\\x\\claude.exe", A, { platform: "win32", exists: () => true })).toEqual({ cmd: "C:\\x\\claude.exe", args: A, shell: false });
  });
});

describe("maybeMaterializeMcpConfig（内联 JSON 落地成文件）", () => {
  it("内联 JSON → 写成工作区里的 .json 文件，mcpConfig 改为该路径", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
    try {
      const inline = JSON.stringify({ mcpServers: { policy: { type: "stdio", command: "node", args: ["/app/x.cjs"] } } });
      const out = maybeMaterializeMcpConfig({ allowedTools: ["Read"], disallowedTools: [], permissionMode: "default", mcpConfig: inline, strictMcp: true }, dir);
      expect(out.mcpConfig).toBe(join(dir, "superagent-mcp.json"));
      expect(existsSync(out.mcpConfig!)).toBe(true);
      expect(JSON.parse(readFileSync(out.mcpConfig!, "utf8"))).toEqual(JSON.parse(inline));
      expect(out.strictMcp).toBe(true); // 其它字段原样
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("无 mcpConfig / 已是文件路径（非 { 开头）→ 原样返回不落地", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
    try {
      expect(maybeMaterializeMcpConfig({ allowedTools: ["Read"], disallowedTools: [], permissionMode: "acceptEdits" }, dir).mcpConfig).toBeUndefined();
      const withPath = maybeMaterializeMcpConfig({ allowedTools: ["Read"], disallowedTools: [], permissionMode: "default", mcpConfig: "/tmp/existing.json" }, dir);
      expect(withPath.mcpConfig).toBe("/tmp/existing.json");
      expect(existsSync(join(dir, "superagent-mcp.json"))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("streamClaudeCode 门控", () => {
  it("未启用时直接抛错，不 spawn", () => {
    delete process.env.SUPER_AGENT_CODE_ENABLED;
    expect(() => streamClaudeCode({ task: "hi", cwd: "/tmp", timeoutMs: 1000, argsBuilder: () => [] }))
      .toThrow(/未启用/);
  });
});

describe("resolveClaudeSpawn — Windows 裸名自动探测 %APPDATA%\\npm", () => {
  it("裸 claude + 探到 claude.cmd → 免配置解析（进而 node 直跑 cli.js）", () => {
    const r = resolveClaudeSpawn("claude", ["-p"], {
      platform: "win32", appData: "C:\\Users\\K\\AppData\\Roaming",
      exists: (p) => p.endsWith("claude.cmd") || p.endsWith("cli.js"),
    });
    expect(r.cmd).toBe(process.execPath);
    expect(r.args[0]).toContain("cli.js");
  });
  it("裸 claude + 探不到 → 原样", () => {
    expect(resolveClaudeSpawn("claude", ["-p"], { platform: "win32", appData: "C:\\x", exists: () => false }))
      .toEqual({ cmd: "claude", args: ["-p"], shell: false });
  });
});
