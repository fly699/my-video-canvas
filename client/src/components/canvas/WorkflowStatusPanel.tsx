import { useMemo, useState, useEffect } from "react";
import { X, CheckCircle2, XCircle, Loader2, Clock, Trash2, ChevronRight } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { getNodeConfig, NODE_ICONS } from "../../lib/nodeConfig";
import type { NodeRunPhase, WorkflowRunState } from "../../hooks/useWorkflowRunner";

interface Props {
  runState: WorkflowRunState;
  /** Force-clear all node statuses; called when user hits the reset button. */
  onReset: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.floor(s - m * 60)}s`;
}

const PHASE_COLOR: Record<NodeRunPhase, string> = {
  pending: "oklch(0.55 0.05 260)",
  running: "oklch(0.68 0.20 260)",
  done: "oklch(0.65 0.18 145)",
  failed: "oklch(0.65 0.20 25)",
  skipped: "oklch(0.50 0.04 260)",
};

const PHASE_LABEL: Record<NodeRunPhase, string> = {
  pending: "等待",
  running: "执行中",
  done: "完成",
  failed: "失败",
  skipped: "跳过",
};

export function WorkflowStatusPanel({ runState, onReset }: Props) {
  const nodes = useCanvasStore((s) => s.nodes);
  const [visible, setVisible] = useState(false);
  const [, force] = useState(0);

  const entryIds = useMemo(() => Object.keys(runState.nodeStates), [runState.nodeStates]);

  // Auto-show when a run starts; user can dismiss; auto-show again on next run start.
  useEffect(() => {
    if (runState.running) setVisible(true);
  }, [runState.running]);

  // Ticking clock so the "running" duration display updates every second.
  useEffect(() => {
    if (!runState.running) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [runState.running]);

  if (entryIds.length === 0) return null;
  if (!visible) {
    // Collapsed pill — click to reopen
    return (
      <button
        onClick={() => setVisible(true)}
        title="展开运行状态面板"
        style={{
          position: "fixed",
          top: 60,
          right: 8,
          zIndex: 99,
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid var(--c-bd2)",
          background: "color-mix(in oklch, var(--c-base) 95%, transparent)",
          color: "var(--c-t2)",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          backdropFilter: "blur(8px)",
          boxShadow: "0 4px 12px oklch(0 0 0 / 0.3)",
        }}
      >
        {runState.running && <Loader2 size={11} className="animate-spin" />}
        运行状态 ({entryIds.length})
        <ChevronRight size={11} style={{ transform: "rotate(180deg)" }} />
      </button>
    );
  }

  const now = Date.now();
  const sortedIds = [...entryIds].sort((a, b) => {
    // Order: running first → failed → done → pending; within each, by startedAt asc
    const pa = runState.nodeStates[a]?.phase ?? "pending";
    const pb = runState.nodeStates[b]?.phase ?? "pending";
    const order: Record<NodeRunPhase, number> = { running: 0, failed: 1, done: 2, pending: 3, skipped: 4 };
    if (order[pa] !== order[pb]) return order[pa] - order[pb];
    const sa = runState.nodeStates[a]?.startedAt ?? 0;
    const sb = runState.nodeStates[b]?.startedAt ?? 0;
    return sa - sb;
  });

  const counts = entryIds.reduce(
    (acc, id) => {
      const phase = runState.nodeStates[id]?.phase ?? "pending";
      acc[phase] = (acc[phase] ?? 0) + 1;
      return acc;
    },
    {} as Record<NodeRunPhase, number>
  );

  return (
    <div
      style={{
        position: "fixed",
        top: 60,
        right: 8,
        width: 320,
        maxHeight: "calc(100vh - 80px)",
        zIndex: 100,
        background: "color-mix(in oklch, var(--c-base) 96%, transparent)",
        border: "1px solid var(--c-bd2)",
        borderRadius: 12,
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px oklch(0 0 0 / 0.5)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--c-bd2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {runState.running && <Loader2 size={13} className="animate-spin" style={{ color: PHASE_COLOR.running }} />}
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-t1)" }}>
            运行状态
          </span>
          <span style={{ fontSize: 11, color: "var(--c-t4)" }}>
            {entryIds.length} 节点
          </span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {!runState.running && (
            <button
              onClick={onReset}
              title="清空运行历史"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--c-t3)",
                display: "flex",
                alignItems: "center",
                padding: 4,
                borderRadius: 4,
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--c-overlay)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
            >
              <Trash2 size={12} />
            </button>
          )}
          <button
            onClick={() => setVisible(false)}
            title="收起面板"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--c-t3)",
              display: "flex",
              alignItems: "center",
              padding: 4,
              borderRadius: 4,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--c-overlay)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Summary counts */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "8px 14px",
          borderBottom: "1px solid var(--c-bd1)",
          fontSize: 10,
        }}
      >
        {(["running", "done", "failed", "pending"] as NodeRunPhase[]).map((phase) =>
          counts[phase] ? (
            <div
              key={phase}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                color: PHASE_COLOR[phase],
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: PHASE_COLOR[phase],
                }}
              />
              {counts[phase]} {PHASE_LABEL[phase]}
            </div>
          ) : null
        )}
      </div>

      {/* Node list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 6px 8px 8px",
        }}
      >
        {sortedIds.map((id) => {
          const status = runState.nodeStates[id]!;
          const node = nodes.find((n) => n.id === id);
          const nodeType = node?.data.nodeType;
          const config = nodeType ? getNodeConfig(nodeType) : null;
          const Icon = config ? NODE_ICONS[config.icon] : null;
          const title = node?.data.title ?? "(已删除节点)";
          const startedAt = status.startedAt;
          const completedAt = status.completedAt;
          const duration =
            status.phase === "running" && startedAt
              ? now - startedAt
              : startedAt && completedAt
                ? completedAt - startedAt
                : undefined;

          return (
            <div
              key={id}
              onClick={() => {
                // Center camera on this node (best-effort: triggers RF select)
                const el = document.querySelector(`.react-flow__node[data-id="${id}"]`);
                if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
              }}
              style={{
                display: "flex",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                marginBottom: 2,
                cursor: node ? "pointer" : "default",
                background: status.phase === "running" ? "oklch(0.68 0.20 260 / 0.08)" : "transparent",
                border: `1px solid ${status.phase === "running" ? "oklch(0.68 0.20 260 / 0.3)" : "transparent"}`,
              }}
              onMouseEnter={(e) => {
                if (status.phase !== "running")
                  (e.currentTarget as HTMLElement).style.background = "var(--c-overlay)";
              }}
              onMouseLeave={(e) => {
                if (status.phase !== "running")
                  (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              {/* Status icon */}
              <div style={{ width: 16, display: "flex", justifyContent: "center", flexShrink: 0, paddingTop: 1 }}>
                {status.phase === "running" && <Loader2 size={13} className="animate-spin" style={{ color: PHASE_COLOR.running }} />}
                {status.phase === "done" && <CheckCircle2 size={13} style={{ color: PHASE_COLOR.done }} />}
                {status.phase === "failed" && <XCircle size={13} style={{ color: PHASE_COLOR.failed }} />}
                {status.phase === "pending" && <Clock size={12} style={{ color: PHASE_COLOR.pending }} />}
                {status.phase === "skipped" && <Clock size={12} style={{ color: PHASE_COLOR.skipped, opacity: 0.5 }} />}
              </div>

              {/* Body */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  {Icon && config && (
                    <Icon style={{ color: config.color, flexShrink: 0, width: 11, height: 11 }} />
                  )}
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--c-t1)",
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {title}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 10,
                    color: "var(--c-t4)",
                    marginTop: 2,
                  }}
                >
                  <span style={{ color: PHASE_COLOR[status.phase], fontWeight: 600 }}>
                    {PHASE_LABEL[status.phase]}
                  </span>
                  {duration != null && (
                    <span>
                      {status.phase === "running" ? "已用 " : ""}
                      {formatDuration(duration)}
                    </span>
                  )}
                </div>
                {status.errorMessage && (
                  <div
                    style={{
                      marginTop: 4,
                      padding: "4px 6px",
                      fontSize: 10,
                      color: "oklch(0.75 0.18 25)",
                      background: "oklch(0.65 0.20 25 / 0.10)",
                      border: "1px solid oklch(0.65 0.20 25 / 0.25)",
                      borderRadius: 4,
                      wordBreak: "break-word",
                      maxHeight: 60,
                      overflow: "auto",
                    }}
                    title={status.errorMessage}
                  >
                    {status.errorMessage.length > 200
                      ? status.errorMessage.slice(0, 200) + "..."
                      : status.errorMessage}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
