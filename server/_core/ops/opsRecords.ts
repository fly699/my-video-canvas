import type { TrpcContext } from "../context";
import { writeAuditLog, type AuditAction } from "../auditLog";
import { insertOpsRecord } from "../../db";
import { tailLines } from "./sshExec";

// Dual-write an ops action: a detailed comfy_ops_records row (output/exit/duration)
// plus the cross-feature auditLogs entry. Both are best-effort, non-blocking.

export interface RecordOpsInput {
  serverId?: number | null;
  channel: "api" | "ssh" | "terminal";
  action: string;          // ops record action (exec | docker | terminalSession | ...)
  auditAction: AuditAction; // cross-feature audit action (ops:exec | ops:terminal_open | ...)
  command?: string;
  approvedByAi?: boolean;
  autoExecuted?: boolean;
  status: "success" | "error" | "running" | "cancelled";
  exitCode?: number | null;
  durationMs?: number | null;
  output?: string;         // full output; tail-capped before storing
  errorMessage?: string | null;
  detail?: Record<string, unknown>;
}

export function recordOps(ctx: TrpcContext, input: RecordOpsInput): void {
  void insertOpsRecord({
    serverId: input.serverId ?? null,
    userId: ctx.user?.id ?? null,
    userEmail: ctx.user?.email ?? null,
    channel: input.channel,
    action: input.action,
    command: input.command ?? null,
    approvedByAi: input.approvedByAi ?? null,
    autoExecuted: input.autoExecuted ?? false,
    status: input.status,
    exitCode: input.exitCode ?? null,
    durationMs: input.durationMs ?? null,
    outputTail: input.output ? tailLines(input.output) : null,
    errorMessage: input.errorMessage ? input.errorMessage.slice(0, 1024) : null,
    detail: input.detail ?? null,
  }).catch((e) => console.error("[opsRecords] insert failed:", e instanceof Error ? e.message : e));

  writeAuditLog({
    ctx,
    action: input.auditAction,
    detail: {
      serverId: input.serverId ?? undefined,
      channel: input.channel,
      action: input.action,
      status: input.status,
      ...(input.command ? { command: input.command.slice(0, 200) } : {}),
      ...(input.autoExecuted ? { autoExecuted: true } : {}),
      ...(input.approvedByAi ? { approvedByAi: true } : {}),
    },
  });
}
