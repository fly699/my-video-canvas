import { History, Columns2 } from "lucide-react";
import { MediaImage } from "./MediaImage";
import type { ResultSnapshot } from "../../../../shared/types";

// 通用「结果版本历史」缩略图条（#5）：历次产出的结果快照，点击回滚到该版本（当前项高亮）。
// ≥2 条才显示。图像节点/ComfyUI 图像/自定义工作流(图像输出) 共用。
// onCompare（可选）：非当前版本 hover 出「对比」小钮 → 建对比节点（A=当前结果 B=该版本），
// 用于生成版本间滑块对比。
export function ResultHistoryStrip({ history, currentUrl, accent, onRollback, onCompare }: {
  history: ResultSnapshot[] | undefined;
  currentUrl?: string;
  accent: string;
  onRollback: (snap: ResultSnapshot) => void;
  onCompare?: (snap: ResultSnapshot) => void;
}) {
  if ((history?.length ?? 0) < 2) return null;
  const list = history!;
  return (
    <div className="flex-shrink-0">
      <div style={{ fontSize: 10, color: "var(--c-t4)", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
        <History style={{ width: 10, height: 10 }} /> 版本历史 · 点击回滚{onCompare ? " · ⿲对比" : ""}（{list.length}）
      </div>
      <div className="nowheel" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
        {list.map((snap, i) => {
          const isCurrent = snap.url === currentUrl;
          return (
            <div key={snap.url} className="relative flex-shrink-0 group/rhs" style={{ width: 56, height: 56 }}>
              <button
                onClick={() => onRollback(snap)}
                title={snap.prompt ? `回滚到此版本\n${snap.prompt}` : "回滚到此版本"}
                className="nodrag relative w-full h-full rounded-lg overflow-hidden"
                style={{ borderWidth: 2, borderStyle: "solid", borderColor: isCurrent ? accent : "var(--c-bd2)", cursor: "pointer", opacity: isCurrent ? 1 : 0.82, background: "var(--c-canvas)" }}
              >
                <MediaImage src={snap.url} alt={`v${i + 1}`} className="w-full h-full object-cover" draggable={false} />
                <span style={{ position: "absolute", top: 2, left: 2, fontSize: 8, fontWeight: 700, lineHeight: "12px", padding: "0 4px", borderRadius: 4, background: "oklch(0 0 0 / 0.6)", color: "#fff" }}>{list.length - i}</span>
                {isCurrent && <span style={{ position: "absolute", bottom: 2, left: 2, fontSize: 8, fontWeight: 700, lineHeight: "12px", padding: "0 4px", borderRadius: 4, background: accent, color: "#fff" }}>当前</span>}
              </button>
              {onCompare && !isCurrent && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCompare(snap); }}
                  title="与当前结果对比（建对比节点：A=当前 B=此版本）"
                  className="nodrag opacity-0 group-hover/rhs:opacity-100 transition-opacity"
                  style={{ position: "absolute", bottom: 2, right: 2, width: 18, height: 18, borderRadius: 5, background: "oklch(0 0 0 / 0.7)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                >
                  <Columns2 size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
