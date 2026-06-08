import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Sparkles, Check } from "lucide-react";
import type { RecognitionFieldRow } from "../../lib/characterRecognition";

interface Props {
  kind: "person" | "scene";
  rows: RecognitionFieldRow[];
  onApply: (patch: Record<string, string>) => void;
  onClose: () => void;
}

/**
 * AI 参考图识别结果预览面板。镜像 CharacterConsistencyPanel：createPortal 模态 + Escape 关闭。
 * 列出每个识别字段的「当前值 → 识别值」，复选框默认勾选会改变内容的字段；点「应用所选」
 * 才把勾选项写回角色节点。
 */
export function CharacterRecognitionPanel({ kind, rows, onApply, onClose }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, r.defaultChecked])),
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const selectedCount = rows.filter((r) => checked[r.key]).length;
  const apply = () => {
    const patch: Record<string, string> = {};
    for (const r of rows) if (checked[r.key]) patch[r.key] = r.recognized;
    onApply(patch);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col"
        style={{
          width: "min(620px, 94vw)", maxHeight: "min(720px, 88vh)",
          background: "var(--c-base)", border: "1px solid var(--c-bd2)",
          borderRadius: 14, boxShadow: "0 24px 60px oklch(0 0 0 / 0.55)", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--c-bd1)" }}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: "oklch(0.68 0.18 300)" }} />
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--c-t1)" }}>AI 识别结果</h3>
              <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--c-t3)" }}>
                {kind === "scene" ? "场景设定" : "人物设定"} · 勾选要填入参数框的字段
              </p>
            </div>
          </div>
          <button onClick={onClose} className="nodrag" style={{ color: "var(--c-t3)", background: "none", border: "none", cursor: "pointer" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-1.5 p-3 overflow-y-auto" style={{ minHeight: 0 }}>
          {rows.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--c-t4)", textAlign: "center", padding: "28px 8px" }}>
              未识别出可填充的字段。
            </div>
          )}
          {rows.map((r) => {
            const on = !!checked[r.key];
            return (
              <button
                key={r.key}
                onClick={() => setChecked((c) => ({ ...c, [r.key]: !c[r.key] }))}
                className="nodrag flex items-start gap-2.5 text-left"
                style={{
                  padding: "8px 10px", borderRadius: 9, cursor: "pointer",
                  background: on ? "oklch(0.68 0.18 300 / 0.08)" : "var(--c-input)",
                  border: `1px solid ${on ? "oklch(0.68 0.18 300 / 0.4)" : "var(--c-bd2)"}`,
                }}
              >
                <span
                  className="flex-shrink-0 flex items-center justify-center"
                  style={{
                    width: 16, height: 16, marginTop: 1, borderRadius: 4,
                    background: on ? "oklch(0.68 0.18 300)" : "transparent",
                    border: `1.5px solid ${on ? "oklch(0.68 0.18 300)" : "var(--c-bd3)"}`,
                  }}
                >
                  {on && <Check className="w-3 h-3" style={{ color: "white" }} />}
                </span>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--c-t2)", marginBottom: 2 }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: "var(--c-t1)", wordBreak: "break-word" }}>{r.recognized}</div>
                  {r.current && (
                    <div style={{ fontSize: 10.5, color: "var(--c-t4)", marginTop: 2, wordBreak: "break-word" }}>
                      当前：{r.current}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2" style={{ padding: "12px 16px", borderTop: "1px solid var(--c-bd1)" }}>
          <button onClick={onClose} className="nodrag" style={{ fontSize: 12, padding: "7px 14px", borderRadius: 9, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)", cursor: "pointer" }}>
            取消
          </button>
          <button
            onClick={apply}
            disabled={selectedCount === 0}
            className="nodrag"
            style={{
              fontSize: 12, fontWeight: 600, padding: "7px 16px", borderRadius: 9,
              background: selectedCount === 0 ? "var(--c-surface)" : "oklch(0.68 0.18 300)",
              border: "1px solid oklch(0.68 0.18 300 / 0.5)",
              color: selectedCount === 0 ? "var(--c-t4)" : "white",
              cursor: selectedCount === 0 ? "not-allowed" : "pointer",
            }}
          >
            应用所选（{selectedCount}）
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
