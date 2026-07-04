import { describe, it, expect } from "vitest";
import { handleRpc, PERMISSION_TOOL_NAME } from "./_core/superAgent/permissionMcpServer";

const call = (command: string) => handleRpc({
  jsonrpc: "2.0", id: 9, method: "tools/call",
  params: { name: PERMISSION_TOOL_NAME, arguments: { tool_name: "Bash", tool_input: { command } } },
});
const decisionOf = (res: ReturnType<typeof handleRpc>) =>
  JSON.parse(((res!.result as { content: { text: string }[] }).content[0].text)) as { behavior: string; message?: string };

describe("permission MCP server · handleRpc", () => {
  it("initialize：回 protocolVersion + tools 能力 + serverInfo", () => {
    const r = handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect((r!.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
    expect((r!.result as { capabilities: { tools: unknown } }).capabilities.tools).toBeDefined();
  });

  it("notifications/initialized：无响应（null）", () => {
    expect(handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("tools/list：暴露 approve_tool_use", () => {
    const r = handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (r!.result as { tools: { name: string }[] }).tools;
    expect(tools[0].name).toBe(PERMISSION_TOOL_NAME);
  });

  it("tools/call：安全命令 → allow", () => {
    expect(decisionOf(call("ls -la")).behavior).toBe("allow");
  });

  it("tools/call：危险命令 → deny + 原因（执行前拦截）", () => {
    const d = decisionOf(call("rm -rf /"));
    expect(d.behavior).toBe("deny");
    expect(d.message).toContain("拦截");
  });

  it("tools/call：未知工具名 → JSON-RPC error", () => {
    const r = handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nope", arguments: {} } });
    expect(r!.error?.code).toBe(-32601);
  });

  it("未实现方法 → error", () => {
    expect(handleRpc({ jsonrpc: "2.0", id: 4, method: "resources/list" })!.error).toBeDefined();
  });
});
