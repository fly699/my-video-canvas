import { memo, useState, useEffect } from "react";
import { NodeResizer } from "@xyflow/react";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { GroupNodeData } from "../../../../../shared/types";
import { FolderOpen, FolderClosed, Pencil, Check } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "group";
    title: string;
    payload: GroupNodeData;
    projectId: number;
  };
}

const GROUP_COLORS = [
  { value: "blue",   accent: "oklch(0.62 0.18 240)", bg: "oklch(0.62 0.18 240 / 0.04)", border: "oklch(0.62 0.18 240 / 0.20)" },
  { value: "green",  accent: "oklch(0.65 0.20 160)", bg: "oklch(0.65 0.20 160 / 0.04)", border: "oklch(0.65 0.20 160 / 0.20)" },
  { value: "purple", accent: "oklch(0.68 0.22 300)", bg: "oklch(0.68 0.22 300 / 0.04)", border: "oklch(0.68 0.22 300 / 0.20)" },
  { value: "orange", accent: "oklch(0.70 0.20 60)",  bg: "oklch(0.70 0.20 60 / 0.04)",  border: "oklch(0.70 0.20 60 / 0.20)" },
  { value: "gray",   accent: "oklch(0.55 0.08 260)", bg: "oklch(0.55 0.08 260 / 0.04)", border: "oklch(0.55 0.08 260 / 0.20)" },
];

export const GroupNode = memo(function GroupNode({ id, selected, data }: Props) {
  const { updateNodeData, updateNodeTitle } = useCanvasStore();
  const payload = data.payload;
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(data.title);
  useEffect(() => {
    if (!editingLabel) setLabelValue(data.title);
  }, [data.title, editingLabel]);
  const collapsed = payload.collapsed ?? false;
  const colorKey = payload.color ?? "gray";
  const color = GROUP_COLORS.find(c => c.value === colorKey) ?? GROUP_COLORS[4];
  const memberCount = payload.childIds?.length ?? 0;

  const handleSaveLabel = () => {
    updateNodeTitle(id, labelValue.trim() || "分组");
    setEditingLabel(false);
  };

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={120}
        lineStyle={{ stroke: color.accent, strokeWidth: 1, opacity: 0.6 }}
        handleStyle={{ background: color.accent, borderColor: color.accent, width: 8, height: 8, borderRadius: 2, opacity: 0.8 }}
      />
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 16,
          background: color.bg,
          border: `1.5px ${selected ? "solid" : "dashed"} ${selected ? color.accent : color.border}`,
          // Share BaseNode's shadow tokens so groups read as part of the same node
          // family: a soft resting shadow, and a colored glow ring when selected.
          boxShadow: selected
            ? `0 0 0 4px ${color.accent}1f, var(--c-node-shadow-selected)`
            : "var(--c-node-shadow-rest)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "border-color 150ms ease, border-style 150ms ease, box-shadow 150ms ease",
        }}
      >
        {/* Header bar */}
        <div
          className="nodrag flex items-center gap-2 px-3 py-2 flex-shrink-0"
          style={{
            background: `${color.accent}10`,
            borderBottom: `1px solid ${color.border}`,
          }}
        >
          <button
            onClick={() => updateNodeData(id, { collapsed: !collapsed })}
            style={{ color: color.accent, background: "none", border: "none", cursor: "pointer", lineHeight: 0, padding: 0 }}
          >
            {collapsed
              ? <FolderClosed style={{ width: 14, height: 14 }} />
              : <FolderOpen style={{ width: 14, height: 14 }} />
            }
          </button>

          {editingLabel ? (
            <input
              autoFocus
              value={labelValue}
              onChange={(e) => setLabelValue(e.target.value)}
              onBlur={handleSaveLabel}
              onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } if (e.key === "Escape") { setEditingLabel(false); setLabelValue(data.title); } }}
              style={{
                flex: 1, fontSize: 12, fontWeight: 600, background: "transparent",
                border: "none", borderBottom: `1px solid ${color.accent}`,
                outline: "none", color: color.accent, padding: "0 2px",
              }}
            />
          ) : (
            <span
              onDoubleClick={() => setEditingLabel(true)}
              style={{ flex: 1, fontSize: 12, fontWeight: 600, color: color.accent, cursor: "text", userSelect: "none", display: "flex", alignItems: "center", gap: 6 }}
            >
              {data.title}
              {memberCount > 0 && (
                <span style={{ fontSize: 10, fontWeight: 600, color: color.accent, opacity: 0.7, background: `${color.accent}1a`, border: `1px solid ${color.border}`, borderRadius: 6, padding: "0 5px", lineHeight: "15px" }}>
                  {memberCount} 个节点
                </span>
              )}
            </span>
          )}

          {/* Color picker */}
          <div className="flex gap-1">
            {GROUP_COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => updateNodeData(id, { color: c.value })}
                style={{
                  width: 10, height: 10, borderRadius: "50%", cursor: "pointer", padding: 0,
                  background: c.accent,
                  border: colorKey === c.value ? `2px solid white` : "1.5px solid transparent",
                  outline: "none",
                }}
              />
            ))}
          </div>
        </div>

        {/* Body — visible when expanded */}
        {!collapsed && (
          <div style={{ flex: 1, padding: 12, display: "flex", alignItems: "flex-start" }}>
            <p style={{ fontSize: 10, color: color.border, userSelect: "none", fontStyle: "italic" }}>
              拖动节点到此区域进行分组
            </p>
          </div>
        )}
      </div>
    </>
  );
});
