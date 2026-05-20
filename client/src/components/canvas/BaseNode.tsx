import { memo, useState, useRef, useCallback } from "react";
import { Handle, Position, NodeResizer } from "@xyflow/react";
import { getNodeConfig } from "../../lib/nodeConfig";
import type { NodeType } from "../../../../shared/types";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import {
  FileText, Image, Wand2, Paperclip, Video, Bot, StickyNote,
  Trash2, Copy, GripVertical, Check, X,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  FileText, Image, Wand2, Paperclip, Video, Bot, StickyNote,
};

interface BaseNodeProps {
  id: string;
  selected?: boolean;
  nodeType: NodeType;
  title: string;
  children: React.ReactNode;
  minWidth?: number;
  minHeight?: number;
  showHandles?: boolean;
  headerRight?: React.ReactNode;
}

const HANDLE_STYLE: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: "50%",
  border: "2px solid oklch(0.20 0.008 260)",
  background: "oklch(0.14 0.007 260)",
  transition: "border-color 120ms ease, background 120ms ease, box-shadow 120ms ease",
};

export const BaseNode = memo(function BaseNode({
  id, selected, nodeType, title, children,
  minWidth = 240, minHeight = 120, showHandles = true, headerRight,
}: BaseNodeProps) {
  const config = getNodeConfig(nodeType);
  const Icon = ICONS[config.icon] ?? FileText;
  const { deleteNode, duplicateNode, updateNodeTitle } = useCanvasStore();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const handleTitleSave = useCallback(() => {
    updateNodeTitle(id, titleValue || title);
    setEditingTitle(false);
  }, [id, titleValue, title, updateNodeTitle]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleTitleSave();
    if (e.key === "Escape") { setTitleValue(title); setEditingTitle(false); }
  }, [handleTitleSave, title]);

  const handleStyle: React.CSSProperties = {
    ...HANDLE_STYLE,
    ...(selected ? { borderColor: `${config.color}70`, boxShadow: `0 0 6px ${config.color}50` } : {}),
  };

  return (
    <div
      className="group/node relative flex flex-col overflow-visible"
      style={{
        borderRadius: 14,
        background: "oklch(0.115 0.007 260)",
        border: selected
          ? `1.5px solid ${config.color}90`
          : `1px solid oklch(0.195 0.008 260)`,
        boxShadow: selected
          ? `0 0 0 3px ${config.color}18, 0 12px 48px oklch(0 0 0 / 0.65), 0 4px 12px oklch(0 0 0 / 0.45)`
          : "0 4px 20px oklch(0 0 0 / 0.50), 0 1px 4px oklch(0 0 0 / 0.35)",
        minWidth,
        minHeight,
        width: "100%",
        height: "100%",
        transition: "border-color 150ms ease, box-shadow 150ms ease",
        backdropFilter: "blur(2px)",
      }}
    >
      {/* Resize handles */}
      <NodeResizer
        minWidth={minWidth}
        minHeight={minHeight}
        isVisible={selected}
        lineStyle={{ borderColor: `${config.color}50`, borderWidth: 1 }}
        handleStyle={{
          width: 8, height: 8, borderRadius: 3,
          background: config.color, border: "none",
          boxShadow: `0 0 8px ${config.color}90`,
        }}
      />

      {/* ── Top accent line ── */}
      <div
        className="absolute top-0 left-4 right-4 h-px rounded-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${config.color}60, transparent)`,
          opacity: selected ? 1 : 0.4,
          transition: "opacity 150ms ease",
        }}
      />

      {/* ── Header ── */}
      <div
        className="flex items-center gap-2 px-2.5 py-2 select-none flex-shrink-0 rounded-t-[13px]"
        style={{
          background: `linear-gradient(180deg, ${config.color}12 0%, ${config.color}06 100%)`,
          borderBottom: `1px solid ${config.color}20`,
        }}
      >
        {/* Drag handle */}
        <GripVertical
          className="w-3 h-3 flex-shrink-0 cursor-grab active:cursor-grabbing"
          style={{ color: "oklch(0.32 0.008 260)" }}
        />

        {/* Icon */}
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
          style={{
            background: `${config.color}20`,
            border: `1px solid ${config.color}38`,
          }}
        >
          <Icon className="w-3 h-3" style={{ color: config.color }} />
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-1">
              <input
                ref={titleInputRef}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={handleTitleSave}
                className="flex-1 min-w-0 text-xs font-medium outline-none border-b"
                style={{
                  background: "transparent",
                  color: "oklch(0.92 0.005 260)",
                  borderColor: config.color,
                }}
                autoFocus
              />
              <button onClick={handleTitleSave} className="p-0.5 rounded" style={{ color: "oklch(0.72 0.18 155)" }}>
                <Check className="w-3 h-3" />
              </button>
              <button onClick={() => { setTitleValue(title); setEditingTitle(false); }} className="p-0.5 rounded" style={{ color: "oklch(0.50 0.008 260)" }}>
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <span
              className="text-xs font-medium truncate block cursor-text"
              style={{ color: "oklch(0.84 0.006 260)" }}
              onDoubleClick={() => { setEditingTitle(true); setTitleValue(title); }}
              title={title}
            >
              {title}
            </span>
          )}
        </div>

        {headerRight && <div className="flex-shrink-0">{headerRight}</div>}

        {/* Type badge */}
        <span
          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 leading-none tracking-wide"
          style={{
            background: `${config.color}18`,
            color: config.color,
            border: `1px solid ${config.color}30`,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {config.label}
        </span>

        {/* Actions — visible on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover/node:opacity-100 transition-opacity duration-150">
          <button
            onClick={() => duplicateNode(id)}
            className="w-5 h-5 rounded flex items-center justify-center transition-all"
            style={{ color: "oklch(0.42 0.008 260)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.20 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.75 0.006 260)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.42 0.008 260)"; }}
            title="复制节点"
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            onClick={() => deleteNode(id)}
            className="w-5 h-5 rounded flex items-center justify-center transition-all"
            style={{ color: "oklch(0.42 0.008 260)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.60 0.22 25 / 0.15)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.65 0.22 25)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.42 0.008 260)"; }}
            title="删除节点"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto min-h-0">{children}</div>

      {/* ── Handles ── */}
      {showHandles && (
        <>
          <Handle type="target"  position={Position.Left}   id="input"  style={{ ...handleStyle, top: "50%", left: -5 }} />
          <Handle type="source"  position={Position.Right}  id="output" style={{ ...handleStyle, top: "50%", right: -5 }} />
          <Handle type="target"  position={Position.Top}    id="top"    style={{ ...handleStyle, left: "50%", top: -5 }} />
          <Handle type="source"  position={Position.Bottom} id="bottom" style={{ ...handleStyle, left: "50%", bottom: -5 }} />
        </>
      )}
    </div>
  );
});
