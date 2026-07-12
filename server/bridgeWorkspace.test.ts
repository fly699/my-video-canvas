import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeWorkspaceMcp, WS_MCP_SERVER_NAME, collectWorkspaceFiles, WS_LIMITS,
  safeStorageName, formatFilesReply, createCallWorkspace, cleanupCallWorkspace, sweepStaleWorkspaces,
  bridgeWorkspaceRoot, workspacePromptHint,
} from "./_core/bridgeWorkspace";

describe("bridgeWorkspace #88", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "bws-test-"));
    process.env.BRIDGE_WORKSPACE_DIR = join(base, "root");
  });
  afterEach(() => {
    delete process.env.BRIDGE_WORKSPACE_DIR;
    delete process.env.BRIDGE_FS_MCP_CMD;
    rmSync(base, { recursive: true, force: true });
  });

  describe("mergeWorkspaceMcp", () => {
    it("空管理员配置 → 仅工作区 filesystem 服务器（npx 默认命令 + 目录参数）", () => {
      const r = mergeWorkspaceMcp("", "/ws/dir");
      expect(r.injected).toBe(true);
      expect(r.serverNames).toEqual([WS_MCP_SERVER_NAME]);
      const o = JSON.parse(r.json) as { mcpServers: Record<string, { command: string; args: string[] }> };
      expect(o.mcpServers[WS_MCP_SERVER_NAME].command).toBe("npx");
      expect(o.mcpServers[WS_MCP_SERVER_NAME].args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/ws/dir"]);
    });

    it("与管理员内联配置合并：保留原服务器，追加工作区", () => {
      const r = mergeWorkspaceMcp('{"mcpServers":{"comfy":{"command":"x"}}}', "/d");
      expect(r.serverNames.sort()).toEqual(["avc_ws", "comfy"]);
      const o = JSON.parse(r.json) as { mcpServers: Record<string, unknown> };
      expect(Object.keys(o.mcpServers).sort()).toEqual(["avc_ws", "comfy"]);
    });

    it("管理员已占用 avc_ws 名 → 不覆盖（管理员优先），injected=false", () => {
      const r = mergeWorkspaceMcp(`{"mcpServers":{"${WS_MCP_SERVER_NAME}":{"command":"theirs"}}}`, "/d");
      expect(r.injected).toBe(false);
      const o = JSON.parse(r.json) as { mcpServers: Record<string, { command: string }> };
      expect(o.mcpServers[WS_MCP_SERVER_NAME].command).toBe("theirs");
    });

    it("非法 JSON → 当空配置处理（仅工作区）", () => {
      const r = mergeWorkspaceMcp("{oops", "/d");
      expect(r.serverNames).toEqual([WS_MCP_SERVER_NAME]);
    });

    it("BRIDGE_FS_MCP_CMD 可覆盖命令", () => {
      process.env.BRIDGE_FS_MCP_CMD = "mcp-server-filesystem";
      const r = mergeWorkspaceMcp("", "/d");
      const o = JSON.parse(r.json) as { mcpServers: Record<string, { command: string; args: string[] }> };
      expect(o.mcpServers[WS_MCP_SERVER_NAME].command).toBe("mcp-server-filesystem");
      expect(o.mcpServers[WS_MCP_SERVER_NAME].args).toEqual(["/d"]);
    });
  });

  describe("collectWorkspaceFiles（白名单/限额/防软链）", () => {
    it("收白名单文件、跳过黑名单扩展与超限文件", () => {
      const d = join(base, "c1"); mkdirSync(d);
      writeFileSync(join(d, "a.png"), Buffer.alloc(10));
      writeFileSync(join(d, "b.txt"), "hello");
      writeFileSync(join(d, "evil.sh"), "#!/bin/sh");
      writeFileSync(join(d, "page.html"), "<script>");
      writeFileSync(join(d, "big.md"), Buffer.alloc(60));
      const r = collectWorkspaceFiles(d, { ...WS_LIMITS, maxFileBytes: 50 });
      expect(r.files.map((f) => f.name).sort()).toEqual(["a.png", "b.txt"]);
      expect(r.files.find((f) => f.name === "a.png")?.contentType).toBe("image/png");
      const reasons = Object.fromEntries(r.skipped.map((s) => [s.name, s.reason]));
      expect(reasons["evil.sh"]).toContain("白名单");
      expect(reasons["page.html"]).toContain("白名单");
      expect(reasons["big.md"]).toContain("单文件上限");
    });

    it("数量与总量限额生效", () => {
      const d = join(base, "c2"); mkdirSync(d);
      for (let i = 0; i < 5; i++) writeFileSync(join(d, `f${i}.txt`), Buffer.alloc(30));
      const r = collectWorkspaceFiles(d, { ...WS_LIMITS, maxFiles: 2, maxTotalBytes: 1000 });
      expect(r.files.length).toBe(2);
      expect(r.skipped.filter((s) => s.reason.includes("数量上限")).length).toBe(3);
      const r2 = collectWorkspaceFiles(d, { ...WS_LIMITS, maxTotalBytes: 70 });
      expect(r2.files.length).toBe(2); // 30+30=60 ≤70，第三个超总量
      expect(r2.skipped.some((s) => s.reason.includes("总量上限"))).toBe(true);
    });

    it("符号链接一律跳过（防把工作区外文件偷渡上传）；子目录按层深收集", () => {
      const d = join(base, "c3"); mkdirSync(d);
      const secret = join(base, "secret.txt"); writeFileSync(secret, "key");
      symlinkSync(secret, join(d, "steal.txt"));
      mkdirSync(join(d, "sub"));
      writeFileSync(join(d, "sub", "in.md"), "x");
      const deep = join(d, "a", "b", "c", "d2"); mkdirSync(deep, { recursive: true });
      writeFileSync(join(deep, "toodeep.txt"), "x");
      const r = collectWorkspaceFiles(d);
      expect(r.files.map((f) => f.name)).toEqual(["sub/in.md"]);
      expect(r.skipped.some((s) => s.name === "steal.txt" && s.reason.includes("符号链接"))).toBe(true);
      expect(r.skipped.some((s) => s.reason.includes("层深"))).toBe(true);
    });
  });

  describe("工作区生命周期", () => {
    it("createCallWorkspace 建 ws-* 子目录；cleanup 双守卫：根外/非 ws- 前缀拒删", () => {
      const d = createCallWorkspace();
      expect(existsSync(d)).toBe(true);
      expect(d.startsWith(bridgeWorkspaceRoot())).toBe(true);
      // 根外目录拒删
      const outside = join(base, "not-ws"); mkdirSync(outside);
      expect(cleanupCallWorkspace(outside)).toBe(false);
      expect(existsSync(outside)).toBe(true);
      // 根内但非 ws- 前缀拒删
      const bad = join(bridgeWorkspaceRoot(), "keep"); mkdirSync(bad, { recursive: true });
      expect(cleanupCallWorkspace(bad)).toBe(false);
      expect(existsSync(bad)).toBe(true);
      // 正常清理
      expect(cleanupCallWorkspace(d)).toBe(true);
      expect(existsSync(d)).toBe(false);
    });

    it("sweepStaleWorkspaces 只清超龄 ws-*，新目录保留", () => {
      const root = bridgeWorkspaceRoot(); mkdirSync(root, { recursive: true });
      const old = join(root, `ws-${Date.now() - 48 * 3600_000}-1abc`); mkdirSync(old);
      const fresh = createCallWorkspace();
      const n = sweepStaleWorkspaces(24 * 3600_000);
      expect(n).toBe(1);
      expect(existsSync(old)).toBe(false);
      expect(existsSync(fresh)).toBe(true);
    });
  });

  it("safeStorageName 归一非常规字符、保留中文与扩展名", () => {
    expect(safeStorageName("最终 报告 (v2).pdf")).toBe("最终_报告__v2_.pdf");
    expect(safeStorageName("../../etc/passwd")).toBe("passwd");
    expect(safeStorageName("")).toBe("file");
  });

  it("formatFilesReply：链接列表 + 跳过说明；全空返回空串", () => {
    expect(formatFilesReply([], [])).toBe("");
    const s = formatFilesReply([{ name: "a.png", url: "/manus-storage/x/a.png" }], [{ name: "b.sh", reason: "类型 .sh 不在白名单" }]);
    expect(s).toContain("📎 本次生成的文件：");
    expect(s).toContain("[a.png](/manus-storage/x/a.png)");
    expect(s).toContain("未收集 b.sh");
  });

  it("workspacePromptHint 指名工具与目录、告知勿编造链接", () => {
    const h = workspacePromptHint("/ws/1");
    expect(h).toContain(WS_MCP_SERVER_NAME);
    expect(h).toContain("/ws/1");
    expect(h).toContain("不要自行编造链接");
  });
});
