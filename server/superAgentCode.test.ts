import { describe, it, expect } from "vitest";
import { buildClaudeArgs, parseStreamLine, runCodeAgent } from "./_core/superAgent/codeAgent";
import type { CommandRisk } from "./_core/ops/commandPolicy";

// 便捷：把假 stream-json 行数组变成 AsyncIterable。
async function* asLines(arr: string[]): AsyncIterable<string> {
  for (const l of arr) yield l;
}
const J = (o: unknown) => JSON.stringify(o);

describe("buildClaudeArgs", () => {
  it("固定无头 + stream-json + verbose + 默认 default 权限模式", () => {
    const a = buildClaudeArgs({});
    expect(a.slice(0, 4)).toEqual(["-p", "--output-format", "stream-json", "--verbose"]);
    expect(a).toContain("--permission-mode");
    expect(a[a.indexOf("--permission-mode") + 1]).toBe("default");
    // 提示词不进 argv（走 stdin）
    expect(a.join(" ")).not.toContain("prompt");
  });

  it("放行/拒绝工具用逗号连接；addDir/model/budget/mcp 正确拼接", () => {
    const a = buildClaudeArgs({
      permissionMode: "acceptEdits",
      allowedTools: ["Read", "Edit", "Bash(git *)"],
      disallowedTools: ["Bash(rm *)"],
      addDirs: ["/work/scratch"],
      model: "sonnet",
      mcpConfig: "/tmp/mcp.json",
      strictMcp: true,
      maxBudgetUsd: 2,
    });
    expect(a[a.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(a[a.indexOf("--allowedTools") + 1]).toBe("Read,Edit,Bash(git *)");
    expect(a[a.indexOf("--disallowedTools") + 1]).toBe("Bash(rm *)");
    expect(a[a.indexOf("--add-dir") + 1]).toBe("/work/scratch");
    expect(a[a.indexOf("--model") + 1]).toBe("sonnet");
    expect(a).toContain("--strict-mcp-config");
    expect(a[a.indexOf("--max-budget-usd") + 1]).toBe("2");
  });

  it("permission-prompt-tool 拼接（执行前审批）", () => {
    const a = buildClaudeArgs({ permissionPromptTool: "mcp__policy__approve_tool_use" });
    expect(a[a.indexOf("--permission-prompt-tool") + 1]).toBe("mcp__policy__approve_tool_use");
  });
});

describe("parseStreamLine", () => {
  it("system/init → init 事件", () => {
    expect(parseStreamLine(J({ type: "system", subtype: "init", session_id: "s1" }))).toEqual([{ kind: "init", sessionId: "s1" }]);
  });
  it("text_delta → text 事件", () => {
    expect(parseStreamLine(J({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "你好" } } })))
      .toEqual([{ kind: "text", text: "你好" }]);
  });
  it("content_block_start tool_use(Bash) → 抽出 command", () => {
    const out = parseStreamLine(J({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } } } }));
    expect(out[0].kind).toBe("tool_use");
    expect(out[0].tool).toBe("Bash");
    expect(out[0].command).toBe("ls -la");
  });
  it("非 Bash 工具 → 无 command", () => {
    const out = parseStreamLine(J({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Read", input: { file_path: "/a" } } } }));
    expect(out[0].command).toBeUndefined();
    expect(out[0].tool).toBe("Read");
  });
  it("assistant 消息含 text + tool_use 混合 → 拆成两个事件", () => {
    const out = parseStreamLine(J({ type: "assistant", message: { content: [
      { type: "text", text: "我来跑一下" },
      { type: "tool_use", name: "Bash", input: { command: "npm test" } },
    ] } }));
    expect(out.map((e) => e.kind)).toEqual(["text", "tool_use"]);
    expect(out[1].command).toBe("npm test");
  });
  it("result 成功/失败字段", () => {
    expect(parseStreamLine(J({ type: "result", subtype: "success", result: "done", total_cost_usd: 0.01, num_turns: 3 }))[0])
      .toMatchObject({ kind: "result", isError: false, result: "done", costUsd: 0.01, numTurns: 3 });
    expect(parseStreamLine(J({ type: "result", subtype: "error", is_error: true, result: "boom" }))[0])
      .toMatchObject({ kind: "result", isError: true, result: "boom" });
  });
  it("非法行 → 空数组（容错）", () => {
    expect(parseStreamLine("not json")).toEqual([]);
    expect(parseStreamLine("")).toEqual([]);
  });
});

describe("runCodeAgent", () => {
  it("正常：文本 + 成功 result → success，事件含 text/result", async () => {
    const r = await runCodeAgent({
      lines: asLines([
        J({ type: "system", subtype: "init", session_id: "s" }),
        J({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "分析中" } } }),
        J({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Read", input: { file_path: "/a" } } } }),
        J({ type: "result", subtype: "success", result: "完成", total_cost_usd: 0.02, num_turns: 2 }),
      ]),
    });
    expect(r.status).toBe("success");
    expect(r.result).toBe("完成");
    expect(r.costUsd).toBe(0.02);
    expect(r.events.some((e) => e.type === "text")).toBe(true);
    expect(r.events.some((e) => e.type === "tool")).toBe(true);
    expect(r.events.some((e) => e.type === "result")).toBe(true);
  });

  it("安全命令放行：命令事件出现，不中止", async () => {
    const r = await runCodeAgent({
      classify: (): CommandRisk => ({ dangerous: false, reasons: [], autoExecEligible: true }),
      lines: asLines([
        J({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Bash", input: { command: "ls" } } } }),
        J({ type: "result", subtype: "success", result: "ok" }),
      ]),
    });
    expect(r.status).toBe("success");
    expect(r.events.some((e) => e.type === "command" && (e.data as { command: string }).command === "ls")).toBe(true);
  });

  it("危险命令：commandPolicy 判危 → aborted + onAbort 被调用 + 不再处理后续", async () => {
    let aborted: string | null = null;
    const r = await runCodeAgent({
      onAbort: (cmd) => { aborted = cmd; },
      lines: asLines([
        J({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Bash", input: { command: "rm -rf /" } } } }),
        J({ type: "result", subtype: "success", result: "不该到这" }),
      ]),
    });
    expect(r.status).toBe("aborted");
    expect(r.blockedCommand).toBe("rm -rf /");
    expect(aborted).toBe("rm -rf /");
    expect(r.result).toBeUndefined(); // 中止后未处理 result
    expect(r.events.some((e) => e.type === "blocked")).toBe(true);
  });

  it("错误 result → failed", async () => {
    const r = await runCodeAgent({
      lines: asLines([J({ type: "result", subtype: "error", is_error: true, result: "炸了" })]),
    });
    expect(r.status).toBe("failed");
  });

  it("无 result 事件（进程异常结束）→ failed", async () => {
    const r = await runCodeAgent({ lines: asLines([J({ type: "system", subtype: "init" })]) });
    expect(r.status).toBe("failed");
  });
});
