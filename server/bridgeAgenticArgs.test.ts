import { describe, it, expect } from "vitest";
import { buildBridgeAgenticArgs } from "./_core/claudeBridge";

const argVal = (args: string[], flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

describe("buildBridgeAgenticArgs 安全护栏（finding2）", () => {
  it("allowedTools 覆盖里的 Bash/Write/Edit 被无条件剔除，保留安全工具", () => {
    const args = buildBridgeAgenticArgs({ mcpConfigArg: "/x.json", serverNames: ["comfyui-a"], skills: false, allowedOverride: "Read,Bash,Write,Edit,mcp__comfyui-a" });
    const allowed = (argVal(args, "--allowedTools") ?? "").split(",");
    expect(allowed).not.toContain("Bash");
    expect(allowed).not.toContain("Write");
    expect(allowed).not.toContain("Edit");
    expect(allowed).toContain("Read");
    expect(allowed).toContain("mcp__comfyui-a");
  });
  it("permissionMode=bypassPermissions 被降为 default；acceptEdits 亦然", () => {
    expect(argVal(buildBridgeAgenticArgs({ mcpConfigArg: "/x", serverNames: [], skills: true, permissionMode: "bypassPermissions" }), "--permission-mode")).toBe("default");
    expect(argVal(buildBridgeAgenticArgs({ mcpConfigArg: "/x", serverNames: [], skills: true, permissionMode: "acceptEdits" }), "--permission-mode")).toBe("default");
    expect(argVal(buildBridgeAgenticArgs({ mcpConfigArg: "/x", serverNames: [], skills: true, permissionMode: "plan" }), "--permission-mode")).toBe("plan");
  });
  it("无覆盖 → 默认安全工具集（Read/Glob/Grep/WebSearch/WebFetch + mcp__*），无 Bash", () => {
    const allowed = (argVal(buildBridgeAgenticArgs({ mcpConfigArg: "/x", serverNames: ["a"], skills: false }), "--allowedTools") ?? "").split(",");
    expect(allowed).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "WebSearch", "WebFetch", "mcp__a"]));
    expect(allowed).not.toContain("Bash");
  });
  it("纯文本模式（无 mcp、无 skills）→ 空数组", () => {
    expect(buildBridgeAgenticArgs({ mcpConfigArg: null, serverNames: [], skills: false })).toEqual([]);
  });
  it("覆盖里只有高危工具 → 被剔空后回落默认安全集（不至于放行空 allowedTools）", () => {
    const allowed = argVal(buildBridgeAgenticArgs({ mcpConfigArg: "/x", serverNames: [], skills: false, allowedOverride: "Bash,Write" }), "--allowedTools") ?? "";
    expect(allowed).toContain("Read");
    expect(allowed).not.toContain("Bash");
  });
});
