import { describe, it, expect } from "vitest";
import { buildClaudeArgs, parseStreamLine, runCodeAgent, frameCodeTask, CODE_SANDBOX_PREAMBLE, shouldKeepWorkspace, planCodeRepair, buildCodeRepairPrompt } from "./_core/superAgent/codeAgent";
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

  it("resumeSessionId → --resume 续接会话；缺省不加", () => {
    const a = buildClaudeArgs({ resumeSessionId: "sess-123" });
    expect(a[a.indexOf("--resume") + 1]).toBe("sess-123");
    expect(buildClaudeArgs({})).not.toContain("--resume");
  });
});

describe("frameCodeTask（沙箱前导）", () => {
  it("首轮：前置沙箱边界说明 + 原任务", () => {
    const out = frameCodeTask("读 err.log 定位报错", false);
    expect(out).toContain(CODE_SANDBOX_PREAMBLE);
    expect(out).toContain("一次性隔离的临时工作区");
    expect(out).toContain("读 err.log 定位报错");
  });
  it("续接：不重复前导，原样透传", () => {
    expect(frameCodeTask("接着改", true)).toBe("接着改");
  });
});

describe("shouldKeepWorkspace（续接工作区生命周期）", () => {
  it("新建：成功（有会话、无 spawnError）才保留", () => {
    expect(shouldKeepWorkspace({ hasSession: true, resuming: false, spawnError: false })).toBe(true);
    expect(shouldKeepWorkspace({ hasSession: false, resuming: false, spawnError: false })).toBe(false);
    expect(shouldKeepWorkspace({ hasSession: true, resuming: false, spawnError: true })).toBe(false);
  });
  it("续接：只要有会话 id 就保留——即使本轮 spawnError 也不删（不毁掉整段连续对话）", () => {
    expect(shouldKeepWorkspace({ hasSession: true, resuming: true, spawnError: true })).toBe(true);
    expect(shouldKeepWorkspace({ hasSession: true, resuming: true, spawnError: false })).toBe(true);
  });
  it("无会话 id → 一律不保留（避免留目录却无人持有的泄漏）", () => {
    expect(shouldKeepWorkspace({ hasSession: false, resuming: true, spawnError: false })).toBe(false);
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

  it("捕获 sessionId（用于下一轮 --resume）：优先 result，回退 init", async () => {
    const r1 = await runCodeAgent({ lines: asLines([
      J({ type: "system", subtype: "init", session_id: "sess-init" }),
      J({ type: "result", subtype: "success", result: "ok", session_id: "sess-final" }),
    ]) });
    expect(r1.sessionId).toBe("sess-final");
    // 只有 init 带 id（result 无 session_id）→ 回退到 init 的
    const r2 = await runCodeAgent({ lines: asLines([
      J({ type: "system", subtype: "init", session_id: "sess-init" }),
      J({ type: "result", subtype: "success", result: "ok" }),
    ]) });
    expect(r2.sessionId).toBe("sess-init");
  });
});

describe("planCodeRepair（B1 批2：失败自动修一轮决策）", () => {
  const base = { status: "failed" as const, cancelled: false, timedOut: false, spawnError: false, hasSession: true, maxBudgetUsd: 2 };

  it("真失败 + 有会话 + 预算充足 → 修，预算 = 上限 - 已花", () => {
    const d = planCodeRepair({ ...base, costUsd: 0.5 });
    expect(d.repair).toBe(true);
    expect(d.budgetUsd).toBe(1.5);
  });

  it("成功 / 用户取消 / aborted 不修", () => {
    expect(planCodeRepair({ ...base, status: "success", costUsd: 0.1 }).repair).toBe(false);
    expect(planCodeRepair({ ...base, cancelled: true, costUsd: 0.1 }).repair).toBe(false);
    expect(planCodeRepair({ ...base, status: "aborted", costUsd: 0.1 }).repair).toBe(false);
  });

  it("危险命令拦截 / 超时 / spawn 失败 / 无会话 不修", () => {
    expect(planCodeRepair({ ...base, blockedCommand: "rm -rf /", costUsd: 0.1 }).repair).toBe(false);
    expect(planCodeRepair({ ...base, timedOut: true, costUsd: 0.1 }).repair).toBe(false);
    expect(planCodeRepair({ ...base, spawnError: true, costUsd: 0.1 }).repair).toBe(false);
    expect(planCodeRepair({ ...base, hasSession: false, costUsd: 0.1 }).repair).toBe(false);
  });

  it("成本守恒：已花超 70% 或剩余不足 $0.1 不修（两轮合计 ≤ 上限）", () => {
    expect(planCodeRepair({ ...base, costUsd: 1.5 }).repair).toBe(false); // 1.5 > 2*0.7
    expect(planCodeRepair({ ...base, maxBudgetUsd: 0.1, costUsd: 0.05 }).repair).toBe(false); // 剩 0.05 < 0.1
    expect(planCodeRepair({ ...base, costUsd: undefined }).repair).toBe(true); // 未上报成本按 0 处理
  });
});

describe("buildCodeRepairPrompt", () => {
  it("带错误信息并截断到 1500 字", () => {
    const p = buildCodeRepairPrompt("TypeError: x is undefined");
    expect(p).toContain("TypeError: x is undefined");
    expect(p).toContain("诊断失败原因");
    const long = buildCodeRepairPrompt("e".repeat(3000));
    expect(long.length).toBeLessThan(1700);
  });
  it("无错误信息时说明「无明确错误输出」", () => {
    expect(buildCodeRepairPrompt(undefined)).toContain("无明确错误输出");
    expect(buildCodeRepairPrompt("   ")).toContain("无明确错误输出");
  });
});
