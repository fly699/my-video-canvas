import { useMemo, useState } from "react";
import { X, Check } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { deriveFilmStage, FILM_STAGES, type FilmStage } from "../../../../shared/filmStage";

// 优化D 向导式推进条：顶部居中一条极简「规划 → 生成 → 装配 → 导出」进度条，
// 按画布真实节点状态高亮当前步、打勾已完成步，并给一句下一步提示——新手不迷路。
// 纯提示、不改数据；可一键关闭（localStorage 持久化，本项目内不再弹）。

const DISMISS_KEY = "avc:wizard-bar-dismissed";
const loadDismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; } };

const ACCENT = "oklch(0.7 0.16 250)";

export function WizardBar() {
  const [dismissed, setDismissed] = useState(loadDismissed);
  const nodes = useCanvasStore((s) => s.nodes);
  const info = useMemo(
    () => deriveFilmStage(nodes.map((n) => ({ data: { nodeType: n.data.nodeType, payload: n.data.payload as Record<string, unknown> } }))),
    [nodes],
  );
  if (dismissed) return null;
  if (nodes.length === 0) return null; // 空画布由 EmptyCanvasGuide 引导，避免双重提示

  const curIdx = FILM_STAGES.findIndex((s) => s.key === info.stage);
  const doneOf = (key: FilmStage, idx: number): boolean => {
    // 当前步之前的都算已完成；「导出」步在有成片时自身也打勾。
    if (idx < curIdx) return true;
    if (key === "export" && info.hasFilm) return true;
    return false;
  };

  return (
    <div data-testid="wizard-bar" className="nodrag nowheel" style={{
      position: "absolute", top: 52, left: "50%", transform: "translateX(-50%)", zIndex: 40,
      display: "flex", alignItems: "center", gap: 10, maxWidth: "min(92vw, 680px)",
      padding: "6px 10px 6px 12px", borderRadius: 12,
      background: "var(--c-base, #16181d)", border: "1px solid var(--c-bd2, #2a2d34)",
      boxShadow: "0 8px 28px oklch(0 0 0 / 0.35)", fontSize: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {FILM_STAGES.map((s, i) => {
          const active = s.key === info.stage;
          const done = doneOf(s.key, i);
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span data-testid={`wizard-step-${s.key}`} data-active={active || undefined} data-done={done || undefined}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 3, padding: "3px 9px", borderRadius: 20,
                  fontWeight: active ? 800 : 600,
                  background: active ? ACCENT : done ? "oklch(0.7 0.16 250 / 0.16)" : "var(--c-surface, #202329)",
                  color: active ? "#0b0d12" : done ? ACCENT : "var(--c-t3, #9aa0aa)",
                  border: `1px solid ${active ? ACCENT : done ? "oklch(0.7 0.16 250 / 0.4)" : "var(--c-bd2, #2a2d34)"}`,
                }}>
                {done && !active && <Check size={10} />}{s.label}
              </span>
              {i < FILM_STAGES.length - 1 && (
                <span style={{ width: 12, height: 1, background: i < curIdx ? ACCENT : "var(--c-bd2, #2a2d34)", flexShrink: 0 }} />
              )}
            </div>
          );
        })}
      </div>
      <span style={{ color: "var(--c-t3, #9aa0aa)", lineHeight: 1.4, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={info.hint}>
        {info.hint}
      </span>
      <button data-testid="wizard-dismiss" title="关闭推进条（本项目不再显示）"
        onClick={() => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ } }}
        style={{ marginLeft: "auto", flexShrink: 0, width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "none", background: "transparent", color: "var(--c-t4, #6b7280)", cursor: "pointer" }}>
        <X size={13} />
      </button>
    </div>
  );
}
