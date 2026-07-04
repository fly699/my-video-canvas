// 超级智能体 · Phase 2 —— 执行前权限决策（commandPolicy 前置拦截）。
//
// 供 Claude Code 的「执行前审批」使用：每次工具调用前问这里，危险命令直接 deny，
// 从而在**执行前**拦下（优于 codeAgent.ts 里 stream 监控的事后止损）。
// 交付机制（MCP permission-prompt-tool 或 Agent SDK canUseTool）另接，但决策逻辑收敛于此，
// 纯函数、可完整单测。
import { classifyCommand } from "../ops/commandPolicy";

export type PermissionBehavior = "allow" | "deny";

export interface PermissionDecision {
  behavior: PermissionBehavior;
  /** deny 时给 Claude 的原因（也回灌活动日志）。 */
  message?: string;
  /** allow 时可回传（可能修改后的）工具入参；不改则原样。 */
  updatedInput?: Record<string, unknown>;
}

/** 从工具入参里取 Bash 命令串。 */
function bashCommand(input: Record<string, unknown> | undefined): string | undefined {
  const c = input?.command;
  return typeof c === "string" ? c : undefined;
}

/**
 * 执行前决策：
 * - Bash：跑 commandPolicy.classifyCommand，命中危险模式 → deny（附原因）；否则 allow。
 *   取不到命令串（异常入参）→ deny（保守）。
 * - 其它工具（Read/Edit/Write/mcp__…）：allow（文件操作已由工作目录 + --add-dir 限定）。
 */
export function decidePermission(toolName: string, input: Record<string, unknown> = {}): PermissionDecision {
  if (toolName === "Bash") {
    const cmd = bashCommand(input);
    if (cmd == null) return { behavior: "deny", message: "Bash 调用缺少 command 参数，已拒绝。" };
    const risk = classifyCommand(cmd);
    if (risk.dangerous) {
      return { behavior: "deny", message: `命令被安全策略拦截：${risk.reasons.join("；")}` };
    }
    return { behavior: "allow", updatedInput: input };
  }
  // 非 Bash 工具：放行（由工作目录隔离约束文件访问）。
  return { behavior: "allow", updatedInput: input };
}
