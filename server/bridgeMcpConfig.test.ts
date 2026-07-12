import { describe, it, expect } from "vitest";
import { normalizeBridgeMcp } from "./db";

describe("normalizeBridgeMcp（桥接 MCP 配置容错解析 + 缺省值）", () => {
  it("空/undefined → 全缺省（strict 默认 true）", () => {
    expect(normalizeBridgeMcp(undefined)).toEqual({ mcpConfig: "", skills: false, strict: true, permissionMode: "", allowedTools: "", workspace: false });
    expect(normalizeBridgeMcp(null)).toEqual({ mcpConfig: "", skills: false, strict: true, permissionMode: "", allowedTools: "", workspace: false });
  });

  it("MySQL 8 返回对象 → 原样取值", () => {
    const o = { mcpConfig: '{"mcpServers":{}}', skills: true, strict: false, permissionMode: "acceptEdits", allowedTools: "Read,Grep", workspace: false };
    expect(normalizeBridgeMcp(o)).toEqual(o);
  });

  it("MariaDB 返回 JSON 字符串 → 解析后取值", () => {
    const s = JSON.stringify({ mcpConfig: "/etc/mcp.json", skills: true, strict: true, permissionMode: "", allowedTools: "", workspace: false });
    expect(normalizeBridgeMcp(s)).toEqual({ mcpConfig: "/etc/mcp.json", skills: true, strict: true, permissionMode: "", allowedTools: "", workspace: false });
  });

  it("坏字符串 → 全缺省", () => {
    expect(normalizeBridgeMcp("{ not json")).toEqual({ mcpConfig: "", skills: false, strict: true, permissionMode: "", allowedTools: "", workspace: false });
  });

  it("strict 仅显式 false 才关，其余（缺省/非布尔）都为 true", () => {
    expect(normalizeBridgeMcp({ strict: false }).strict).toBe(false);
    expect(normalizeBridgeMcp({ strict: true }).strict).toBe(true);
    expect(normalizeBridgeMcp({}).strict).toBe(true);
    expect(normalizeBridgeMcp({ strict: "0" }).strict).toBe(true); // 非布尔 → 保守取 true
  });

  it("skills 仅显式 true 才开", () => {
    expect(normalizeBridgeMcp({ skills: true }).skills).toBe(true);
    expect(normalizeBridgeMcp({ skills: "1" }).skills).toBe(false); // 非布尔 → false
    expect(normalizeBridgeMcp({}).skills).toBe(false);
  });
});
