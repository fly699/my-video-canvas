// 超级智能体 · Phase 2（受限工作目录 + commandPolicy 方案）——
// 无头 Claude Code 编码任务的「参数构建 + stream-json 解析 + 命令安全监控」纯逻辑核心。
//
// 设计（与 Phase 1 同范式）：纯函数、依赖注入、可离线单测。真正 spawn `claude` 进程的
// 集成层（claudeProcess.ts）与 router 另做，且默认 env 关闭 + 限超管 L4。
//
// 安全分层（本方案）：
//  1) 工作目录隔离：claude 以 cwd=专用 scratch 目录运行，仅 --add-dir 该目录，文件操作被限。
//  2) 工具白名单：--allowedTools 只放行必要工具；不授予无约束 Bash（见 buildClaudeArgs 默认）。
//  3) 命令监控：解析 stream-json 里的 Bash tool_use，用 commandPolicy.classifyCommand 判危；
//     命中危险模式 → 上报并中止（杀进程）。注意：tool_use 事件在模型决定调用时到达，属「事后
//     监控 + 及时止损」；真正的「执行前拦截」需 --permission-prompt-tool（下一 PR，接 commandPolicy MCP）。
import { classifyCommand, type CommandRisk } from "../ops/commandPolicy";

// ── 参数构建 ─────────────────────────────────────────────────────────────────

export type ClaudePermissionMode = "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions";

export interface ClaudeArgsOptions {
  /** 权限模式。默认 "default"（未白名单的工具在无头下被拒，最安全）。 */
  permissionMode?: ClaudePermissionMode;
  /** 放行工具（如 ["Read","Edit","Write","Bash(git *)"]）。 */
  allowedTools?: string[];
  /** 拒绝工具。 */
  disallowedTools?: string[];
  /** 额外可访问目录（工作区）。 */
  addDirs?: string[];
  /** 模型别名或全名。 */
  model?: string;
  /** MCP 配置文件路径或内联 JSON。 */
  mcpConfig?: string;
  /** 仅用 --mcp-config 指定的 MCP，忽略其它来源。 */
  strictMcp?: boolean;
  /** 成本封顶（美元）——单任务硬上限。 */
  maxBudgetUsd?: number;
}

/**
 * 构建无头 Claude Code 的命令行参数（提示词走 stdin，不放进 argv，避免转义/长度问题）。
 * 固定 `-p --output-format stream-json --verbose`（stream-json 在 -p 下需 --verbose）。
 */
export function buildClaudeArgs(opts: ClaudeArgsOptions): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  args.push("--permission-mode", opts.permissionMode ?? "default");
  if (opts.allowedTools?.length) args.push("--allowedTools", opts.allowedTools.join(","));
  if (opts.disallowedTools?.length) args.push("--disallowedTools", opts.disallowedTools.join(","));
  for (const d of opts.addDirs ?? []) args.push("--add-dir", d);
  if (opts.model) args.push("--model", opts.model);
  if (opts.mcpConfig) {
    args.push("--mcp-config", opts.mcpConfig);
    if (opts.strictMcp) args.push("--strict-mcp-config");
  }
  if (opts.maxBudgetUsd != null) args.push("--max-budget-usd", String(opts.maxBudgetUsd));
  return args;
}

// ── stream-json 解析 ─────────────────────────────────────────────────────────

export type CodeEventKind = "init" | "text" | "tool_use" | "tool_result" | "result" | "unknown";

export interface CodeAgentEvent {
  kind: CodeEventKind;
  /** text：增量/整段文本。 */
  text?: string;
  /** tool_use：工具名（Read/Edit/Bash/mcp__…）。 */
  tool?: string;
  /** tool_use：工具入参。 */
  input?: Record<string, unknown>;
  /** tool_use 且 tool==="Bash" 时抽出的命令串。 */
  command?: string;
  /** result：最终结果。 */
  isError?: boolean;
  result?: string;
  costUsd?: number;
  numTurns?: number;
  durationMs?: number;
  sessionId?: string;
}

type RawContentBlock = { type?: string; name?: string; input?: unknown; text?: string };

function bashCommandOf(tool: string | undefined, input: unknown): string | undefined {
  if (tool !== "Bash") return undefined;
  const cmd = (input as { command?: unknown } | undefined)?.command;
  return typeof cmd === "string" ? cmd : undefined;
}

/** 解析一行 stream-json，产出 0+ 个归一化事件（一行可能含多个 content block）。容错：解析失败→[]。 */
export function parseStreamLine(line: string): CodeAgentEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(trimmed) as Record<string, unknown>; } catch { return []; }
  const type = raw.type as string | undefined;

  if (type === "system") {
    if (raw.subtype === "init") return [{ kind: "init", sessionId: raw.session_id as string | undefined }];
    return [{ kind: "unknown" }];
  }

  if (type === "stream_event") {
    const ev = raw.event as Record<string, unknown> | undefined;
    if (!ev) return [];
    if (ev.type === "content_block_delta") {
      const delta = ev.delta as { type?: string; text?: string } | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") return [{ kind: "text", text: delta.text }];
      return [];
    }
    if (ev.type === "content_block_start") {
      const block = ev.content_block as RawContentBlock | undefined;
      if (block?.type === "tool_use") {
        const input = (block.input ?? {}) as Record<string, unknown>;
        return [{ kind: "tool_use", tool: block.name, input, command: bashCommandOf(block.name, input) }];
      }
      return [];
    }
    return [];
  }

  if (type === "assistant") {
    // 非部分模式：assistant 消息带完整 content 数组，可能同时有 text 与 tool_use。
    const msg = raw.message as { content?: RawContentBlock[] } | undefined;
    const out: CodeAgentEvent[] = [];
    for (const b of msg?.content ?? []) {
      if (b.type === "text" && typeof b.text === "string") out.push({ kind: "text", text: b.text });
      else if (b.type === "tool_use") {
        const input = (b.input ?? {}) as Record<string, unknown>;
        out.push({ kind: "tool_use", tool: b.name, input, command: bashCommandOf(b.name, input) });
      }
    }
    return out;
  }

  if (type === "user") return [{ kind: "tool_result" }];

  if (type === "result") {
    return [{
      kind: "result",
      isError: raw.is_error === true || raw.subtype === "error",
      result: typeof raw.result === "string" ? raw.result : undefined,
      costUsd: typeof raw.total_cost_usd === "number" ? raw.total_cost_usd : undefined,
      numTurns: typeof raw.num_turns === "number" ? raw.num_turns : undefined,
      durationMs: typeof raw.duration_ms === "number" ? raw.duration_ms : undefined,
      sessionId: raw.session_id as string | undefined,
    }];
  }

  return [{ kind: "unknown" }];
}

// ── 编排（监控 + 归一化事件流） ──────────────────────────────────────────────

export type CodeRunEventType = "text" | "tool" | "command" | "blocked" | "result" | "error";

export interface CodeRunEvent {
  type: CodeRunEventType;
  message: string;
  data?: unknown;
}

export interface RunCodeAgentResult {
  status: "success" | "failed" | "aborted";
  /** 命中危险命令而中止时的原因/命令。 */
  abortReason?: string;
  blockedCommand?: string;
  result?: string;
  costUsd?: number;
  numTurns?: number;
  events: CodeRunEvent[];
}

export interface RunCodeAgentOptions {
  /** 注入的 stream-json 行来源（真实实现由子进程 stdout 逐行喂入；单测喂假数组）。 */
  lines: AsyncIterable<string>;
  emit?: (e: CodeRunEvent) => void;
  /** 命令危险分类器（默认用 commandPolicy.classifyCommand；可注入以便单测）。 */
  classify?: (command: string) => CommandRisk;
  /** 命中危险命令时调用（真实实现里用于杀掉子进程止损）。 */
  onAbort?: (command: string, risk: CommandRisk) => void;
}

/**
 * 消费一段 stream-json 行，产出归一化运行事件；对每条 Bash 命令跑 commandPolicy，
 * 命中危险模式即中止（并回调 onAbort 供上层杀进程）。纯编排，可完整单测。
 */
export async function runCodeAgent(opts: RunCodeAgentOptions): Promise<RunCodeAgentResult> {
  const classify = opts.classify ?? classifyCommand;
  const events: CodeRunEvent[] = [];
  const emit = (e: CodeRunEvent) => { events.push(e); opts.emit?.(e); };
  let final: CodeAgentEvent | undefined;

  for await (const line of opts.lines) {
    for (const evt of parseStreamLine(line)) {
      if (evt.kind === "text" && evt.text) {
        emit({ type: "text", message: evt.text });
      } else if (evt.kind === "tool_use") {
        if (evt.command) {
          const risk = classify(evt.command);
          if (risk.dangerous) {
            emit({ type: "blocked", message: `拦截危险命令：${evt.command}（${risk.reasons.join("；")}）`, data: { command: evt.command, reasons: risk.reasons } });
            opts.onAbort?.(evt.command, risk);
            return { status: "aborted", abortReason: risk.reasons.join("；"), blockedCommand: evt.command, events };
          }
          emit({ type: "command", message: `运行命令：${evt.command}`, data: { command: evt.command } });
        } else {
          emit({ type: "tool", message: `调用工具：${evt.tool ?? "?"}`, data: { tool: evt.tool, input: evt.input } });
        }
      } else if (evt.kind === "result") {
        final = evt;
        emit({ type: evt.isError ? "error" : "result", message: evt.isError ? `任务失败：${evt.result ?? ""}` : (evt.result ?? "完成"), data: { costUsd: evt.costUsd, numTurns: evt.numTurns } });
      }
    }
  }

  return {
    status: final ? (final.isError ? "failed" : "success") : "failed",
    result: final?.result,
    costUsd: final?.costUsd,
    numTurns: final?.numTurns,
    events,
  };
}
