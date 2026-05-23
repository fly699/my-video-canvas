import { memo, useState, useRef, useCallback, useEffect } from "react";
import { Handle, Position, NodeResizer } from "@xyflow/react";
import { getNodeConfig } from "../../lib/nodeConfig";
import type { NodeType } from "../../../../shared/types";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { NodeSelectedContext } from "../../contexts/NodeSelectedContext";
import { trpc } from "@/lib/trpc";
import { useWorkflowRunState } from "../../contexts/WorkflowRunContext";
import { useCanvasMode } from "../../contexts/CanvasModeContext";
import { useTheme } from "../../contexts/ThemeContext";
import {
  Trash2, Copy, GripVertical, Check, X, Loader2, FileText,
} from "lucide-react";
import { NODE_ICONS } from "../../lib/nodeConfig";

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
  /** 是否允许用户手动拖拽缩放，默认 false */
  resizable?: boolean;
  /** 创意模式下显示在标题栏下方的媒体英雄区（图片/视频预览），选中时展开表单控件 */
  heroMedia?: React.ReactNode;
}

export const BaseNode = memo(function BaseNode({
  id, selected, nodeType, title, children,
  minWidth = 280, minHeight = 140, showHandles = true, headerRight, resizable = false,
  heroMedia,
}: BaseNodeProps) {
  const config = getNodeConfig(nodeType);
  const Icon = NODE_ICONS[config.icon] ?? FileText;
  const { deleteNode, duplicateNode, updateNodeTitle, projectId } = useCanvasStore();
  const deleteNodeMutation = trpc.nodes.delete.useMutation();
  const { mode: canvasMode } = useCanvasMode();
  const { theme } = useTheme();
  const isCreative = canvasMode === "creative";
  const isLight = theme === "light" || isCreative;
  const hasHero = heroMedia != null;

  // Workflow run status
  const { running, currentNodeId, completedIds, failedIds } = useWorkflowRunState();
  const runStatus: "running" | "done" | "failed" | null = (() => {
    if (running && currentNodeId === id) return "running";
    if (completedIds.includes(id)) return "done";
    if (failedIds.includes(id)) return "failed";
    return null;
  })();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(title);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleCancelingRef = useRef(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleTitleSave = useCallback(() => {
    if (titleCancelingRef.current) { titleCancelingRef.current = false; return; }
    updateNodeTitle(id, titleValue || title);
    setEditingTitle(false);
  }, [id, titleValue, title, updateNodeTitle]);

  const cancelTitleEdit = useCallback(() => {
    titleCancelingRef.current = true;
    setTitleValue(title);
    setEditingTitle(false);
  }, [title]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleTitleSave();
    if (e.key === "Escape") cancelTitleEdit();
  }, [handleTitleSave, cancelTitleEdit]);

  // Sync title when prop changes
  useEffect(() => { setTitleValue(title); }, [title]);

  // Entry animation
  const [entered, setEntered] = useState(false);
  useEffect(() => { const t = setTimeout(() => setEntered(true), 20); return () => clearTimeout(t); }, []);

  const showActions = isHovered || selected;

  // Shared base styles for all handles
  const handleShared: React.CSSProperties = {
    width: 14,
    height: 14,
    border: `2px solid var(--c-canvas)`,
    transition: "opacity 150ms ease, transform 150ms ease, box-shadow 150ms ease",
    zIndex: 10,
  };

  // Target (input) handle: SQUARE with slight rounding — receives data
  const targetHandle: React.CSSProperties = {
    ...handleShared,
    borderRadius: 3,                                       // square = input
    background: `${config.color}90`,                       // slightly transparent
    opacity: isHovered || selected ? 1 : 0.40,
    transform: isHovered || selected ? "scale(1.1)" : "scale(0.85)",
    boxShadow: isHovered || selected ? `0 0 0 3px ${config.color}22` : "none",
  };

  // Source (output) handle: CIRCLE — sends data
  const sourceHandle: React.CSSProperties = {
    ...handleShared,
    borderRadius: "50%",                                   // circle = output
    background: config.color,                              // fully colored
    opacity: isHovered || selected ? 1 : 0.45,
    transform: isHovered || selected ? "scale(1.1)" : "scale(0.85)",
    boxShadow: isHovered || selected ? `0 0 0 4px ${config.color}30` : "none",
  };

  // Derive border & shadow from runStatus
  const runBorder = runStatus === "running"
    ? `1.5px solid oklch(0.72 0.22 142 / 0.9)`
    : runStatus === "done"
      ? `1.5px solid oklch(0.72 0.18 155 / 0.8)`
      : runStatus === "failed"
        ? `1.5px solid oklch(0.62 0.22 25 / 0.8)`
        : null;

  const runShadow = runStatus === "running"
    ? `0 0 0 3px oklch(0.72 0.22 142 / 0.22), 0 0 20px oklch(0.72 0.22 142 / 0.20)`
    : runStatus === "done"
      ? `0 0 0 3px oklch(0.72 0.18 155 / 0.18)`
      : runStatus === "failed"
        ? `0 0 0 3px oklch(0.62 0.22 25 / 0.18)`
        : null;

  const borderStyle = runBorder
    ? runBorder
    : isCreative
      ? selected
        ? `1.5px solid ${config.color}70`
        : `1px solid var(--c-bd2)`
      : selected
        ? `1.5px solid ${config.color}80`
        : isHovered
          ? `1px solid var(--c-bd3)`
          : `1px solid var(--c-bd1)`;

  const shadowStyle = runShadow
    ? `${runShadow}, var(--c-node-shadow-run)`
    : selected
      ? `0 0 0 ${isLight ? "3px" : "4px"} ${config.color}${isLight ? "22" : "14"}, var(--c-node-shadow-selected)`
      : isHovered
        ? `var(--c-node-shadow-hover)`
        : `var(--c-node-shadow-rest)`;

  return (
    <div
      className={`group/node relative${runStatus === "running" ? " node-run-pulse" : ""}`}
      data-selected={selected ? "true" : "false"}
      data-has-hero={hasHero ? "true" : "false"}
      style={{
        borderRadius: 16,
        background: "var(--c-node-bg)",
        border: borderStyle,
        boxShadow: shadowStyle,
        minWidth: isCreative ? Math.round(minWidth * 1.25) : minWidth,
        minHeight,
        width: "100%",
        transition: "border-color 150ms ease, box-shadow 180ms ease, opacity 180ms ease, transform 180ms ease",
        backdropFilter: isLight ? "none" : "blur(4px)",
        opacity: entered ? 1 : 0,
        transform: entered ? "scale(1) translateY(0)" : "scale(0.96) translateY(6px)",
        // overflow is intentionally NOT set here so handle ::before hit-area expansions
        // can extend beyond the node edge without being clipped
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Resize handles — outside overflow:hidden so corner grips aren't clipped */}
      <NodeResizer
        minWidth={minWidth}
        minHeight={minHeight}
        isVisible={resizable && selected}
        lineStyle={{
          borderColor: `${config.color}40`,
          borderWidth: 1,
          borderStyle: "dashed",
        }}
        handleStyle={{
          width: 7,
          height: 7,
          borderRadius: 2,
          background: config.color,
          border: `1.5px solid var(--c-canvas)`,
          boxShadow: `0 0 6px ${config.color}80`,
          opacity: 1,
        }}
      />

    {/* Inner content wrapper clips visual content to the rounded corners */}
    <div className="flex flex-col" style={{ overflow: "hidden", borderRadius: "inherit", width: "100%" }}>

      {/* ── Color accent strip at top ── */}
      <div
        style={{
          height: isCreative ? 3 : 2,
          background: `linear-gradient(90deg, transparent 0%, ${config.color}${isCreative ? "90" : "70"} 30%, ${config.color}${isCreative ? "bb" : "90"} 50%, ${config.color}${isCreative ? "90" : "70"} 70%, transparent 100%)`,
          opacity: isCreative
            ? selected ? 1 : isHovered ? 0.85 : 0.55
            : selected ? 1 : isHovered ? 0.7 : 0.35,
          transition: "opacity 180ms ease",
          flexShrink: 0,
        }}
      />

      {/* ── Header ── */}
      <div
        className="flex items-center gap-2.5 px-3.5 py-2.5 select-none flex-shrink-0"
        style={{
          background: isCreative
            ? `${config.color}0a`
            : `linear-gradient(180deg, ${config.color}0e 0%, transparent 100%)`,
          borderBottom: `1px solid ${isCreative ? "var(--c-bd1)" : "oklch(0.20 0.008 260 / 0.60)"}`,
          minHeight: isCreative ? 40 : 44,
        }}
      >
        {/* Drag grip */}
        <GripVertical
          className="w-3.5 h-3.5 flex-shrink-0 cursor-grab active:cursor-grabbing"
          style={{
            color: isHovered ? "var(--c-t4)" : "var(--c-bd3)",
            transition: "color 150ms ease",
          }}
        />

        {/* Node type icon */}
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: `${config.color}1a`,
            border: `1px solid ${config.color}35`,
          }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={titleInputRef}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={handleTitleSave}
                className="flex-1 min-w-0 text-xs font-medium outline-none bg-transparent"
                style={{
                  color: "var(--c-t1)",
                  borderBottom: `1.5px solid ${config.color}`,
                  paddingBottom: 1,
                }}
                autoFocus
              />
              <button
                onClick={handleTitleSave}
                className="p-0.5 rounded-md transition-colors"
                style={{ color: "oklch(0.72 0.18 155)" }}
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); cancelTitleEdit(); }}
                className="p-0.5 rounded-md transition-colors"
                style={{ color: "var(--c-t4)" }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <span
              className="text-xs font-semibold truncate block"
              style={{
                color: "var(--c-t1)",
                cursor: "text",
                letterSpacing: "-0.01em",
                transition: "color 150ms ease",
              }}
              onDoubleClick={() => { setEditingTitle(true); setTitleValue(title); }}
              title={`双击编辑标题: ${title}`}
            >
              {title}
            </span>
          )}
        </div>

        {headerRight && <div className="flex-shrink-0">{headerRight}</div>}

        {/* Type badge */}
        <span
          className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 leading-none tracking-widest uppercase"
          style={{
            background: `${config.color}15`,
            color: `${config.color}`,
            border: `1px solid ${config.color}28`,
            opacity: 0.85,
          }}
        >
          {config.label}
        </span>

        {/* Run status badge */}
        {runStatus === "running" && (
          <div
            className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full"
            style={{ background: "oklch(0.72 0.22 142 / 0.18)", border: "1px solid oklch(0.72 0.22 142 / 0.55)" }}
            title="执行中"
          >
            <Loader2 className="w-3 h-3 animate-spin" style={{ color: "oklch(0.72 0.22 142)" }} />
          </div>
        )}
        {runStatus === "done" && (
          <div
            className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full"
            style={{ background: "oklch(0.72 0.18 155 / 0.18)", border: "1px solid oklch(0.72 0.18 155 / 0.55)" }}
            title="已完成"
          >
            <Check className="w-3 h-3" style={{ color: "oklch(0.72 0.18 155)" }} />
          </div>
        )}
        {runStatus === "failed" && (
          <div
            className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full"
            style={{ background: "oklch(0.62 0.22 25 / 0.18)", border: "1px solid oklch(0.62 0.22 25 / 0.55)" }}
            title="失败"
          >
            <X className="w-3 h-3" style={{ color: "oklch(0.62 0.22 25)" }} />
          </div>
        )}

        {/* Action buttons — fade in on hover/select */}
        <div
          className="flex items-center gap-0.5 flex-shrink-0"
          style={{
            opacity: showActions ? 1 : 0,
            transition: "opacity 150ms ease",
            pointerEvents: showActions ? "auto" : "none",
          }}
        >
          <button
            onClick={() => duplicateNode(id)}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
            style={{ color: "var(--c-t4)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--c-bd2)";
              (e.currentTarget as HTMLElement).style.color = "var(--c-t2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--c-t4)";
            }}
            title="复制节点 (Ctrl+D)"
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            onClick={() => { deleteNode(id); if (projectId) deleteNodeMutation.mutate({ id, projectId }); }}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
            style={{ color: "var(--c-t4)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "oklch(0.62 0.22 25 / 0.12)";
              (e.currentTarget as HTMLElement).style.color = "oklch(0.65 0.22 25)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--c-t4)";
            }}
            title="删除节点 (Delete)"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ── Hero media (creative mode only, shown via CSS) ── */}
      {hasHero && (
        <div className="node-hero-media">
          {heroMedia}
        </div>
      )}

      {/* ── Content area (collapsible in creative mode when hero exists) ── */}
      <NodeSelectedContext.Provider value={!!selected}>
        <div className="node-body-wrap">
          <div className="overflow-visible nopan">{children}</div>
        </div>
      </NodeSelectedContext.Provider>

      </div>{/* end inner overflow:hidden content wrapper */}

      {/* ── Connection Handles — outside overflow:hidden so ::before hit-area works ── */}
      {showHandles && (
        <>
          <Handle type="target" position={Position.Left}   id="input"  style={{ ...targetHandle, top: "50%", left: -7 }} />
          <Handle type="source" position={Position.Right}  id="output" style={{ ...sourceHandle, top: "50%", right: -7 }} />
          <Handle type="target" position={Position.Top}    id="top"    style={{ ...targetHandle, left: "50%", top: -7 }} />
          <Handle type="source" position={Position.Bottom} id="bottom" style={{ ...sourceHandle, left: "50%", bottom: -7 }} />
        </>
      )}
    </div>
  );
});
