import { useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { diffLines, diffStats } from "../../lib/lineDiff";
import { snapshotContent } from "../../lib/scriptHistory";
import { SideShell } from "./ScriptSidePanels";
import type { ScriptNodeData } from "../../../../shared/types";

const HIST_ACCENT = "oklch(0.70 0.15 165)"; // 历史青绿

function relTime(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return new Date(at).toLocaleString("zh-CN");
}

/** 脚本正文版本历史面板：列出历次 AI 改写前的快照，逐行 diff 对比 + 一键还原。 */
export function ScriptHistoryPanel({ id, payload, onClose }: {
  id: string; payload: ScriptNodeData; onClose: () => void;
}) {
  const { updateNodeData } = useCanvasStore();
  const history = payload.scriptHistory ?? [];
  const current = payload.content ?? "";
  // 默认选中最新一条快照
  const [selectedIdx, setSelectedIdx] = useState<number>(history.length - 1);

  const selected = history[selectedIdx];
  const lines = selected ? diffLines(selected.content, current) : [];
  const stats = diffStats(lines);

  const restore = (idx: number) => {
    const entry = history[idx];
    if (!entry) return;
    // 还原前先把「当前」存一份，且还原本身进 undo 栈（非 silent）便于 ctrl-z。
    snapshotContent(id, "还原前");
    updateNodeData(id, { content: entry.content });
    toast.success(`已还原到「${entry.label}」版本`);
  };

  return (
    <SideShell title="版本历史 · 改写前快照" icon={<History style={{ width: 14, height: 14 }} />} accent={HIST_ACCENT} onClose={onClose} width={420}>
      <p style={{ fontSize: 10.5, color: "var(--c-t3)", lineHeight: 1.6, flexShrink: 0 }}>
        每次 AI 改写（润色/精简/风格迁移/整本生成/变体/定向修复）前自动快照旧正文。选一个版本查看与当前的逐行差异，可一键还原（还原可撤销）。
      </p>

      {history.length === 0 ? (
        <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--c-t4)", fontSize: 11 }}>
          暂无历史快照<br />
          <span style={{ fontSize: 10, color: "var(--c-bd3)" }}>使用 AI 改写脚本后，这里会保留改写前的版本</span>
        </div>
      ) : (
        <>
          {/* 版本列表（最新在上） */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
            {history.slice().reverse().map((h, ri) => {
              const idx = history.length - 1 - ri;
              const active = idx === selectedIdx;
              return (
                <button
                  key={h.at + ":" + idx}
                  onClick={() => setSelectedIdx(idx)}
                  className="nodrag"
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                    background: active ? `${HIST_ACCENT}1a` : "var(--c-input)",
                    border: `1px solid ${active ? `${HIST_ACCENT}80` : "var(--c-bd2)"}`,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: active ? HIST_ACCENT : "var(--c-t2)", flex: 1 }}>{h.label}</span>
                  <span style={{ fontSize: 9.5, color: "var(--c-t4)" }}>{relTime(h.at)}</span>
                  <span style={{ fontSize: 9, color: "var(--c-t4)" }}>{h.content.length} 字</span>
                </button>
              );
            })}
          </div>

          {/* 选中版本 vs 当前的逐行 diff */}
          {selected && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: 10.5, color: "var(--c-t3)", flex: 1 }}>
                  「{selected.label}」 → 当前 ·
                  <span style={{ color: "oklch(0.72 0.18 150)", marginLeft: 4 }}>+{stats.added}</span>
                  <span style={{ color: "oklch(0.65 0.22 25)", marginLeft: 4 }}>−{stats.removed}</span>
                </span>
                <button
                  onClick={() => restore(selectedIdx)}
                  className="nodrag"
                  style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, padding: "4px 9px", borderRadius: 7, cursor: "pointer", background: `${HIST_ACCENT}1f`, border: `1px solid ${HIST_ACCENT}66`, color: HIST_ACCENT }}
                >
                  <RotateCcw style={{ width: 11, height: 11 }} /> 还原到此版本
                </button>
              </div>
              <div className="nowheel" style={{ overflowY: "auto", maxHeight: 360, borderRadius: 8, border: "1px solid var(--c-bd1)", background: "var(--c-base)", padding: "6px 0" }}>
                {lines.length === 0 ? (
                  <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--c-t4)" }}>（与当前完全相同）</div>
                ) : lines.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 6, padding: "1px 10px", fontSize: 11, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word",
                      background: l.type === "add" ? "oklch(0.72 0.18 150 / 0.12)" : l.type === "del" ? "oklch(0.65 0.22 25 / 0.12)" : "transparent",
                      color: l.type === "del" ? "oklch(0.72 0.10 25)" : l.type === "add" ? "oklch(0.78 0.12 150)" : "var(--c-t2)",
                    }}
                  >
                    <span style={{ flexShrink: 0, width: 10, textAlign: "center", color: "var(--c-t4)", userSelect: "none" }}>
                      {l.type === "add" ? "+" : l.type === "del" ? "−" : ""}
                    </span>
                    <span style={{ flex: 1 }}>{l.text || " "}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </SideShell>
  );
}
