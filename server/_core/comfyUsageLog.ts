// Fire-and-forget recorder for per-user ComfyUI server usage. Captures every
// dimension of a ComfyUI call (who, which server/host:port, model, status,
// duration, result, error) into the comfyUsageLogs table. Never throws into the
// request path (failures are logged to console), mirroring writeAuditLog.

import * as db from "../db";

interface UsageCtx {
  user?: { id?: number; email?: string | null; name?: string | null } | null;
  clientIp?: string;
}

export interface ComfyUsageFields {
  action: string;                 // generateImage / generateVideo / executeWorkflow / serverAction:free …
  baseUrl: string;                // server address used
  model?: string | null;          // ckpt / template / preprocessor
  projectId?: number | null;
  nodeId?: string | null;
  status: "success" | "error";
  durationMs: number;
  resultUrl?: string | null;
  resultCount?: number | null;
  errorMessage?: string | null;
  detail?: Record<string, unknown> | null;
}

function hostFromUrl(u: string): string {
  try { return new URL(u).host; } catch { return u.slice(0, 255); }
}
const cut = (s: string | null | undefined, n: number): string | null => (s == null ? null : String(s).slice(0, n));

export function recordComfyUsage(ctx: UsageCtx, f: ComfyUsageFields): void {
  db.insertComfyUsageLog({
    userId: ctx.user?.id ?? null,
    userEmail: cut(ctx.user?.email ?? null, 320),
    userName: cut(ctx.user?.name ?? null, 255),
    ip: ctx.clientIp || "unknown",
    action: cut(f.action, 64) ?? "unknown",
    baseUrl: cut(f.baseUrl, 512) ?? "",
    host: cut(hostFromUrl(f.baseUrl), 255),
    model: cut(f.model ?? null, 255),
    projectId: f.projectId ?? null,
    nodeId: cut(f.nodeId ?? null, 255),
    status: f.status,
    durationMs: Number.isFinite(f.durationMs) ? Math.round(f.durationMs) : null,
    resultUrl: cut(f.resultUrl ?? null, 2048),
    resultCount: f.resultCount ?? null,
    errorMessage: cut(f.errorMessage ?? null, 1024),
    detail: f.detail ?? null,
  }).catch((e) => console.error("[ComfyUsageLog] write failed:", e instanceof Error ? e.message : String(e)));
}

/** Time an async ComfyUI call and record one usage row (success OR error), then
 *  return the result / rethrow. Keeps instrumentation to a single wrapping call. */
export async function withComfyUsageLog<T>(
  ctx: UsageCtx,
  meta: Omit<ComfyUsageFields, "status" | "durationMs" | "resultUrl" | "resultCount" | "errorMessage">,
  fn: () => Promise<T>,
  onResult?: (result: T) => { resultUrl?: string | null; resultCount?: number | null },
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const r = onResult?.(result) ?? {};
    recordComfyUsage(ctx, { ...meta, status: "success", durationMs: Date.now() - startedAt, resultUrl: r.resultUrl ?? null, resultCount: r.resultCount ?? null });
    return result;
  } catch (err) {
    recordComfyUsage(ctx, { ...meta, status: "error", durationMs: Date.now() - startedAt, errorMessage: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
