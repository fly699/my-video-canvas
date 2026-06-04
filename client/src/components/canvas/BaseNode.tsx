import { memo, useState, useRef, useCallback, useEffect } from "react";
import { Handle, Position, NodeResizer } from "@xyflow/react";
import { getNodeConfig } from "../../lib/nodeConfig";
import { CONNECTION_HINTS } from "../../lib/connectionRules";
import type { NodeType } from "../../../../shared/types";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { useHoverStore } from "../../hooks/useHoverStore";
import { NodeSelectedContext } from "../../contexts/NodeSelectedContext";
import { trpc } from "@/lib/trpc";
import { useWorkflowRunState } from "../../contexts/WorkflowRunContext";
import { useCanvasMode } from "../../contexts/CanvasModeContext";
import { useTheme } from "../../contexts/ThemeContext";
import {
  Trash2, Copy, GripVertical, Check, X, Loader2, FileText, AlertTriangle, Pin, Pencil, Share2, Play, RefreshCw,
} from "lucide-react";
import { NODE_ICONS } from "../../lib/nodeConfig";
import { toast } from "sonner";
import { hasPassableOutput, directPassDownstream } from "../../lib/canvasPassthrough";
import { handleStyle } from "../../lib/handleStyle";

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
  /** 标题栏常驻"运行/重新生成"按钮的处理器；提供则渲染按钮（覆盖所有主题/模式）。 */
  onRun?: () => void;
  /** 是否允许运行（默认 true）；false 时按钮禁用置灰。 */
  canRun?: boolean;
  /** 节点本地运行态（如生成中），优先于全局 runStatus。 */
  running?: boolean;
  /** 是否已有结果：true → 图标 RefreshCw + "重新生成"；false → Play + "运行"。 */
  hasResult?: boolean;
  /** 可选：自定义节点外框基础色（oklch 等）。设置后静止/选中态边框用此色着色，
   *  用于以颜色区分节点的运行模式（如 ComfyUI 本地 vs 云端）。不影响运行态边框。 */
  borderTint?: string;
  /** 可选：标题栏 hover 提示文本（覆盖默认的"双击编辑标题"）。
   *  用于在标题上展示节点的附加信息（如 ComfyUI 工作流模型详情）。 */
  headerTooltip?: string;
  /** 可选：隐藏右上角的节点类型徽章（如「COMFYUI 视频」）。 */
  hideTypeBadge?: boolean;
}

export const BaseNode = memo(function BaseNode({
  id, selected, nodeType, title, children,
  minWidth = 280, minHeight = 140, showHandles = true, headerRight, resizable = false,
  onRun, canRun = true, running: nodeRunning = false, hasResult = false,
  heroMedia, borderTint, headerTooltip, hideTypeBadge,
}: BaseNodeProps) {
  const config = getNodeConfig(nodeType);
  const Icon = NODE_ICONS[config.icon] ?? FileText;
  const { deleteNode, duplicateNode, updateNodeTitle, projectId } = useCanvasStore();
  // Detect ambiguous dual-target connection: when both `input` (left) and `top` handles
  // receive edges, the workflow runner only uses one — warn the user.
  const dualTargetConflict = useCanvasStore((s) => {
    if (!showHandles) return false;
    let hasInput = false, hasTop = false;
    for (const e of s.edges) {
      if (e.target !== id) continue;
      if (e.targetHandle === "input") hasInput = true;
      else if (e.targetHandle === "top") hasTop = true;
      if (hasInput && hasTop) return true;
    }
    return false;
  });

  // "直传" availability: this node has an output AND at least one outgoing edge,
  // so its current result can be pushed to downstream inputs without a run.
  const canDirectPass = useCanvasStore((s) => {
    const node = s.nodes.find((n) => n.id === id);
    if (!node || !hasPassableOutput(node.data.nodeType, (node.data.payload ?? {}) as Record<string, unknown>)) return false;
    return s.edges.some((e) => e.source === id);
  });
  const handleDirectPass = useCallback(() => {
    const { updated, skipped } = directPassDownstream(id);
    if (updated > 0) toast.success(`已直传到 ${updated} 个下游节点`);
    else if (skipped > 0) toast.info("下游节点不接受此输出类型");
    else toast.info("没有已连接的下游节点");
  }, [id]);

  // Pinned state — when true, child collapsible regions stay expanded
  // regardless of `selected`. Toggled via the right-click context menu.
  // Generation status/progress read straight from the payload, so a persistent
  // progress bar can render even when the node's config is collapsed (the per-node
  // progress bars live inside the collapsing body and vanish when deselected).
  const genStatus = useCanvasStore((s) => (s.nodes.find((n) => n.id === id)?.data.payload as { status?: string } | undefined)?.status);
  const genProgress = useCanvasStore((s) => {
    const p = (s.nodes.find((n) => n.id === id)?.data.payload as { progress?: number } | undefined)?.progress;
    return typeof p === "number" ? p : null;
  });
  const genError = useCanvasStore((s) => {
    const pl = s.nodes.find((n) => n.id === id)?.data.payload as { status?: string; errorMessage?: string } | undefined;
    return pl?.status === "failed" ? (pl.errorMessage || "生成失败") : null;
  });
  const pinned = useCanvasStore((s) => {
    const node = s.nodes.find((n) => n.id === id);
    return Boolean((node?.data.payload as Record<string, unknown> | undefined)?.pinned);
  });
  const deleteNodeMutation = trpc.nodes.delete.useMutation();
  const { mode: canvasMode } = useCanvasMode();
  const { theme } = useTheme();
  const isCreative = canvasMode === "creative";
  const isLight = theme === "light" || theme === "warm" || theme === "mint" || theme === "lavender" || theme === "paper" || isCreative;
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

  // Sync title when prop changes (guard: don't overwrite in-progress edits)
  useEffect(() => { if (!editingTitle) setTitleValue(title); }, [title, editingTitle]);

  // Entry animation
  const [entered, setEntered] = useState(false);
  useEffect(() => { const t = setTimeout(() => setEntered(true), 20); return () => clearTimeout(t); }, []);

  const showActions = isHovered || selected;

  // Connection handles — shared subtle-at-rest / filled-on-hover styling (see
  // lib/handleStyle). Target = square (receives), source = circle (sends).
  const handleActive = isHovered || !!selected;
  const targetHandle = handleStyle(config.color, handleActive, "square");
  const sourceHandle = handleStyle(config.color, handleActive, "circle");

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
    : borderTint
      ? selected
        ? `1.5px solid ${borderTint}`
        : `1px solid ${borderTint}99`
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
        height: "100%",
        transition: "border-color 150ms ease, box-shadow 180ms ease, opacity 180ms ease, transform 180ms ease",
        backdropFilter: isLight ? "none" : "blur(4px)",
        opacity: entered ? 1 : 0,
        transform: entered ? "scale(1) translateY(0)" : "scale(0.96) translateY(6px)",
        // overflow is intentionally NOT set here so handle ::before hit-area expansions
        // can extend beyond the node edge without being clipped
      }}
      onMouseEnter={() => { setIsHovered(true); useHoverStore.getState().setHovered(id); }}
      onMouseLeave={() => { setIsHovered(false); if (useHoverStore.getState().nodeId === id) useHoverStore.getState().setHovered(null); }}
    >
      {/* Resize handles — outside overflow:hidden so corner grips aren't clipped */}
      <NodeResizer
        minWidth={minWidth}
        minHeight={minHeight}
        isVisible={resizable && (selected || isHovered)}
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
    <div className="flex flex-col" style={{ overflow: "hidden", borderRadius: "inherit", width: "100%", height: "100%" }}>

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
          borderBottom: `1px solid ${(isCreative || isLight) ? "var(--c-bd1)" : "oklch(0.20 0.008 260 / 0.60)"}`,
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
            // Show a faint pencil icon on hover so users discover the title
            // (including the auto-generated "#N" suffix) is editable. Both
            // single-click on the pencil and double-click on the text enter
            // edit mode — single-click on the text alone still propagates to
            // React Flow's node-select behavior (preserved on purpose).
            <div className="flex items-center gap-1 min-w-0 flex-1 group/title">
              <span
                className="text-xs font-semibold truncate"
                style={{
                  color: "var(--c-t1)",
                  cursor: "text",
                  letterSpacing: "-0.01em",
                  transition: "color 150ms ease",
                }}
                onDoubleClick={() => { setEditingTitle(true); setTitleValue(title); }}
                title={headerTooltip ? `${headerTooltip}\n\n双击编辑标题: ${title}` : `双击编辑标题: ${title}`}
              >
                {title}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setEditingTitle(true); setTitleValue(title); }}
                title="编辑标题（含编号）"
                className="opacity-0 group-hover/title:opacity-100 transition-opacity flex-shrink-0"
                style={{
                  width: 18, height: 18, padding: 0,
                  border: "none", background: "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: 4,
                  color: "var(--c-t4)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
                  (e.currentTarget as HTMLElement).style.color = "var(--c-t2)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "var(--c-t4)";
                }}
              >
                <Pencil style={{ width: 10, height: 10 }} />
              </button>
            </div>
          )}
        </div>

        {dualTargetConflict && (
          <div
            title="左侧和顶部输入都已连接 — 运行时只会使用第一个匹配的输入，另一个会被忽略。请只保留一条输入连线。"
            style={{
              width: 20, height: 20, borderRadius: 5,
              background: "oklch(0.70 0.16 65 / 0.18)",
              border: "1px solid oklch(0.70 0.16 65 / 0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "help", flexShrink: 0,
            }}
          >
            <AlertTriangle size={12} style={{ color: "oklch(0.78 0.16 65)" }} />
          </div>
        )}

        {/* Pinned indicator — small pin icon shown when the user explicitly
            kept this node's input panel expanded via the right-click menu. */}
        {pinned && (
          <span
            title="已固定（右键菜单可取消）"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 18, height: 18, borderRadius: 4,
              background: "oklch(0.68 0.22 285 / 0.15)",
              color: "oklch(0.78 0.16 285)",
              border: "1px solid oklch(0.68 0.22 285 / 0.35)",
              flexShrink: 0,
            }}
          >
            <Pin size={10} />
          </span>
        )}

        {/* 直传 — push current output to downstream inputs without running */}
        {canDirectPass && (
          <button
            onClick={(e) => { e.stopPropagation(); handleDirectPass(); }}
            title="直传：把当前输出直接传给已连接的下游节点（无需运行）"
            className="nodrag flex-shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded"
            style={{
              background: "oklch(0.65 0.18 200 / 0.15)",
              color: "oklch(0.72 0.16 200)",
              border: "1px solid oklch(0.65 0.18 200 / 0.35)",
              cursor: "pointer",
            }}
          >
            <Share2 size={10} />
          </button>
        )}

        {/* 标题栏常驻"运行/重新生成"按钮 — 折叠时也能一键运行，覆盖所有主题/模式 */}
        {onRun && (
          <button
            onClick={(e) => { e.stopPropagation(); if (canRun && !nodeRunning) onRun(); }}
            disabled={!canRun || nodeRunning}
            title={nodeRunning ? "生成中…" : (hasResult ? "重新生成" : "运行")}
            className="nodrag flex-shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded"
            style={{
              background: !canRun || nodeRunning ? "var(--c-surface)" : `${config.color}22`,
              color: !canRun || nodeRunning ? "var(--c-t4)" : config.color,
              border: `1px solid ${!canRun || nodeRunning ? "var(--c-bd2)" : `${config.color}55`}`,
              cursor: !canRun || nodeRunning ? "not-allowed" : "pointer",
            }}
          >
            {nodeRunning ? <Loader2 size={10} className="animate-spin" /> : (hasResult ? <RefreshCw size={10} /> : <Play size={10} />)}
          </button>
        )}

        {headerRight && <div className="flex-shrink-0">{headerRight}</div>}

        {/* Type badge */}
        {!hideTypeBadge && (
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
        )}

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

      {/* ── Persistent generation progress ──
          Rendered right under the header (outside the collapsing body) so the
          bar stays visible even when the node is collapsed/deselected. Driven by
          the payload's status/progress, so it works for every node uniformly. */}
      {(genStatus === "processing" || nodeRunning) && (
        <div
          title={genProgress != null ? `生成中 ${Math.round(genProgress)}%` : "生成中…"}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", flexShrink: 0, background: "var(--c-node-bg)", borderBottom: "1px solid var(--c-bd1)" }}
        >
          <div style={{ flex: 1, height: 4, background: "var(--c-bd1)", borderRadius: 2, overflow: "hidden" }}>
            <div
              className={genProgress == null ? "animate-pulse" : undefined}
              style={{
                height: "100%",
                width: genProgress != null ? `${Math.max(3, Math.min(100, genProgress))}%` : "100%",
                background: config.color,
                opacity: genProgress == null ? 0.55 : 1,
                boxShadow: `0 0 6px ${config.color}88`,
                transition: "width 280ms ease",
                borderRadius: 2,
              }}
            />
          </div>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: config.color, whiteSpace: "nowrap" }}>
            {genProgress != null ? `${Math.round(genProgress)}%` : "生成中"}
          </span>
        </div>
      )}

      {/* ── Persistent failure indicator ──
          Like the progress bar, rendered outside the collapsing body so a failed
          generation is visible even when the node is collapsed (the detailed error
          lives inside the body). */}
      {genStatus !== "processing" && !nodeRunning && genError && (
        <div
          title={genError}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", flexShrink: 0, background: "oklch(0.62 0.20 25 / 0.12)", borderBottom: "1px solid var(--c-bd1)" }}
        >
          <AlertTriangle size={11} style={{ color: "oklch(0.62 0.20 25)", flexShrink: 0 }} />
          <span style={{ fontSize: 9.5, fontWeight: 600, color: "oklch(0.62 0.20 25)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {genError}
          </span>
        </div>
      )}

      {/* ── Hero media (creative mode only, shown via CSS) ── */}
      {hasHero && (
        <div className="node-hero-media">
          {heroMedia}
        </div>
      )}

      {/* ── Content area (collapsible in creative mode when hero exists) ── */}
      <NodeSelectedContext.Provider value={!!selected || pinned}>
        <div className="node-body-wrap">
          <div className="overflow-visible nopan" style={{ flex: 1, minHeight: 0 }}>{children}</div>
        </div>
      </NodeSelectedContext.Provider>

      </div>{/* end inner overflow:hidden content wrapper */}

      {/* ── Connection Handles — outside overflow:hidden so ::before hit-area works ── */}
      {showHandles && (() => {
        const hint = CONNECTION_HINTS[nodeType];
        const inTitle = hint ? `${hint.label} 输入  ${hint.incoming}` : "输入";
        const outTitle = hint ? `${hint.label} 输出  ${hint.outgoing}` : "输出";
        return (
          <>
            <Handle type="target" position={Position.Left}   id="input"  style={{ ...targetHandle, top: "50%", left: -7 }} title={inTitle} />
            <Handle type="source" position={Position.Right}  id="output" style={{ ...sourceHandle, top: "50%", right: -7 }} title={outTitle} />
            {/* Top/Bottom handles offset off-center (32% / 68%) so the input dot and
                output dot never sit stacked at the horizontal center on a short or
                collapsed node — keeps in/out visually distinct. */}
            <Handle type="target" position={Position.Top}    id="top"    style={{ ...targetHandle, left: "32%", top: -7 }} title={inTitle} />
            <Handle type="source" position={Position.Bottom} id="bottom" style={{ ...sourceHandle, left: "68%", bottom: -7 }} title={outTitle} />
          </>
        );
      })()}
    </div>
  );
});
