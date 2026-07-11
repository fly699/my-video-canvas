import { memo, useState, useEffect } from "react";
import { NodeResizer, NodeToolbar, Position } from "@xyflow/react";
import { toast } from "sonner";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import type { GroupNodeData } from "../../../../../shared/types";
import { getNodeImageOutput } from "../../../lib/canvasPassthrough";
import { downloadMedia } from "../../../lib/download";
import { FolderOpen, FolderClosed, Maximize2, Play, Ungroup, Download, Package, Clapperboard } from "lucide-react";

// 组内批量下载：与多选操作条同规则的媒体提取（视频优先 resultVideoUrl/videoUrl，其次 outputUrl，
// 再退到图片输出）。放模块级，避免每次渲染重建。
const GROUP_VIDEO_OUT_TYPES = new Set(["clip", "merge", "subtitle", "subtitle_motion", "smart_cut", "overlay", "video_task", "comfyui_video", "comfyui_workflow", "lip_sync", "avatar"]);
const isGroupVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u);
function groupNodeMedia(nodeType: string, payload: Record<string, unknown>): { url: string; type: "image" | "video" } | null {
  const v = (payload.resultVideoUrl ?? payload.videoUrl) as unknown;
  if (typeof v === "string" && v) return { url: v, type: "video" };
  const out = payload.outputUrl as unknown;
  if (typeof out === "string" && out) return { url: out, type: isGroupVideoUrl(out) || GROUP_VIDEO_OUT_TYPES.has(nodeType) ? "video" : "image" };
  const img = getNodeImageOutput(nodeType, payload as never);
  return img ? { url: img, type: "image" } : null;
}

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
  const { updateNodeData, updateNodeTitle, fitGroupToMembers, toggleGroupCollapsed, ungroup, requestRun } = useCanvasStore(useShallow((s) => ({ updateNodeData: s.updateNodeData, updateNodeTitle: s.updateNodeTitle, fitGroupToMembers: s.fitGroupToMembers, toggleGroupCollapsed: s.toggleGroupCollapsed, ungroup: s.ungroup, requestRun: s.requestRun })));
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

  // 组内批量下载：把组内每个有结果的节点各下载一份（图片/视频）。
  const downloadGroup = () => {
    const st = useCanvasStore.getState();
    const ids = new Set(payload.childIds ?? []);
    let k = 0;
    for (const n of st.nodes) {
      if (!ids.has(n.id)) continue;
      const m = groupNodeMedia(n.data.nodeType, n.data.payload as Record<string, unknown>);
      if (!m) continue;
      const ext = m.type === "video" ? "mp4" : "png";
      void downloadMedia(m.url, `${n.data.title || n.data.nodeType}.${ext}`, m.type);
      k++;
    }
    toast[k > 0 ? "success" : "info"](k > 0 ? `开始下载组内 ${k} 个结果` : "组内暂无可下载的结果");
  };

  return (
    <>
      {/* 群组浮动操作条（LibTV 图二）——开放到所有模式（原仅 studio）：整组执行 / 添加到工具箱 /
          转分镜组（占位）/ 解组 / 批量下载。全部复用既有 store action，选中群组时浮现于上方。 */}
      {selected && (
        <NodeToolbar nodeId={id} isVisible position={Position.Top} offset={10}>
          <div className="nodrag flex items-center gap-1" style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", borderRadius: 11, padding: "5px 7px", boxShadow: "var(--c-node-shadow-hover)" }}>
            {memberCount > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); requestRun(null, payload.childIds ?? []); }}
                title="整组执行（运行组内全部节点）"
                className="studio-toolbtn flex items-center gap-1.5 px-2.5 h-7 rounded-lg"
                style={{ background: `${color.accent}22`, color: color.accent, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
              >
                <Play size={12} /> 整组执行
              </button>
            )}
            <button
              disabled
              title="添加到工具箱（把该组存为可复用工作流 · 即将上线）"
              className="studio-toolbtn flex items-center gap-1.5 px-2.5 h-7 rounded-lg"
              style={{ background: "var(--c-surface)", color: "var(--c-t4)", border: "none", cursor: "not-allowed", fontSize: 12, fontWeight: 600, opacity: 0.55 }}
            >
              <Package size={12} /> 添加到工具箱
            </button>
            <button
              disabled
              title="转分镜组（即将上线）"
              className="studio-toolbtn flex items-center gap-1.5 px-2.5 h-7 rounded-lg"
              style={{ background: "var(--c-surface)", color: "var(--c-t4)", border: "none", cursor: "not-allowed", fontSize: 12, fontWeight: 600, opacity: 0.55 }}
            >
              <Clapperboard size={12} /> 转分镜组
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); ungroup(id); }}
              title="解组（保留组内节点，移除分组框）"
              className="studio-toolbtn flex items-center gap-1.5 px-2.5 h-7 rounded-lg"
              style={{ background: "var(--c-surface)", color: "var(--c-t2)", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            >
              <Ungroup size={12} /> 解组
            </button>
            {memberCount > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); downloadGroup(); }}
                title="批量下载（组内所有已完成结果）"
                className="studio-toolbtn flex items-center gap-1.5 px-2.5 h-7 rounded-lg"
                style={{ background: "var(--c-surface)", color: "var(--c-t2)", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
              >
                <Download size={12} /> 批量下载
              </button>
            )}
          </div>
        </NodeToolbar>
      )}
      {/* 折叠成小条时禁用缩放（避免与小条高度冲突） */}
      <NodeResizer
        isVisible={selected && !collapsed}
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
            onClick={() => toggleGroupCollapsed(id)}
            title={collapsed ? "展开群组" : "折叠成小条"}
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

          {/* Fit-to-members: 重新包裹当前成员 */}
          {memberCount > 0 && (
            <button
              onClick={() => fitGroupToMembers(id)}
              title="适应成员（重新包裹）"
              style={{ color: color.accent, background: "none", border: "none", cursor: "pointer", lineHeight: 0, padding: 0, opacity: 0.8 }}
            >
              <Maximize2 style={{ width: 13, height: 13 }} />
            </button>
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

        {/* Body — 仅展开时显示；折叠后容器缩成标题小条，无正文 */}
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
