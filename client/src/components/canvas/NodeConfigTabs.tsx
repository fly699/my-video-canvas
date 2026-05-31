import type { LucideIcon } from "lucide-react";

export interface ConfigTab {
  key: string;
  label: string;
  Icon: LucideIcon;
}

/**
 * 节点配置分段标签容器。把原本纵向堆叠的折叠分区重组为标签页，内容区固定高度
 * 内部滚动，避免节点展开后无限增高。children 由调用方按 active 条件渲染各面板。
 */
export function NodeConfigTabs({
  tabs, active, onChange, accent, maxBodyHeight = 420, children,
}: {
  tabs: ConfigTab[];
  active: string;
  onChange: (key: string) => void;
  accent: string;
  maxBodyHeight?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      {/* Tab bar */}
      <div
        className="nodrag flex items-center gap-1 mb-2 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {tabs.map((t) => {
          const on = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className="nodrag flex items-center gap-1 flex-shrink-0 rounded-md transition-colors"
              style={{
                fontSize: 10.5,
                fontWeight: on ? 600 : 500,
                padding: "4px 8px",
                background: on ? `${accent}1f` : "transparent",
                border: `1px solid ${on ? `${accent}66` : "var(--c-bd2)"}`,
                color: on ? accent : "var(--c-t3)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <t.Icon style={{ width: 11, height: 11 }} />
              {t.label}
            </button>
          );
        })}
      </div>
      {/* Body — capped height with internal scroll */}
      <div className="nowheel nodrag" style={{ maxHeight: maxBodyHeight, overflowY: "auto", overflowX: "hidden" }}>
        {children}
      </div>
    </div>
  );
}
