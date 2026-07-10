import { useState } from "react";
import { X, ListTree, FolderOpen } from "lucide-react";
import { OutlineList } from "./OutlineList";
import { AssetPanel } from "./AssetPanel";

/**
 * LibTV 化 2.4：资产管理左栏——左侧滑入的常驻面板（覆盖式，不推挤画布），
 * 双 tab：画布大纲（OutlineList，节点结构+状态总览）/ 资产（AssetPanel 嵌入模式，
 * 与浮动素材库同一组件同一能力，只换宿主形态）。滑入模式仿右侧「画布统计」侧栏。
 */
export function CanvasLeftPanel({ open, projectId, onClose }: {
  open: boolean;
  projectId: number;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"outline" | "assets">("outline");
  return (
    <div
      style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 272,
        background: "var(--c-base)", borderRight: "1px solid var(--c-bd1)",
        display: "flex", flexDirection: "column",
        transform: open ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 280ms cubic-bezier(0.23, 1, 0.32, 1)",
        zIndex: 16,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {/* Tab 头 */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-0 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-elevated)" }}>
        {([
          { key: "outline" as const, label: "大纲", Icon: ListTree },
          { key: "assets" as const, label: "资产", Icon: FolderOpen },
        ]).map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex items-center gap-1.5 px-3 py-2 transition-colors"
            style={{
              fontSize: 12, fontWeight: 700,
              color: tab === key ? "var(--c-t1)" : "var(--c-t4)",
              borderBottom: `2px solid ${tab === key ? "var(--ui-accent, var(--c-accent))" : "transparent"}`,
              marginBottom: -1, background: "transparent", cursor: "pointer",
            }}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all mb-1"
          style={{ color: "var(--c-t4)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t2)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}
          title="收起左栏"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {tab === "outline"
          ? <OutlineList />
          : <AssetPanel projectId={projectId} onClose={onClose} embedded />}
      </div>
    </div>
  );
}
