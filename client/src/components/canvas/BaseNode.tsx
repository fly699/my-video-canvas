import { memo, useState, useRef, useCallback } from "react";
import { Handle, Position, NodeResizer } from "@xyflow/react";
import { getNodeConfig } from "../../lib/nodeConfig";
import type { NodeType } from "../../../../shared/types";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import {
  FileText,
  Image,
  Wand2,
  Paperclip,
  Video,
  Bot,
  StickyNote,
  Trash2,
  Copy,
  GripVertical,
  Pencil,
  Check,
  X,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  FileText,
  Image,
  Wand2,
  Paperclip,
  Video,
  Bot,
  StickyNote,
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
}

export const BaseNode = memo(function BaseNode({
  id,
  selected,
  nodeType,
  title,
  children,
  minWidth = 240,
  minHeight = 120,
  showHandles = true,
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

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleTitleSave();
      if (e.key === "Escape") {
        setTitleValue(title);
        setEditingTitle(false);
      }
    },
    [handleTitleSave, title]
  );

  return (
    <div
      className="group relative flex flex-col rounded-xl overflow-hidden transition-all duration-150"
      style={{
        background: `oklch(0.15 0.015 260)`,
        border: `1px solid ${selected ? config.color : config.borderColor}`,
        boxShadow: selected
          ? `0 0 0 2px ${config.color}, 0 8px 32px oklch(0 0 0 / 0.5), 0 0 24px ${config.color}33`
          : "0 4px 24px oklch(0 0 0 / 0.4), 0 1px 4px oklch(0 0 0 / 0.3)",
        minWidth,
        minHeight,
        width: "100%",
        height: "100%",
      }}
    >
      <NodeResizer
        minWidth={minWidth}
        minHeight={minHeight}
        isVisible={selected}
        lineStyle={{ borderColor: config.color, opacity: 0.6 }}
        handleStyle={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: config.color,
          border: "none",
        }}
      />

      {/* ── Header ── */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b select-none"
        style={{
          background: config.bgColor,
          borderColor: config.borderColor,
        }}
      >
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 cursor-grab active:cursor-grabbing flex-shrink-0" />
        <div
          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
          style={{ background: `${config.color}22` }}
        >
          <Icon className="w-3 h-3" style={{ color: config.color } as React.CSSProperties} />
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
                className="flex-1 min-w-0 bg-transparent text-xs font-medium text-foreground outline-none border-b border-primary"
                autoFocus
              />
              <button onClick={handleTitleSave} className="p-0.5 hover:text-primary">
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  setTitleValue(title);
                  setEditingTitle(false);
                }}
                className="p-0.5 hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <span
              className="text-xs font-medium text-foreground/90 truncate block cursor-text"
              onDoubleClick={() => {
                setEditingTitle(true);
                setTitleValue(title);
              }}
              title={title}
            >
              {title}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => duplicateNode(id)}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
            title="复制节点"
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            onClick={() => deleteNode(id)}
            className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
            title="删除节点"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        {/* Type badge */}
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0"
          style={{ background: `${config.color}22`, color: config.color }}
        >
          {config.label}
        </span>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto p-0">{children}</div>

      {/* ── Handles ── */}
      {showHandles && (
        <>
          <Handle
            type="target"
            position={Position.Left}
            id="input"
            style={{ top: "50%", left: -5 }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="output"
            style={{ top: "50%", right: -5 }}
          />
          <Handle
            type="target"
            position={Position.Top}
            id="top"
            style={{ left: "50%", top: -5 }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="bottom"
            style={{ left: "50%", bottom: -5 }}
          />
        </>
      )}
    </div>
  );
});
