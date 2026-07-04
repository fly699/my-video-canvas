import { describe, it, expect } from "vitest";
import { decidePermission } from "./_core/superAgent/permissionPolicy";

describe("decidePermission — 执行前拦截", () => {
  it("安全 Bash 命令 → allow，回传入参", () => {
    const d = decidePermission("Bash", { command: "ls -la" });
    expect(d.behavior).toBe("allow");
    expect(d.updatedInput).toEqual({ command: "ls -la" });
  });

  it("危险 Bash 命令 → deny，附拦截原因", () => {
    const d = decidePermission("Bash", { command: "rm -rf /" });
    expect(d.behavior).toBe("deny");
    expect(d.message).toContain("拦截");
  });

  it("多行脚本含一条危险命令 → deny", () => {
    const d = decidePermission("Bash", { command: "echo hi\nsudo rm -rf /var" });
    expect(d.behavior).toBe("deny");
  });

  it("Bash 缺 command 参数 → deny（保守）", () => {
    expect(decidePermission("Bash", {}).behavior).toBe("deny");
    expect(decidePermission("Bash", { command: 123 as unknown as string }).behavior).toBe("deny");
  });

  it("非 Bash 工具（Read/Edit/Write/mcp）→ allow", () => {
    expect(decidePermission("Read", { file_path: "/x" }).behavior).toBe("allow");
    expect(decidePermission("Edit", { file_path: "/x" }).behavior).toBe("allow");
    expect(decidePermission("Write", { file_path: "/x", content: "y" }).behavior).toBe("allow");
    expect(decidePermission("mcp__policy__check", {}).behavior).toBe("allow");
  });
});
