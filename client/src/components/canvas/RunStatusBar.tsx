import { useReactFlow } from "@xyflow/react";
import { Loader2, CheckCircle2, AlertCircle, Clock, Square, RotateCcw } from "lucide-react";
import type { WorkflowRunState } from "../../hooks/useWorkflowRunner";

// 顶栏全局运行状态条：把各节点分散的进度汇总成一行「生成中/排队/完成/失败」。
// 大画布里出错后不必满屏找红条——点「失败」直接 fitView 跳到失败节点。
// 运行中提供「停止」中止后续派发；失败态提供「重试」一键重跑失败项。
// 仅在运行中或本轮存在失败时显示，平时不占位。
export function RunStatusBar({
  runState,
  onCancel,
  onRetryFailed,
}: {
  runState: WorkflowRunState;
  onCancel?: () => void;
  onRetryFailed?: (ids: string[]) => void;
}) {
  const rf = useReactFlow();
  const phases = Object.values(runState.nodeStates).map((s) => s.phase);
  const running = phases.filter((p) => p === "running").length;
  const pending = phases.filter((p) => p === "pending").length;
  const failed = runState.failedIds.length;
  const done = runState.completedIds.length;
  if (!runState.running && failed === 0) return null;

  const jumpFailed = () => {
    if (failed === 0) return;
    rf.fitView({ nodes: runState.failedIds.map((id) => ({ id })), padding: 0.35, duration: 500, maxZoom: 1.2 });
  };

  const item: React.CSSProperties = { display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600 };
  const pillBtn: React.CSSProperties = { ...item, cursor: "pointer", padding: "2px 8px", borderRadius: 6, lineHeight: 1 };
  return (
    <div role="status" aria-live={failed > 0 ? "assertive" : "polite"}
      aria-label={`运行状态：${running} 生成中，${pending} 排队，${done} 完成，${failed} 失败`}
      className="flex items-center gap-2.5 px-2.5 h-7 rounded-lg flex-shrink-0" style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd2)" }}>
      {runState.running && (
        <span style={{ ...item, color: "oklch(0.72 0.18 250)" }}>
          <Loader2 className="w-3 h-3 animate-spin" />{running} 生成中
        </span>
      )}
      {pending > 0 && (
        <span style={{ ...item, color: "var(--c-t3)" }}>
          <Clock className="w-3 h-3" />{pending} 排队
        </span>
      )}
      {done > 0 && (
        <span style={{ ...item, color: "oklch(0.72 0.18 150)" }}>
          <CheckCircle2 className="w-3 h-3" />{done}
        </span>
      )}
      {failed > 0 && (
        <button onClick={jumpFailed} className="nodrag" title="跳到失败节点" style={{ ...item, color: "oklch(0.62 0.20 25)", cursor: "pointer", background: "none", border: "none", padding: 0 }}>
          <AlertCircle className="w-3 h-3" />{failed} 失败 →
        </button>
      )}
      {/* 运行中：停止后续派发 */}
      {runState.running && onCancel && (
        <button onClick={onCancel} className="nodrag" title="停止运行（不再派发后续节点）"
          style={{ ...pillBtn, color: "oklch(0.62 0.20 25)", background: "oklch(0.62 0.20 25 / 0.12)", border: "1px solid oklch(0.62 0.20 25 / 0.4)" }}>
          <Square className="w-2.5 h-2.5" fill="currentColor" />停止
        </button>
      )}
      {/* 非运行态且有失败：一键重跑失败项 */}
      {!runState.running && failed > 0 && onRetryFailed && (
        <button onClick={() => onRetryFailed(runState.failedIds)} className="nodrag" title={`重试 ${failed} 个失败节点`}
          style={{ ...pillBtn, color: "oklch(0.70 0.16 250)", background: "oklch(0.70 0.16 250 / 0.12)", border: "1px solid oklch(0.70 0.16 250 / 0.4)" }}>
          <RotateCcw className="w-2.5 h-2.5" />重试 {failed} 个
        </button>
      )}
    </div>
  );
}
