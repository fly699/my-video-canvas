// 超级智能体 · Phase 2 —— 无头 Claude Code 子进程封装（受限工作目录方案）。
//
// 默认完全 inert：仅当 env SUPER_AGENT_CODE_ENABLED=1 才允许 spawn。
// 双钥安全：即便启用，原始 Bash 仍需第二个显式 env SUPER_AGENT_CODE_ALLOW_BASH=1；
// 否则只放行 Read/Edit/Write（claude 只能在工作区读写文件，不能跑任意 shell）。
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ClaudeArgsOptions, ClaudePermissionMode } from "./codeAgent";
import { PERMISSION_TOOL_NAME } from "./permissionMcpServer";

/** 是否启用 Phase 2 代码智能体（默认关闭）。 */
export function isCodeAgentEnabled(): boolean {
  return process.env.SUPER_AGENT_CODE_ENABLED === "1";
}

/** 是否额外放行原始 Bash（第二把钥匙，默认关闭）。 */
export function isBashAllowed(): boolean {
  return process.env.SUPER_AGENT_CODE_ALLOW_BASH === "1";
}

/** claude 可执行文件（可用 env CLAUDE_BIN 覆盖）。 */
export function resolveClaudeBin(): string {
  return process.env.CLAUDE_BIN?.trim() || "claude";
}

/** 一次运行的完整权限接线（工具白名单 + 权限模式 + 可选的执行前审批 MCP）。 */
export type PermissionWiring = Pick<ClaudeArgsOptions, "allowedTools" | "disallowedTools" | "permissionMode" | "mcpConfig" | "strictMcp" | "permissionPromptTool">;

/**
 * 解析本次运行的完整权限接线。
 * - 未放行 Bash：Read/Edit/Write（无 shell），acceptEdits。
 * - 放行 Bash 且配置了执行前审批 MCP（env SUPER_AGENT_PERMISSION_CMD）：不预授 Bash，改用
 *   permission-mode=default + --permission-prompt-tool，让每条命令在**执行前**经 commandPolicy
 *   MCP 审批（危险即拒、根本不跑）。这是比事后监控更强的拦截；命令仍受 codeAgent 事后监控兜底。
 * - 放行 Bash 但未配置审批 MCP：预授 Bash + acceptEdits（仅靠事后监控止损，弱一档）。
 */
export function resolvePermissionWiring(): PermissionWiring {
  if (!isBashAllowed()) {
    return { allowedTools: ["Read", "Edit", "Write"], disallowedTools: [], permissionMode: "acceptEdits" };
  }
  const highRisk = ["Bash(rm *)", "Bash(sudo *)", "Bash(shutdown *)", "Bash(reboot *)", "Bash(mkfs *)", "Bash(dd *)"];
  const cmd = process.env.SUPER_AGENT_PERMISSION_CMD?.trim();
  if (cmd) {
    let argv: string[] = [];
    try { const p = JSON.parse(process.env.SUPER_AGENT_PERMISSION_ARGS || "[]"); if (Array.isArray(p)) argv = p.map(String); } catch { /* 用空参数 */ }
    const mcpConfig = JSON.stringify({ mcpServers: { policy: { type: "stdio", command: cmd, args: argv } } });
    return {
      // 不预授 Bash：让未被 allow 规则覆盖的 Bash 落到执行前审批工具。
      allowedTools: ["Read", "Edit", "Write"],
      disallowedTools: highRisk,
      permissionMode: "default",
      mcpConfig,
      strictMcp: true,
      permissionPromptTool: `mcp__policy__${PERMISSION_TOOL_NAME}`,
    };
  }
  return { allowedTools: ["Read", "Edit", "Write", "Bash"], disallowedTools: highRisk, permissionMode: "acceptEdits" };
}

export interface StreamClaudeOptions {
  /** 任务提示词（走 stdin）。 */
  task: string;
  /** 工作目录（专用 scratch）。 */
  cwd: string;
  /** buildClaudeArgs 的额外项（模型/预算/add-dir 等）；base 为已解析的权限接线。 */
  argsBuilder: (base: PermissionWiring) => string[];
  /** 硬超时（ms），到点杀进程。 */
  timeoutMs: number;
}

export interface StreamClaudeHandle {
  /** 逐行 stdout（stream-json），交给 runCodeAgent 消费。 */
  lines: AsyncIterable<string>;
  /** 杀掉子进程（危险命令中止 / 超时 / 取消）。 */
  kill: () => void;
  /** 进程结束（正常/被杀/超时）。 */
  done: Promise<{ exitCode: number | null; timedOut: boolean }>;
}

/**
 * spawn 无头 claude，返回逐行输出迭代器 + kill + done。
 * execFile 式安全：命令是固定的 claude 二进制 + 数组参数（无 shell 拼接）；提示词走 stdin。
 * 抛错：未启用（env 关闭）时直接拒绝。
 */
export function streamClaudeCode(opts: StreamClaudeOptions): StreamClaudeHandle {
  if (!isCodeAgentEnabled()) {
    throw new Error("代码智能体未启用：请在服务端设置 SUPER_AGENT_CODE_ENABLED=1");
  }
  const policy = resolvePermissionWiring();
  const args = opts.argsBuilder(policy);
  const child = spawn(resolveClaudeBin(), args, {
    cwd: opts.cwd,
    env: process.env, // 继承 ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN 等（由运维配置）
    stdio: ["pipe", "pipe", "pipe"],
  });

  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, opts.timeoutMs);

  // 提示词走 stdin 后关闭。
  child.stdin.write(opts.task);
  child.stdin.end();

  const rl = createInterface({ input: child.stdout });

  const done = new Promise<{ exitCode: number | null; timedOut: boolean }>((resolve) => {
    child.on("close", (code) => { clearTimeout(timer); resolve({ exitCode: code, timedOut }); });
    child.on("error", () => { clearTimeout(timer); resolve({ exitCode: null, timedOut }); });
  });

  return {
    lines: rl,
    kill: () => { try { child.kill("SIGKILL"); } catch { /* already gone */ } },
    done,
  };
}
