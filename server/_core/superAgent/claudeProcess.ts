// 超级智能体 · Phase 2 —— 无头 Claude Code 子进程封装（受限工作目录方案）。
//
// 默认完全 inert：仅当 env SUPER_AGENT_CODE_ENABLED=1 才允许 spawn。
// 双钥安全：即便启用，原始 Bash 仍需第二个显式 env SUPER_AGENT_CODE_ALLOW_BASH=1；
// 否则只放行 Read/Edit/Write（claude 只能在工作区读写文件，不能跑任意 shell）。
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ClaudeArgsOptions, ClaudePermissionMode } from "./codeAgent";

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

/**
 * 解析本次运行的工具策略。
 * - 未额外放行 Bash：allowedTools=Read/Edit/Write，permission-mode=acceptEdits（自动批准
 *   文件编辑，无 shell）。
 * - 放行 Bash：加入 "Bash"（预授权，运行时由 runCodeAgent 的 commandPolicy 监控 + 危险即杀），
 *   并显式 disallow 一批高危 shape 作纵深防御。
 */
export function resolveToolPolicy(): { allowedTools: string[]; disallowedTools: string[]; permissionMode: ClaudePermissionMode } {
  if (isBashAllowed()) {
    return {
      allowedTools: ["Read", "Edit", "Write", "Bash"],
      disallowedTools: ["Bash(rm *)", "Bash(sudo *)", "Bash(shutdown *)", "Bash(reboot *)", "Bash(mkfs *)", "Bash(dd *)"],
      permissionMode: "acceptEdits",
    };
  }
  return { allowedTools: ["Read", "Edit", "Write"], disallowedTools: [], permissionMode: "acceptEdits" };
}

export interface StreamClaudeOptions {
  /** 任务提示词（走 stdin）。 */
  task: string;
  /** 工作目录（专用 scratch）。 */
  cwd: string;
  /** buildClaudeArgs 的额外项（模型/预算/mcp/add-dir 等）。 */
  argsBuilder: (base: Pick<ClaudeArgsOptions, "allowedTools" | "disallowedTools" | "permissionMode">) => string[];
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
  const policy = resolveToolPolicy();
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
