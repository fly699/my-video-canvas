import { memo, useState, useRef, useCallback, useEffect } from "react";
import { Handle, Position, NodeResizer, NodeToolbar } from "@xyflow/react";
import { getNodeConfig, COLLABORATOR_COLORS } from "../../lib/nodeConfig";
import { CONNECTION_HINTS } from "../../lib/connectionRules";
import type { NodeType } from "../../../../shared/types";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { useComfyPreviewStore } from "../../hooks/useComfyPreviewStore";
import { useConnectState } from "../../hooks/useConnectingStore";
import { useHoverStore } from "../../hooks/useHoverStore";
import { NodeSelectedContext } from "../../contexts/NodeSelectedContext";
import { trpc } from "@/lib/trpc";
import { useWorkflowRunState } from "../../contexts/WorkflowRunContext";
import { useCanvasMode } from "../../contexts/CanvasModeContext";
import { useTheme } from "../../contexts/ThemeContext";
import { useUIStyle } from "../../contexts/UIStyleContext";
import {
  Trash2, Copy, GripVertical, Check, X, Loader2, FileText, AlertTriangle, Pin, Pencil, Share2, Play, RefreshCw, Layers,
} from "lucide-react";
import { NODE_ICONS } from "../../lib/nodeConfig";
import { VARIANT_TYPES } from "../../hooks/useCanvasStore";
import { toast } from "sonner";
import { hasPassableOutput, directPassDownstream } from "../../lib/canvasPassthrough";
import { handleStyle } from "../../lib/handleStyle";
import { agentBadge } from "../../lib/agentOwnership";

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
  /** 左侧吸附浮层（如参考图预览条带）。渲染在折叠 body 之外，故节点收缩后仍常驻可见。 */
  leftDock?: React.ReactNode;
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
  /** 可选：给整个节点高度封顶为 3×宽度，超出由节点内部滚动消化（如 Agent 长输出）。
   *  用户手动 resize（写入 style.height）后自动解除该上限。 */
  capNodeHeight?: boolean;
  /** 可选：从素材面板把图片直接拖到整个节点上时，接收这些图片 URL（按顺序）。提供后，
   *  拖放被节点消费（preventDefault），画布不再新建素材节点。供有参考图字段的节点接入。 */
  onAssetImageDrop?: (urls: string[]) => void;
  /** 可选：鼠标悬停标题栏满 1 秒触发（true）、离开时（false）。用于临时展开参考图/提示词吸附窗。 */
  onHeaderHoverChange?: (hovering: boolean) => void;
}

/** 从拖拽数据里提取图片素材的 URL（仅 image 类型）。 */
function imageUrlsFromAssetDrag(dt: DataTransfer): string[] {
  const raw = dt.getData("application/x-asset-list");
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as Array<{ url?: string; type?: string }>;
    return list.filter((a) => a.url && (!a.type || a.type === "image")).map((a) => a.url!);
  } catch { return []; }
}

export const BaseNode = memo(function BaseNode({
  id, selected, nodeType, title, children,
  minWidth = 280, minHeight = 140, showHandles = true, headerRight, resizable = false,
  onRun, canRun = true, running: nodeRunning = false, hasResult = false,
  heroMedia, leftDock, borderTint, headerTooltip, hideTypeBadge, capNodeHeight = false, onAssetImageDrop,
  onHeaderHoverChange,
}: BaseNodeProps) {
  const config = getNodeConfig(nodeType);
  const Icon = NODE_ICONS[config.icon] ?? FileText;
  const { deleteNode, duplicateNode, createVariants, updateNodeTitle, projectId } = useCanvasStore();
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
  // ComfyUI server queue depth while this node is waiting to start sampling.
  const genQueue = useCanvasStore((s) => {
    const q = (s.nodes.find((n) => n.id === id)?.data.payload as { queueRemaining?: number } | undefined)?.queueRemaining;
    return typeof q === "number" && q > 0 ? q : null;
  });
  const genError = useCanvasStore((s) => {
    const pl = s.nodes.find((n) => n.id === id)?.data.payload as { status?: string; errorMessage?: string } | undefined;
    return pl?.status === "failed" ? (pl.errorMessage || "生成失败") : null;
  });
  // Subtitle/burning nodes report busy via their own verbs ("transcribing"/
  // "burning"), not "processing" — recognize all of them so the persistent
  // progress bar stays visible when those nodes are collapsed too.
  const genBusy = genStatus === "processing" || genStatus === "transcribing" || genStatus === "burning";
  // Live ComfyUI sampling preview (transient; never persisted). Cleared as soon
  // as the run stops so a stale frame doesn't linger over the real result.
  const livePreview = useComfyPreviewStore((s) => s.previews[id]);
  useEffect(() => {
    if (!genBusy && livePreview) useComfyPreviewStore.getState().clearPreview(id);
  }, [genBusy, livePreview, id]);
  const pinned = useCanvasStore((s) => {
    const node = s.nodes.find((n) => n.id === id);
    return Boolean((node?.data.payload as Record<string, unknown> | undefined)?.pinned);
  });
  // 注意：多选时上游 CustomNode 已把 selected prop 压成 false（所有节点统一「框选不展开」），
  // 这里的 selected 即「单选展开」语义；选中描边用 store 真实选中态（storeSelected），
  // 框选高亮不丢。
  const storeSelected = useCanvasStore((s) => !!s.nodes.find((n) => n.id === id)?.selected);
  const expandSelected = !!selected || pinned;
  // Creator id (stamped into the payload at creation) → a per-collaborator color
  // dot in the title bar, matching the cursor / "在线协作者" colors. Only shown
  // for OTHER collaborators' nodes (your own stay undotted — no solo noise).
  const createdBy = useCanvasStore((s) => {
    const p = s.nodes.find((n) => n.id === id)?.data.payload as { createdBy?: number } | undefined;
    return typeof p?.createdBy === "number" ? p.createdBy : null;
  });
  const currentUserId = useCanvasStore((s) => s.currentUserId);
  const creatorName = useCanvasStore((s) => (createdBy != null ? s.collaborators.get(createdBy)?.userName : undefined));
  const isOtherCreator = createdBy != null && currentUserId != null && createdBy !== currentUserId;
  const creatorColor = isOtherCreator ? COLLABORATOR_COLORS[createdBy % COLLABORATOR_COLORS.length] : null;
  // Owner-agent badge (multi-agent canvases): "A{n}" pill in the agent's color when
  // this node was generated by an agent that still exists. Stable string → no churn.
  const ownerBadgeKey = useCanvasStore((s) => {
    const p = s.nodes.find((n) => n.id === id)?.data.payload as { ownerAgentId?: unknown } | undefined;
    const oid = typeof p?.ownerAgentId === "string" ? p.ownerAgentId : null;
    if (!oid || !s.nodes.some((n) => n.id === oid && n.data.nodeType === "agent")) return null;
    const b = agentBadge(oid, s.nodes);
    return `${b.color}|${b.index}`;
  });
  const ownerBadge = ownerBadgeKey ? { color: ownerBadgeKey.split("|")[0], index: Number(ownerBadgeKey.split("|")[1]) } : null;
  const deleteNodeMutation = trpc.nodes.delete.useMutation();
  const { mode: canvasMode } = useCanvasMode();
  const { theme } = useTheme();
  const { uiStyle } = useUIStyle();
  const isStudio = uiStyle === "studio";
  const isCreative = canvasMode === "creative";
  const isLight = theme === "light" || theme === "warm" || theme === "mint" || theme === "lavender" || theme === "paper" || isCreative;
  const hasHero = heroMedia != null;
  // A previewable node that has a result and is NOT being edited (not selected,
  // not pinned) renders collapsed: only the title bar + warning/error/progress +
  // the hero preview. In that state drop the min-height floor so the node shrinks
  // to fit the preview's natural aspect ratio instead of leaving empty space.
  const isCollapsedPreview = hasHero && !expandSelected;

  // Whole-node height cap (e.g. Agent's long output): clamp the node to 3× its
  // width and let the node's own internal scroll area absorb the overflow. A
  // manual resize (which writes style.height) lifts the cap so the user can
  // temporarily enlarge it.
  const nodeStyleWidth = useCanvasStore((s) => {
    const w = s.nodes.find((n) => n.id === id)?.style?.width;
    return typeof w === "number" ? w : null;
  });
  const nodeStyleHeight = useCanvasStore((s) => {
    const h = s.nodes.find((n) => n.id === id)?.style?.height;
    return typeof h === "number" ? h : null;
  });
  const manuallyResized = nodeStyleHeight != null && nodeStyleHeight > 0;
  const cappedMaxHeight = capNodeHeight && !manuallyResized
    ? Math.round((nodeStyleWidth ?? config.defaultWidth) * 3)
    : undefined;

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
  // 标题栏操作按钮（编辑名称/复制/删除）：单击节点后显示，3 秒后自动隐藏。
  const [clickShowActions, setClickShowActions] = useState(false);
  const hideActionsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armHideActions = () => {
    if (hideActionsTimer.current) clearTimeout(hideActionsTimer.current);
    hideActionsTimer.current = setTimeout(() => setClickShowActions(false), 3000);
  };
  const revealActions = () => { setClickShowActions(true); armHideActions(); };
  useEffect(() => () => { if (hideActionsTimer.current) clearTimeout(hideActionsTimer.current); }, []);

  // 标题栏悬停进/出 → 透传给 useNodeDocks（由其做 1 秒延时展开 + 离开延时收起）。
  const onHeaderEnter = () => onHeaderHoverChange?.(true);
  const onHeaderLeave = () => onHeaderHoverChange?.(false);

  const [assetDragOver, setAssetDragOver] = useState(false);

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

  // 仅在"单击节点后 3 秒内"显示标题栏操作按钮；编辑名称进行中保持显示。
  const showActions = clickShowActions || editingTitle;

  // Connection handles — shared subtle-at-rest / filled-on-hover styling (see
  // lib/handleStyle). Target = square (receives), source = circle (sends).
  // During a connection drag, `connectState` highlights the handle that could
  // complete it (per the connection matrix) and dims the rest.
  const handleActive = isHovered || !!selected;
  const connectState = useConnectState(id, nodeType);
  const targetHandle = handleStyle(config.color, handleActive, "square", connectState.target);
  const sourceHandle = handleStyle(config.color, handleActive, "circle", connectState.source);

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

  // Selection outline reads the STORE's real selected state (selVis), not the
  // `selected` prop — that prop is forced false during multi/box-select, but every
  // selected node should still show its highlight. Made a clearly-visible solid
  // accent ring (the old 0x14≈8% glow was effectively invisible).
  const selVis = storeSelected;
  const borderStyle = runBorder
    ? runBorder
    : borderTint
      ? selVis
        ? `2px solid ${borderTint}`
        : `1px solid ${borderTint}99`
      : isCreative
        ? selVis
          ? `2px solid ${config.color}`
          : `1px solid var(--c-bd2)`
        : selVis
          ? `2px solid ${config.color}`
          : isHovered
            ? `1px solid var(--c-bd3)`
            : `1px solid var(--c-bd1)`;

  // NOTE: config.color is an oklch() string, so it must NOT be suffixed with a hex
  // alpha (the old `${config.color}14` produced `oklch(...)14` → invalid CSS → the
  // whole box-shadow was dropped to `none`, which is why selection looked unhighlighted).
  // Use the solid colour for the ring and color-mix() for the soft glow.
  const shadowStyle = runShadow
    ? `${runShadow}, var(--c-node-shadow-run)`
    : selVis
      ? `0 0 0 2.5px ${config.color}, 0 0 0 9px color-mix(in oklch, ${config.color} 22%, transparent), var(--c-node-shadow-selected)`
      : isHovered
        ? `var(--c-node-shadow-hover)`
        : `var(--c-node-shadow-rest)`;

  return (
    <div
      className={`group/node relative${runStatus === "running" ? " node-run-pulse" : ""}`}
      data-selected={(storeSelected || pinned) ? "true" : "false"}
      data-has-hero={hasHero ? "true" : "false"}
      style={{
        // var() with the exact current literal as fallback → "pro" (no --ui-radius-node)
        // is byte-identical; "studio" skin overrides it for softer cards.
        borderRadius: "var(--ui-radius-node, 16px)",
        background: "var(--c-node-bg)",
        border: borderStyle,
        boxShadow: shadowStyle,
        minWidth: (isCreative || isStudio) ? Math.round(minWidth * 1.25) : minWidth,
        minHeight: isCollapsedPreview ? 0 : minHeight,
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
      onClick={() => revealActions()}
      onDragOver={onAssetImageDrop ? (e) => {
        if (!e.dataTransfer.types.includes("application/x-asset-list")) return;
        e.preventDefault(); e.dataTransfer.dropEffect = "copy"; if (!assetDragOver) setAssetDragOver(true);
      } : undefined}
      onDragLeave={onAssetImageDrop ? (e) => { if (e.currentTarget === e.target) setAssetDragOver(false); } : undefined}
      onDrop={onAssetImageDrop ? (e) => {
        const urls = imageUrlsFromAssetDrag(e.dataTransfer);
        setAssetDragOver(false);
        if (urls.length === 0) return;
        e.preventDefault(); e.stopPropagation(); // consume → 画布不再新建素材节点
        onAssetImageDrop(urls);
      } : undefined}
    >
      {/* Studio skin: a floating contextual toolbar above the selected node
          (LibLib-style). Additive & studio-only — pro never renders it. Reuses
          the EXACT existing handlers (same onRun reference the title-bar run uses,
          and the self-contained duplicateNode store action), so it cannot diverge
          from or break existing behavior. */}
      {isStudio && (storeSelected || pinned) && (
        <NodeToolbar nodeId={id} isVisible position={Position.Top} offset={10}>
          <div
            className="nodrag flex items-center gap-1"
            style={{
              background: "var(--c-elevated)",
              border: "1px solid var(--c-bd2)",
              borderRadius: 11,
              padding: "5px 7px",
              boxShadow: "var(--c-node-shadow-hover)",
            }}
          >
            {onRun && (
              <button
                onClick={(e) => { e.stopPropagation(); if (canRun && !nodeRunning) onRun(); }}
                disabled={!canRun || nodeRunning}
                title={nodeRunning ? "生成中…" : (hasResult ? "重新生成" : "运行")}
                className="flex items-center justify-center w-7 h-7 rounded-lg"
                style={{
                  background: !canRun || nodeRunning ? "var(--c-surface)" : `${config.color}22`,
                  color: !canRun || nodeRunning ? "var(--c-t4)" : config.color,
                  border: "none",
                  cursor: !canRun || nodeRunning ? "not-allowed" : "pointer",
                }}
              >
                {nodeRunning ? <Loader2 size={13} className="animate-spin" /> : (hasResult ? <RefreshCw size={13} /> : <Play size={13} />)}
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); duplicateNode(id); }}
              title="复制节点"
              className="flex items-center justify-center w-7 h-7 rounded-lg"
              style={{ background: "var(--c-surface)", color: "var(--c-t2)", border: "none", cursor: "pointer" }}
            >
              <Copy size={13} />
            </button>
            {/* variants — identical call to the title-bar variants action (store action, gated to VARIANT_TYPES) */}
            {VARIANT_TYPES.includes(nodeType) && (
              <button
                onClick={(e) => { e.stopPropagation(); const n = createVariants(id, 3); if (n > 0) toast.success(`已生成 ${n} 个变体（各带随机种子，复用相同输入）`); }}
                title="生成变体（×3，随机种子）"
                className="flex items-center justify-center w-7 h-7 rounded-lg"
                style={{ background: "var(--c-surface)", color: "var(--c-t2)", border: "none", cursor: "pointer" }}
              >
                <Layers size={13} />
              </button>
            )}
            {/* delete — identical composed call to the title-bar delete (store + server mutation) */}
            <button
              onClick={(e) => { e.stopPropagation(); deleteNode(id); if (projectId) deleteNodeMutation.mutate({ id, projectId }); }}
              title="删除节点"
              className="flex items-center justify-center w-7 h-7 rounded-lg"
              style={{ background: "var(--c-surface)", color: "oklch(0.7 0.18 25)", border: "none", cursor: "pointer" }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </NodeToolbar>
      )}

      {/* 素材拖入高亮 */}
      {assetDragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center" style={{ borderRadius: "var(--ui-radius-node, 16px)", border: `2px dashed ${config.color}`, background: `${config.color}14` }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: config.color, background: "var(--c-base)", padding: "4px 10px", borderRadius: 8, border: `1px solid ${config.color}55` }}>放到此处用作参考图</span>
        </div>
      )}
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
    <div className="flex flex-col" style={{ overflow: "hidden", borderRadius: "inherit", width: "100%", height: "100%", maxHeight: cappedMaxHeight }}>

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
        className="flex items-center gap-2 px-3.5 py-1.5 select-none flex-shrink-0"
        onMouseEnter={onHeaderEnter}
        onMouseLeave={onHeaderLeave}
        style={{
          background: isCreative
            ? `${config.color}0a`
            : `linear-gradient(180deg, ${config.color}0e 0%, transparent 100%)`,
          borderBottom: `1px solid ${(isCreative || isLight) ? "var(--c-bd1)" : "oklch(0.20 0.008 260 / 0.60)"}`,
          minHeight: isCreative ? 32 : 36,
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
          className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0"
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
                className="text-xs font-semibold truncate ui-node-title"
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
                className="flex-shrink-0"
                style={{
                  width: 18, height: 18, padding: 0,
                  border: "none", background: "transparent",
                  // 隐藏时 display:none 让出空间，标题获得更多显示宽度。
                  display: showActions ? "flex" : "none",
                  alignItems: "center", justifyContent: "center",
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

        {/* Collaborator indicator — a small dot in the creator's unique color so
            collaborators can tell who placed each node. Matches cursor colors. */}
        {creatorColor && (
          <span
            className="flex-shrink-0 rounded-full"
            title={`${creatorName ?? "协作者"} 放置的节点`}
            style={{
              width: 8,
              height: 8,
              background: creatorColor,
              border: "1.5px solid var(--c-base)",
              boxShadow: `0 0 0 1px ${creatorColor}66, 0 0 6px ${creatorColor}55`,
            }}
          />
        )}

        {/* Owner-agent badge — which agent generated this node (multi-agent canvas). */}
        {ownerBadge && (
          <span
            className="flex-shrink-0"
            title={`由智能体 A${ownerBadge.index} 生成`}
            style={{
              fontSize: 8.5, fontWeight: 800, lineHeight: "13px", height: 13, minWidth: 16,
              padding: "0 3px", borderRadius: 4, textAlign: "center", color: "#fff",
              background: ownerBadge.color, boxShadow: `0 0 0 1px ${ownerBadge.color}66`,
            }}
          >A{ownerBadge.index}</span>
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

        {/* Action buttons — 单击节点后显示 3 秒；隐藏时用 display:none 让出空间（其它按钮靠右、
            标题获得更多显示宽度）；鼠标悬停其上时保持显示（移开后重新计时）。 */}
        <div
          className="items-center gap-0.5 flex-shrink-0"
          style={{ display: showActions ? "flex" : "none" }}
          onMouseEnter={() => { if (hideActionsTimer.current) clearTimeout(hideActionsTimer.current); }}
          onMouseLeave={() => armHideActions()}
        >
          {VARIANT_TYPES.includes(nodeType) && (
            <button
              onClick={() => { const n = createVariants(id, 3); if (n > 0) toast.success(`已生成 ${n} 个变体（各带随机种子，复用相同输入）`); }}
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
              title="生成 A/B 变体（×3，各带随机种子）"
            >
              <Layers className="w-3 h-3" />
            </button>
          )}
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
      {(genBusy || nodeRunning) && (
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
            {genProgress != null ? `${Math.round(genProgress)}%` : (genQueue != null ? `排队 ${genQueue}` : "生成中")}
          </span>
        </div>
      )}

      {/* ── Live sampling preview (ComfyUI) ──
          The denoising in-progress image streamed over the WS. Shown only while
          busy and when the node is expanded (selected/pinned), so collapsed nodes
          stay compact. Transient — discarded when the run finishes. */}
      {genBusy && livePreview && expandSelected && (
        <div style={{ padding: "4px 8px", flexShrink: 0, background: "var(--c-node-bg)", borderBottom: "1px solid var(--c-bd1)" }}>
          <img
            src={livePreview}
            alt="实时预览"
            className="nodrag"
            style={{ display: "block", width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 6, background: "var(--c-surface)" }}
          />
        </div>
      )}

      {/* ── Persistent failure indicator ──
          Like the progress bar, rendered outside the collapsing body so a failed
          generation is visible even when the node is collapsed (the detailed error
          lives inside the body). */}
      {!genBusy && !nodeRunning && genError && (
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
      <NodeSelectedContext.Provider value={expandSelected}>
        <div className="node-body-wrap">
          {/* When the node height is capped, make this wrapper a flex column so a
              flex:1 child can inherit the bounded height (percentage height/h-full
              can't resolve here because the parent height is flex-derived). */}
          <div className="overflow-visible nopan" style={{ flex: 1, minHeight: 0, ...(capNodeHeight ? { display: "flex", flexDirection: "column" } : {}) }}>{children}</div>
        </div>
      </NodeSelectedContext.Provider>

      </div>{/* end inner overflow:hidden content wrapper */}

      {/* 左侧吸附浮层：渲染在折叠 body 之外，节点收缩后仍常驻可见（绝对定位于节点根，向左吸附）。 */}
      {leftDock}

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
