import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { useParams, useLocation } from "wouter";
import {
  ReactFlow,
  Background,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
  SelectionMode,
  PanOnScrollMode,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCanvasStore, registerNodeMutationBroadcaster, aspectToComfyWH, type CanvasNode, type CanvasEdge } from "../hooks/useCanvasStore";
import { useComfyPreviewStore } from "../hooks/useComfyPreviewStore";
import { useConnectingStore } from "../hooks/useConnectingStore";
import { useGlobalPeekStore } from "../hooks/useGlobalPeekStore";
import { usePersistentState } from "../hooks/usePersistentState";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowRunner, RUNNABLE_TYPES } from "../hooks/useWorkflowRunner";
import { WorkflowRunProvider } from "../contexts/WorkflowRunContext";
import { NodeDefaultModelsProvider } from "../contexts/NodeDefaultModelsContext";
import { useSystemDefaultModels } from "../lib/useSystemDefaultModels";
import { NodeDefaultModelsButton } from "../components/canvas/NodeDefaultModelsButton";
import { BudgetButton } from "../components/canvas/BudgetButton";
import type { NodeDefaultModelsConfig } from "../../../shared/nodeDefaultModels";
import { CanvasChatWindow } from "../components/chat/CanvasChatWindow";
import { CanvasChatNotifier } from "../components/canvas/CanvasChatNotifier";
import { CanvasAnnounceBanner } from "../components/canvas/CanvasAnnounceBanner";
import { getDeviceFingerprint } from "@/lib/deviceFingerprint";
import { CanvasAgentChat } from "../components/canvas/CanvasAgentChat";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useTopbarNarrow } from "../hooks/useTopbarNarrow";
import { useIsMobile } from "../hooks/useMobile";
import { useStudioCreateBarCollapsed, setStudioCreateBarCollapsed } from "../hooks/useStudioCreateBar";
import { useUIStyle } from "../contexts/UIStyleContext";
import { PoyoBalanceDashboard } from "../components/PoyoBalanceDashboard";
import { KieBalanceDashboard } from "../components/KieBalanceDashboard";
import { CustomLlmKeyDashboard } from "../components/CustomLlmKeyDashboard";
import { RunStatusBar } from "../components/canvas/RunStatusBar";
import { CustomNode } from "../components/canvas/CustomNode";
import { ComfyServerStatusIndicator } from "../components/canvas/ComfyServerStatusIndicator";
import { PoyoStorageStatusChip } from "../components/canvas/mediaReachability";
import { CustomEdge } from "../components/canvas/CustomEdge";
import { ContextMenu } from "../components/canvas/ContextMenu";
import { CollaboratorCursors } from "../components/canvas/CollaboratorCursors";
import { FloatingAssetPanel } from "../components/canvas/FloatingAssetPanel";
import { CanvasLeftPanel } from "../components/canvas/CanvasLeftPanel";
import { EffectsPlaza } from "../components/canvas/EffectsPlaza";
import { CharacterLibraryPanel } from "../components/canvas/CharacterLibraryPanel";
import { PromptLibraryPanel } from "../components/canvas/PromptLibraryPanel";
import { setLibraryCharacters } from "../lib/characterConditioning";
import { setPromptLibrary } from "../lib/promptLibraryStore";
import { ChangePasswordDialog } from "../components/ChangePasswordDialog";
import { NodeImageLightbox } from "../components/canvas/NodeImageLightbox";
import { CompareLightbox } from "../components/canvas/CompareLightbox";
import { PickModeBar } from "../components/canvas/PickModeBar";
import { TemplatePanel } from "../components/canvas/TemplatePanel";
import { NodeTemplateLibrary } from "../components/canvas/NodeTemplateLibrary";
import { NodeSearch } from "../components/canvas/NodeSearch";
import { PresentationMode } from "../components/canvas/PresentationMode";
import { FilmstripPanel } from "../components/canvas/FilmstripPanel";
import { TimelinePanel } from "../components/canvas/TimelinePanel";
import { GridStoryboardModal } from "../components/canvas/GridStoryboardModal";
// 导演台 3D 编辑器懒加载——three/R3F 体积大，仅在打开时才拉取，不拖累主包。
const DirectorEditor = lazy(() => import("../components/canvas/director/DirectorEditor").then((m) => ({ default: m.DirectorEditor })));
import { Lightbox } from "../components/canvas/studio/Lightbox";
import { MultiSelectBar } from "../components/canvas/studio/MultiSelectBar";
import { AlignToolbar } from "../components/canvas/AlignToolbar";
import { CanvasTips, resetCanvasTips } from "../components/canvas/CanvasTips";
import { ReturnToNodesHint } from "../components/canvas/ReturnToNodesHint";
import { EmptyCanvasGuide } from "../components/canvas/EmptyCanvasGuide";
import { setBoxSelecting } from "../hooks/useBoxSelecting";
import { markGestureSelected, clearGestureSelected } from "../hooks/useNodeExpandGuard";
import { useEdgeInsert } from "../hooks/useEdgeInsert";
import { StudioCreateBar } from "../components/canvas/studio/StudioCreateBar";
import { ModelQuickSwitch, MODEL_SWITCH_FIELD } from "../components/canvas/studio/ModelQuickSwitch";
import { isConnectionValid, isHandleConnectionValid, getCompatibleTargets, getCompatibleSources, CONNECTION_HINTS, defaultTargetHandle } from "../lib/connectionRules";
import { listNodeTemplates, saveNodeTemplate, deleteNodeTemplate, exportNodeTemplatesJson, importNodeTemplatesJson } from "../lib/nodeTemplates";
import { isComfyNodeType, suggestComfyTemplateName, describeComfyTemplate, extractComfyThumbnail, type ComfyNodeType } from "../lib/comfyNodeTemplates";
import { SaveComfyTemplateDialog } from "../components/canvas/SaveComfyTemplateDialog";
import { downloadMedia, downloadTextFile } from "@/lib/download";
import { BeginnerGuide, ConnectionHintsPanel } from "../components/canvas/BeginnerGuide";
import { GuidedTour } from "../components/canvas/GuidedTour";
import { NotifySettingsDialog } from "../components/canvas/NotifySettingsDialog";
import { useGuideStore } from "../hooks/useGuideStore";
import { GUIDE_STEPS, type TourStep } from "../lib/guideSteps";
import { HelpPanel } from "../components/canvas/HelpPanel";
import { CollaborationPanel } from "../components/canvas/CollaborationPanel";
import { NarrativeArcPicker } from "../components/canvas/NarrativeArcPicker";
import { WorkflowStatusPanel } from "../components/canvas/WorkflowStatusPanel";
import { ThemeSwitcher } from "../components/canvas/ThemeSwitcher";
import { UIStyleSwitcher } from "../components/canvas/UIStyleSwitcher";
import { ZoomControl } from "../components/canvas/ZoomControl";
import { CanvasBgPicker, loadCanvasBg, type CanvasBg } from "../components/canvas/CanvasBgPicker";
import { useCanvasMode } from "../contexts/CanvasModeContext";
import { useTheme, THEMES } from "../contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import type { NodeType, NodeData, GroupNodeData } from "../../../shared/types";
import { getNodeConfig, NODE_TYPE_LIST, NODE_ICONS, COLLABORATOR_COLORS, type NodeConfig } from "../lib/nodeConfig";
import { sortNodeConfigsForPalette } from "../lib/nodeOrder";
import { estimateCanvasBudget } from "../lib/costEstimate";
import { resolveActiveNodeModel } from "../contexts/NodeDefaultModelsContext";
import { io, type Socket } from "socket.io-client";
import {
  Film,
  Save,
  CopyPlus,
  Download,
  Upload,
  Users,
  ChevronLeft,
  Plus,
  Grid2x2,
  Paperclip,
  Image,
  Loader2,
  Pencil,
  X,
  FileText,
  LayoutGrid,
  BarChart2,
  Maximize2,
  LocateFixed,
  Scan,
  Play,
  LogOut,
  KeyRound,
  Undo2,
  Redo2,
  Search,
  Lock,
  Unlock,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  History,
  Trash2,
  RotateCcw,
  BookmarkPlus,
  ListVideo,
  HelpCircle,
  Lightbulb,
  Clapperboard,
  Spline,
  MessageSquare,
  Sparkles,
  MoreHorizontal,
  MonitorUp,
  Boxes,
  MoveHorizontal,
  MoveVertical,
  BookText,
  GripVertical,
  Network,
  Magnet,
  Wand2,
  Compass,
  Bell,
  PanelLeft,
  Gauge,
} from "lucide-react";
import { loadNamedSnapshots, type NamedSnapshot } from "../hooks/useCanvasStore";
import { usePerfStore, selectPerfLite, PERF_MODE_LABEL, PERF_MODE_ORDER } from "../lib/perfMode";
import { usePerfSentinel } from "../hooks/usePerfSentinel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const nodeTypes = { custom: CustomNode };
const edgeTypes = { custom: CustomEdge };

// 音频素材源判定：自动连线到 clip 时，音频 asset 应落到 audio-in（audio 节点已由
// defaultTargetHandle 的 sourceType==="audio" 覆盖，这里补"音频 asset"这一句柄路由缺口，
// 与 ClipNode 的 audio-in 接收口径一致：asset 且 type==="audio" 或 mimeType 以 audio/ 开头）。
function isAudioAssetSource(node: CanvasNode | undefined): boolean {
  if (!node || node.data.nodeType !== "asset") return false;
  const p = node.data.payload as Record<string, unknown>;
  return p.type === "audio" || (typeof p.mimeType === "string" && (p.mimeType as string).startsWith("audio/"));
}

// ── Snapshot panel ────────────────────────────────────────────────────────────
function SnapshotPanel({
  projectId, onSave, onRestore, onDelete, onClose,
}: {
  projectId: number;
  onSave: (name: string) => void;
  onRestore: (snap: NamedSnapshot) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [snapName, setSnapName] = useState("版本 " + new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }));
  const [snaps, setSnaps] = useState<NamedSnapshot[]>(() => loadNamedSnapshots(projectId));

  const handleSave = () => {
    if (!snapName.trim()) return;
    onSave(snapName.trim());
    setSnaps(loadNamedSnapshots(projectId));
  };

  const handleDelete = (id: string) => {
    onDelete(id);
    setSnaps(loadNamedSnapshots(projectId));
  };

  return (
    <div
      className="absolute bottom-14 right-2 z-40 flex flex-col rounded-2xl overflow-hidden"
      style={{
        width: 300, maxHeight: 480, background: "var(--c-base)",
        border: "1px solid var(--c-bd2)", boxShadow: "0 8px 32px oklch(0 0 0 / 0.5)",
      }}
    >
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b" style={{ borderColor: "var(--c-bd1)" }}>
        <div className="flex items-center gap-1.5">
          <History style={{ width: 13, height: 13, color: "oklch(0.72 0.18 45)" }} />
          <span className="text-xs font-semibold" style={{ color: "var(--c-t1)" }}>版本历史</span>
        </div>
        <button onClick={onClose} className="p-1 rounded" style={{ color: "var(--c-t4)" }}>
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>

      {/* Save new snapshot */}
      <div className="flex gap-1.5 p-2.5 border-b" style={{ borderColor: "var(--c-elevated)" }}>
        <input
          value={snapName}
          onChange={(e) => setSnapName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none"
          style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd3)", color: "var(--c-t1)" }}
          placeholder="版本名称..."
          maxLength={40}
        />
        <button
          onClick={handleSave}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium"
          style={{ background: "oklch(0.72 0.18 45 / 0.15)", border: "1px solid oklch(0.72 0.18 45 / 0.35)", color: "oklch(0.72 0.18 45)", cursor: "pointer" }}
        >
          <BookmarkPlus style={{ width: 10, height: 10 }} />
          保存
        </button>
      </div>

      {/* Snapshot list */}
      <div className="flex-1 overflow-y-auto">
        {snaps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <History style={{ width: 20, height: 20, color: "var(--c-t4)" }} />
            <p className="text-xs" style={{ color: "var(--c-t4)" }}>还没有保存的版本</p>
          </div>
        ) : (
          snaps.map((snap) => (
            <div
              key={snap.id}
              className="flex items-center gap-2 px-3 py-2.5 border-b"
              style={{ borderColor: "var(--c-surface)" }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: "var(--c-t1)" }}>{snap.name}</p>
                <p className="text-[10px]" style={{ color: "var(--c-t4)" }}>
                  {new Date(snap.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · {snap.nodeCount}节点
                </p>
              </div>
              <button
                onClick={() => { onRestore(snap); onClose(); }}
                className="p-1 rounded transition-all"
                title="恢复此版本"
                style={{ color: "var(--c-t3)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "oklch(0.72 0.18 45)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
              >
                <RotateCcw style={{ width: 12, height: 12 }} />
              </button>
              <button
                onClick={() => handleDelete(snap.id)}
                className="p-1 rounded transition-all"
                title="删除此版本"
                style={{ color: "var(--c-t4)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "oklch(0.62 0.20 25)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}
              >
                <Trash2 style={{ width: 12, height: 12 }} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Canvas inner ──────────────────────────────────────────────────────────────
// The DB columns a node persists to. Used both to build the upsert payload and to
// compute a per-node signature for diff-based saving (only write nodes that this
// session actually changed — so a stale/concurrent session can't re-create a node
// it never touched, which previously "resurrected" deleted nodes).
function nodeUpsertFields(n: CanvasNode) {
  // #120 NodeResizer(@xyflow v12) 拖拽缩放写入的是节点【顶层】width/height（style 不动），
  // 持久化必须优先读顶层，否则缩放后入库的仍是创建时的旧尺寸——群组底框拉大后刷新即回弹。
  const w = typeof n.width === "number" ? n.width : (n.style?.width as number | undefined);
  const h = typeof n.height === "number" ? n.height : (n.style?.height as number | undefined);
  return {
    type: n.data.nodeType,
    title: n.data.title,
    data: n.data.payload as Record<string, unknown>,
    posX: n.position.x,
    posY: n.position.y,
    width: w ?? 320,
    height: h ?? 0,
    zIndex: n.zIndex ?? 0,
  };
}
function nodeSig(n: CanvasNode): string {
  return JSON.stringify(nodeUpsertFields(n));
}
// 边的持久化字段签名，用于保存时做「增量 upsert + 删除对账」（此前边只全量 upsert、
// 从不删除，导致经垃圾桶/插入节点/删组/撤销删掉的边刷新后复活）。
function edgeSig(e: CanvasEdge): string {
  return JSON.stringify([e.source, e.target, e.sourceHandle ?? "output", e.targetHandle ?? "input", typeof e.label === "string" ? e.label : ""]);
}
// Discards corrupted localStorage payloads for persisted boolean panel toggles.
function validateBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

// Per-node-type payload patch that applies a global aspect-ratio lock — each node
// stores ratio differently. Returns null when the type/ratio isn't applicable. Shared
// by the lock action AND the new-node auto-inherit effect.
function aspectPatchFor(type: NodeType, ratio: string, params?: Record<string, unknown>): Record<string, unknown> | null {
  if (type === "image_gen" || type === "storyboard" || type === "prompt" || type === "image_edit") return { aspectRatio: ratio };
  if (type === "comfyui_workflow") return { overrideRatioSize: true, aspectRatio: ratio };
  if (type === "comfyui_image" || type === "comfyui_video") { const wh = aspectToComfyWH(ratio); return wh.width ? wh : null; }
  if (type === "video_task") return { params: { ...(params ?? {}), aspect_ratio: ratio } };
  if (type === "clip" && (ratio === "16:9" || ratio === "9:16" || ratio === "1:1")) return { aspect: ratio };
  return null;
}

function CanvasInner({ projectId }: { projectId: number }) {
  const { user, isAuthenticated, logout } = useAuth();
  const [showChangePw, setShowChangePw] = useState(false);
  const [, navigate] = useLocation();
  const reactFlow = useReactFlow();

  // ── 框选放大区域：开启后在画布上拖出一个矩形，松手即把该区域放大铺满全屏 ──
  // 纯交互、一次性动作（不持久化）。Esc 取消；矩形过小忽略。
  const [regionZoomActive, setRegionZoomActive] = useState(false);
  const [regionRect, setRegionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const regionStartRef = useRef<{ x: number; y: number } | null>(null);
  const onRegionPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    regionStartRef.current = { x: e.clientX, y: e.clientY };
    setRegionRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  }, []);
  const onRegionPointerMove = useCallback((e: React.PointerEvent) => {
    const s = regionStartRef.current;
    if (!s) return;
    setRegionRect({ x: Math.min(s.x, e.clientX), y: Math.min(s.y, e.clientY), w: Math.abs(e.clientX - s.x), h: Math.abs(e.clientY - s.y) });
  }, []);
  const onRegionPointerUp = useCallback((e: React.PointerEvent) => {
    const s = regionStartRef.current;
    regionStartRef.current = null;
    setRegionRect(null);
    setRegionZoomActive(false);
    if (!s) return;
    const x1 = s.x, y1 = s.y, x2 = e.clientX, y2 = e.clientY;
    // 太小的框（误点）忽略
    if (Math.abs(x2 - x1) < 12 || Math.abs(y2 - y1) < 12) return;
    const p1 = reactFlow.screenToFlowPosition({ x: Math.min(x1, x2), y: Math.min(y1, y2) });
    const p2 = reactFlow.screenToFlowPosition({ x: Math.max(x1, x2), y: Math.max(y1, y2) });
    reactFlow.fitBounds({ x: p1.x, y: p1.y, width: Math.max(1, p2.x - p1.x), height: Math.max(1, p2.y - p1.y) }, { duration: 400, padding: 0.04 });
  }, [reactFlow]);
  useEffect(() => {
    if (!regionZoomActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { regionStartRef.current = null; setRegionRect(null); setRegionZoomActive(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [regionZoomActive]);

  const {
    nodes, edges, setNodes, setEdges,
    onNodesChange, onEdgesChange, onConnect,
    addNode, deleteNode, duplicateNode, updateNodeData,
    setProjectId, isDirty, markClean, markDirty,
    setCollaborator, removeCollaborator, collaborators, resetCanvas,
    undo, redo, past, future,
    saveNamedSnapshot, restoreNamedSnapshot, deleteNamedSnapshot,
    importGraph,
  } = useCanvasStore(useShallow((s) => ({
    nodes: s.nodes,
    edges: s.edges,
    setNodes: s.setNodes,
    setEdges: s.setEdges,
    onNodesChange: s.onNodesChange,
    onEdgesChange: s.onEdgesChange,
    onConnect: s.onConnect,
    addNode: s.addNode,
    deleteNode: s.deleteNode,
    duplicateNode: s.duplicateNode,
    updateNodeData: s.updateNodeData,
    setProjectId: s.setProjectId,
    isDirty: s.isDirty,
    markClean: s.markClean,
    markDirty: s.markDirty,
    setCollaborator: s.setCollaborator,
    removeCollaborator: s.removeCollaborator,
    collaborators: s.collaborators,
    resetCanvas: s.resetCanvas,
    undo: s.undo,
    redo: s.redo,
    past: s.past,
    future: s.future,
    saveNamedSnapshot: s.saveNamedSnapshot,
    restoreNamedSnapshot: s.restoreNamedSnapshot,
    deleteNamedSnapshot: s.deleteNamedSnapshot,
    importGraph: s.importGraph,
  })));

  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; type: "canvas" | "node"; nodeId?: string; canvasPos?: { x: number; y: number };
  } | null>(null);
  // Bumped on save/delete so the context menu re-reads node templates from localStorage.
  const [tplBump, setTplBump] = useState(0);

  // Panels whose open-state should survive a reload use usePersistentState
  // (namespaced `ui:panel:*`). Transient modals/pickers (node picker, search,
  // help, snapshots, run-confirm, …) stay as plain useState — they should
  // always start closed.
  const [showAssets, setShowAssets] = usePersistentState<boolean>(
    "ui:panel:assets:v1", false, { validate: validateBool, crossTab: false },
  );
  const [showTemplates, setShowTemplates] = useState(false);
  const [showNodeLib, setShowNodeLib] = useState(false);
  // 从「连线放置」菜单打开节点模板库时的连接上下文：选中模板后在落点建节点并连边。
  const [tplLibConnect, setTplLibConnect] = useState<{ x: number; y: number; fromId: string; fromHandleType: "source" | "target"; fromHandle: string | null } | null>(null);
  const [showCharLib, setShowCharLib] = usePersistentState<boolean>(
    "ui:panel:charlib:v1", false, { validate: validateBool, crossTab: false },
  );
  // #81 渲染性能：FPS 哨兵（auto 档自动降 lite）+ 生效档订阅（驱动 ReactFlow 离屏裁剪）。
  usePerfSentinel();
  const perfLite = usePerfStore(selectPerfLite);
  const perfMode = usePerfStore((s) => s.mode);
  // 离屏裁剪只在节点够多时才净赚：收益 = 少渲染视口外节点；代价 = 平移/双指缩放手势中
  // 边界节点反复挂载/卸载 + 图片重解码。节点少时代价 > 收益——手机真实反馈「流畅模式反而更慢」
  // 正是这个反噬。阈值 30：小画布 lite 只保留 CSS/3D 降级，大画布才叠加裁剪。
  const perfNodeCount = useCanvasStore((s) => s.nodes.length);
  const perfCullOffscreen = perfLite && perfNodeCount > 30;
  const [showPromptLib, setShowPromptLib] = usePersistentState<boolean>(
    "ui:panel:promptlib:v1", false, { validate: validateBool, crossTab: false },
  );
  const [comfySaveTarget, setComfySaveTarget] = useState<
    { nodeType: ComfyNodeType; payload: Record<string, unknown>; useCloud: boolean; defaultName: string; thumbnail?: string } | null
  >(null);
  const [showNodeSearch, setShowNodeSearch] = useState(false);
  const [modelSwitch, setModelSwitch] = useState<{ nodeId: string; nodeType: NodeType } | null>(null);
  const [showCollaborators, setShowCollaborators] = usePersistentState<boolean>(
    "ui:canvas:collab-open:v1", false, { validate: validateBool, crossTab: false },
  );
  const [showCollaboratorPanel, setShowCollaboratorPanel] = useState(false);
  const [showNodePicker, setShowNodePicker] = useState(false);
  const [showGridStoryboard, setShowGridStoryboard] = useState(false);
  // 导演台：节点双击/「打开导演台」经 panelRequest("director-editor") 触发，开全屏 3D 编辑器。
  const [directorNodeId, setDirectorNodeId] = useState<string | null>(null);
  const directorPanelReq = useCanvasStore((s) => (s.panelRequest?.panel === "director-editor" ? s.panelRequest : null));
  useEffect(() => { if (directorPanelReq) setDirectorNodeId(directorPanelReq.nodeId); }, [directorPanelReq?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodePickerSearch, setNodePickerSearch] = useState("");
  // 最近添加的节点类型（置顶快速访问），localStorage 持久化、跨会话保留。
  const [recentNodeTypes, setRecentNodeTypes] = usePersistentState<string[]>(
    "ui:nodepicker:recent:v1", [],
    { validate: (v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null), crossTab: false },
  );
  useEffect(() => { if (!showNodePicker) setNodePickerSearch(""); }, [showNodePicker]); // fresh search each open
  const [showPresentation, setShowPresentation] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showStatsSidebar, setShowStatsSidebar] = usePersistentState<boolean>(
    "ui:panel:stats:v1", false, { validate: validateBool, crossTab: false },
  );
  const [showFilmstrip, setShowFilmstrip] = usePersistentState<boolean>(
    "ui:panel:filmstrip:v1", false, { validate: validateBool, crossTab: false },
  );
  // LibTV 化 2.4：资产管理左栏（画布大纲 + 资产双 tab），底部 dock「资产管理」开关。
  const [showLeftPanel, setShowLeftPanel] = usePersistentState<boolean>(
    "ui:panel:leftpanel:v1", false, { validate: validateBool, crossTab: false },
  );
  // 阶段四 4.2：特效广场（运镜/画风特效/工作流配方聚合浏览）
  const [showPlaza, setShowPlaza] = useState(false);
  const [showTimeline, setShowTimeline] = usePersistentState<boolean>(
    "ui:panel:timeline:v1", false, { validate: validateBool, crossTab: false },
  );
  const [canvasBg, setCanvasBg] = useState<CanvasBg>(() => loadCanvasBg());
  // Keep --c-canvas in sync with the picker so all components using
  // var(--c-canvas) (node borders, inset previews, vignette) match the
  // user-chosen background color. In "follow theme" mode we must NOT set an
  // inline override (it would shadow the theme's CSS --c-canvas and a theme
  // switch would no longer change the background — the reported bug).
  useEffect(() => {
    if (canvasBg.followTheme) {
      document.documentElement.style.removeProperty("--c-canvas");
      return;
    }
    document.documentElement.style.setProperty("--c-canvas", canvasBg.bgColor);
    return () => { document.documentElement.style.removeProperty("--c-canvas"); };
  }, [canvasBg.followTheme, canvasBg.bgColor]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [globalAspectRatio, setGlobalAspectRatio] = useState<string | null>(null);
  const [showRatioPicker, setShowRatioPicker] = useState(false);
  const [showConnectionHints, setShowConnectionHints] = usePersistentState<boolean>(
    "ui:panel:connectionHints:v1", false, { validate: validateBool },
  );
  const [showHelp, setShowHelp] = useState(false);
  // 拖动吸附到网格（持久化到 localStorage）。
  const [snapEnabled, setSnapEnabled] = useState<boolean>(() => (typeof localStorage !== "undefined" && localStorage.getItem("avc:snap") === "1"));
  const toggleSnap = useCallback(() => setSnapEnabled((v) => {
    const nv = !v;
    try { localStorage.setItem("avc:snap", nv ? "1" : "0"); } catch { /* ignore */ }
    toast.success(nv ? "已开启网格吸附" : "已关闭网格吸附", { duration: 1000 });
    return nv;
  }), []);
  // Chat floating window: remember whether it was open across reloads (its
  // position/size/scale/pin already persist inside CanvasChatWindow).
  const [chatOpen, setChatOpen] = usePersistentState<boolean>(
    "ui:canvas:chat-open:v1", false, { validate: validateBool, crossTab: false },
  );
  // 聊天窗关着时的未读计数（画布常驻通知监听器累加，顶栏聊天按钮显红点）；打开聊天窗即清零。
  const [chatUnread, setChatUnread] = useState(0);
  useEffect(() => { if (chatOpen) setChatUnread(0); }, [chatOpen]);
  // 画布助手（对话式操作画布）浮层开关。默认打开，且**每次进入画布都自动打开**（不持久化关闭态）——
  // 本次会话内关掉即隐藏，重新打开画布/项目会再次弹出。历史对话已落库，重开不丢上下文。
  const [agentChatOpen, setAgentChatOpen] = useState<boolean>(true);
  const [showArcPicker, setShowArcPicker] = useState(false);
  // 交互式新手导览：start 供「更多 → 新手导览」与欢迎弹窗触发；每步 openPanel 由 handleGuideStep
  // 程序化打开对应面板（面板多为条件渲染，不先打开就无从高亮）。
  const startGuide = useGuideStore((s) => s.start);
  const guideOpenedRef = useRef<TourStep["openPanel"]>(null);
  const [showNotifySettings, setShowNotifySettings] = useState(false);
  const setGuidePanel = useCallback((p: TourStep["openPanel"], open: boolean) => {
    switch (p) {
      case "nodePicker": setShowNodePicker(open); break;
      case "connectionHints": setShowConnectionHints(open); break;
      case "assets": setShowAssets(open); break;
      case "charLib": setShowCharLib(open); break;
      case "agentChat": setAgentChatOpen(open); break;
      case "shortcuts": setShowShortcuts(open); break;
    }
  }, [setShowNodePicker, setShowConnectionHints, setShowAssets, setShowCharLib, setAgentChatOpen, setShowShortcuts]);
  // 导览每进入一步：先收起上一步导览打开的面板（agentChat 恢复为默认打开态），再打开本步目标面板。
  // 只收拾「导览自己打开的」面板，不动用户手动开的其它面板。
  const handleGuideStep = useCallback((step: TourStep | null) => {
    const want = step?.openPanel ?? null;
    const cur = guideOpenedRef.current;
    if (cur && cur !== want) {
      setGuidePanel(cur, cur === "agentChat");
      guideOpenedRef.current = null;
    }
    if (want && guideOpenedRef.current !== want) {
      setGuidePanel(want, true);
      guideOpenedRef.current = want;
    }
  }, [setGuidePanel]);
  const { mode: canvasMode } = useCanvasMode();
  const { theme } = useTheme();
  const themeIsDark = THEMES.find((t) => t.id === theme)?.dark ?? true;
  // LibTV 化 3.1：创意模式为 LibTV 暗色皮肤——一律按暗分支处理（minimap 遮罩等）。
  const isLight = canvasMode === "creative" ? false : !themeIsDark;
  // Effective canvas background: in "follow theme" mode use the theme's own
  // --c-canvas (so switching theme updates it) with a theme-appropriate pattern
  // color; otherwise use the user's explicit picker color.
  const effectiveBgColor = canvasBg.followTheme ? "var(--c-canvas)" : canvasBg.bgColor;
  const effectivePatternColor = canvasBg.followTheme
    ? (!isLight ? "oklch(0.32 0.010 260 / 0.6)" : "oklch(0.60 0.010 260 / 0.5)")
    : canvasBg.patternColor;
  // 进入创意模式不再默认打开胶片条（用户可从菜单手动开启）；离开创意模式时若开着则收起，
  // 避免胶片条残留到专业/工作室模式。只在真正的模式切换时处理，避免挂载/刷新清掉持久化开关。
  const prevCanvasModeRef = useRef(canvasMode);
  useEffect(() => {
    const prev = prevCanvasModeRef.current;
    if (prev === canvasMode) return;
    prevCanvasModeRef.current = canvasMode;
    if (canvasMode !== "creative") setShowFilmstrip(false);
  }, [canvasMode, setShowFilmstrip]);
  const [connectingFromType, setConnectingFromType] = useState<NodeType | null>(null);
  // 拉线松手落在空白处时，在鼠标位置弹出的「建节点并连线」小菜单（仅列可连接类型）。
  const [connectMenu, setConnectMenu] = useState<{ x: number; y: number; types: NodeType[]; fromId: string; fromHandleType: "source" | "target"; fromHandle: string | null } | null>(null);
  const [connectSearch, setConnectSearch] = useState(""); // ◆7 建节点菜单搜索词
  const [connectActiveIdx, setConnectActiveIdx] = useState(0); // #R4-7 键盘 ↑↓ 高亮项
  useEffect(() => { if (!connectMenu) setConnectSearch(""); setConnectActiveIdx(0); }, [connectMenu]);
  useEffect(() => { setConnectActiveIdx(0); }, [connectSearch]);
  const [connectDragType, setConnectDragType] = useState<NodeType | null>(null); // 弹窗内拖拽排序中的项
  // 建节点菜单的「节点类型自定义排序」——服务端持久化（user_prefs.connectMenuOrder），跨设备保留。
  const [connectOrder, setConnectOrder] = useState<string[]>([]);
  const { data: connectOrderData } = trpc.userPrefs.get.useQuery({ key: "connectMenuOrder" }, { enabled: isAuthenticated });
  useEffect(() => { if (Array.isArray(connectOrderData?.value)) setConnectOrder(connectOrderData.value as string[]); }, [connectOrderData]);
  const setConnectOrderMut = trpc.userPrefs.set.useMutation();
  // 按用户排序给候选类型排序：order 里靠前的排前面；未排过的保持其原相对顺序接在后面。
  const sortByConnectOrder = useCallback((types: NodeType[]): NodeType[] => {
    if (connectOrder.length === 0) return types;
    const rank = new Map(connectOrder.map((t, i) => [t, i]));
    return [...types].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
  }, [connectOrder]);
  // 弹窗内拖拽重排：更新弹窗显示顺序 + 合并进全局优先级并持久化。
  const reorderConnectType = useCallback((from: NodeType, to: NodeType) => {
    setConnectMenu((m) => {
      if (!m || from === to) return m;
      const arr = m.types.slice();
      const fi = arr.indexOf(from), ti = arr.indexOf(to);
      if (fi < 0 || ti < 0) return m;
      arr.splice(fi, 1); arr.splice(ti, 0, from);
      // 新全局优先级 = 这次重排后的可见顺序 + 其它历史排序项。
      const merged = [...arr, ...connectOrder.filter((t) => !arr.includes(t as NodeType))];
      setConnectOrder(merged);
      setConnectOrderMut.mutate({ key: "connectMenuOrder", value: merged });
      return { ...m, types: arr };
    });
  }, [connectOrder, setConnectOrderMut]);

  // Workflow runner
  const { runState, runWorkflow, reset: resetWorkflowRun, cancel: cancelWorkflowRun } = useWorkflowRunner();
  const [showRunConfirm, setShowRunConfirm] = useState(false);
  const [pendingRunNodeId, setPendingRunNodeId] = useState<string | null>(null);
  // When set, the run is restricted to exactly these (box-selected) node ids.
  const [pendingRunOnlyIds, setPendingRunOnlyIds] = useState<string[] | null>(null);
  const [runConfirmCountdown, setRunConfirmCountdown] = useState(3);
  const runConfirmOpenRef = useRef(false);
  const runStateRunningRef = useRef(false);
  runStateRunningRef.current = runState.running;
  // 运行确认弹窗要显示「预计消耗 vs 余额」：仅在弹窗打开时拉取余额，避免常驻轮询。
  const kieTempKey = typeof localStorage !== "undefined" ? localStorage.getItem("kie:tempKey") ?? "" : "";
  const kieBalQ = trpc.kie.balance.useQuery(kieTempKey ? { tempKey: kieTempKey } : undefined, { enabled: showRunConfirm, retry: false, staleTime: 30_000 });
  const poyoBalQ = trpc.poyo.balance.useQuery(undefined, { enabled: showRunConfirm, retry: false, staleTime: 30_000 });
  // 子图复制粘贴剪贴板：Ctrl+C 记下框选的节点 id（含展开的群组成员），Ctrl+V 克隆。
  const clipboardRef = useRef<string[]>([]);
  const pasteCountRef = useRef(0);

  const handleRunRequest = useCallback((startNodeId: string | null, onlyIds?: string[]) => {
    if (runConfirmOpenRef.current) return;
    runConfirmOpenRef.current = true;
    setPendingRunNodeId(startNodeId);
    setPendingRunOnlyIds(onlyIds && onlyIds.length > 0 ? onlyIds : null);
    setRunConfirmCountdown(3);
    setShowRunConfirm(true);
  }, []);

  // Box-selected runnable nodes: when ≥2 are selected, the run is scoped to just
  // them ("run selected only"). Drives the run button label + Shift+R behavior.
  const selectedRunnableIds = useMemo(
    () => nodes.filter((n) => n.selected && RUNNABLE_TYPES.includes(n.data.nodeType as NodeType)).map((n) => n.id),
    [nodes],
  );
  const runSelectedOnly = selectedRunnableIds.length >= 2;

  // Route store-level run requests (e.g. the agent's auto-run) through the normal
  // run-confirm dialog so generation still gets one explicit user confirmation.
  const runRequest = useCanvasStore((s) => s.runRequest);
  useEffect(() => {
    if (runRequest) handleRunRequest(runRequest.startNodeId, runRequest.onlyIds);
    // token changes each request → re-fires even for the same startNodeId
  }, [runRequest?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showRunConfirm) return;
    if (runConfirmCountdown <= 0) return;
    const t = setTimeout(() => setRunConfirmCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [showRunConfirm, runConfirmCountdown]);

  const socketRef = useRef<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  // Multi-monitor: a "popout" window (opened on a second screen) shares the same
  // project but keeps an INDEPENDENT viewport (pan/zoom) — it must not overwrite
  // the main window's server-persisted viewport. Live node/edge edits are mirrored
  // between same-browser windows via a BroadcastChannel (the socket path filters
  // out same-user events, so two windows of one user wouldn't otherwise sync).
  const isPopout = useMemo(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("popout"), []);
  const popoutVpKey = `ui:canvas:popoutViewport:${projectId}`;
  const bcRef = useRef<BroadcastChannel | null>(null);
  // Toolbar & minimap layout persists across reloads. Keys are namespaced
  // `ui:*` so the localStorage admin can grep for them. The validate fn
  // discards corrupted payloads (e.g. partial migrations) rather than
  // crashing the app — falls back to the default.
  // Floating toolbar: free {x,y} position (drop anywhere) + explicit orientation.
  // `x:-1` = "not yet placed" → defaults to bottom-center on first paint.
  const [toolbarPos, setToolbarPos] = usePersistentState<{ x: number; y: number }>(
    "ui:toolbar:pos:v2",
    { x: -1, y: -1 },
    { validate: (v) => { const o = v as { x?: unknown; y?: unknown }; return o && typeof o.x === "number" && typeof o.y === "number" ? { x: o.x, y: o.y } : null; } },
  );
  const [toolbarOrient, setToolbarOrient] = usePersistentState<"h" | "v">(
    "ui:toolbar:orient:v1",
    "h",
    { validate: (v) => (v === "h" || v === "v" ? v : null) },
  );
  // Collapse the toolbar to just the essentials (add / zoom / run / skin), folding away
  // the less-used tools (orientation, grid, fit, layout, snap, region-zoom, help).
  const [toolbarCollapsed, setToolbarCollapsed] = usePersistentState<boolean>(
    // 手机首访默认折叠（占屏太多）；用户手动展开后按持久化值走。
    "ui:toolbar:collapsed:v1", typeof window !== "undefined" && window.innerWidth < 768,
    { validate: (v) => (typeof v === "boolean" ? v : null) },
  );
  const [mmPos, setMmPos] = usePersistentState<{ bottom: number; right: number }>(
    "ui:minimap:pos:v1",
    { bottom: 80, right: 8 },
    { validate: (v) => {
      if (!v || typeof v !== "object") return null;
      const o = v as { bottom?: unknown; right?: unknown };
      return typeof o.bottom === "number" && typeof o.right === "number"
        ? { bottom: o.bottom, right: o.right }
        : null;
    } },
  );
  const [mmSize, setMmSize] = usePersistentState<{ w: number; h: number }>(
    "ui:minimap:size:v1",
    { w: 200, h: 140 },
    { validate: (v) => {
      if (!v || typeof v !== "object") return null;
      const o = v as { w?: unknown; h?: unknown };
      return typeof o.w === "number" && typeof o.h === "number" && o.w > 50 && o.h > 30
        ? { w: o.w, h: o.h }
        : null;
    } },
  );
  const mmDragRef = useRef<{ sx: number; sy: number; sb: number; sr: number } | null>(null);
  const mmResizeRef = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null);

  // Keep the floating minimap + toolbar on-screen when the window shrinks (e.g.
  // exiting F11). Persisted pixel offsets from a larger window can push them off
  // the smaller viewport otherwise.
  useEffect(() => {
    const fix = () => {
      setMmPos((p) => ({
        bottom: Math.max(4, Math.min(p.bottom, Math.max(4, window.innerHeight - mmSize.h - 4))),
        right: Math.max(4, Math.min(p.right, Math.max(4, window.innerWidth - mmSize.w - 4))),
      }));
      setToolbarPos((p) => {
        if (p.x < 0) return p; // unplaced — leave the sentinel for default placement
        return { x: Math.max(0, Math.min(p.x, window.innerWidth - 80)), y: Math.max(0, Math.min(p.y, window.innerHeight - 40)) };
      });
    };
    window.addEventListener("resize", fix);
    fix();
    return () => window.removeEventListener("resize", fix);
  }, [setMmPos, setToolbarPos, mmSize.h, mmSize.w]);
  const [renamingProject, setRenamingProject] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false); // in-flight save mutex (prevents concurrent saveCanvas)
  // Guards so the DB snapshot is applied to local state only once (initial load);
  // later, local state is the source of truth and a query refetch must not clobber
  // it. Reset per project because Canvas is keyed by projectId (remounts).
  const nodesLoadedRef = useRef(false);
  const edgesLoadedRef = useRef(false);
  // #122 空态门槛：节点快照已灌入 store（与 setNodes 同批提交，见加载 effect 注释）。
  const [nodesHydrated, setNodesHydrated] = useState(false);
  const saveCanvasRef = useRef<(() => Promise<void>) | null>(null);
  // Baseline of what each node looked like at last successful save/load (id → sig).
  // saveCanvas upserts only nodes whose sig changed and deletes ids that vanished.
  const savedNodeSigsRef = useRef<Map<string, string>>(new Map());
  // 同理为边保存基线：仅 upsert 变化的边、删除已消失的边（对账）。
  const savedEdgeSigsRef = useRef<Map<string, string>>(new Map());

  // ── Data loading ────────────────────────────────────────────────────────────
  const { data: project, isLoading: projectLoading, isError: projectError, error: projectErr, refetch: refetchProject, isFetching: projectFetching } = trpc.projects.get.useQuery(
    { id: projectId }, { enabled: !!projectId && isAuthenticated, retry: false }
  );
  const effectiveRole = (project as { role?: "owner" | "viewer" | "editor" | "admin" } | undefined)?.role ?? "viewer";
  const isReadOnly = effectiveRole === "viewer";
  const { data: dbNodes } = trpc.nodes.list.useQuery(
    { projectId }, { enabled: !!projectId && isAuthenticated }
  );
  const { data: dbEdges } = trpc.edges.list.useQuery(
    { projectId }, { enabled: !!projectId && isAuthenticated }
  );

  // ── 进入画布的读取进度条 ──────────────────────────────────────────────────
  // 项目 → 节点 → 连线 → 渲染 分段推进；大画布节点多时不再「像卡住一样干等」。
  // 180ms 内全部就绪（小画布）则完全不闪进度层。
  const [bootPct, setBootPct] = useState(12);
  const [bootDone, setBootDone] = useState(false);
  const [bootVisible, setBootVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setBootVisible(true), 180); return () => clearTimeout(t); }, []);
  useEffect(() => {
    let pct = 12;
    if (project) pct = 35;
    if (project && dbNodes) pct = 78;
    if (project && dbNodes && dbEdges) pct = 94;
    setBootPct((p) => Math.max(p, pct));
    if (project && dbNodes && dbEdges) {
      // 等一拍让 React Flow 把节点画出来，再推满并淡出。
      const t = setTimeout(() => { setBootPct(100); const t2 = setTimeout(() => setBootDone(true), 320); return () => clearTimeout(t2); }, 80);
      return () => clearTimeout(t);
    }
  }, [project, dbNodes, dbEdges]);
  const bootLabel = !project ? "读取项目…"
    : !dbNodes ? "读取节点数据…"
    : !dbEdges ? `读取连线（已载入 ${dbNodes.length} 个节点）…`
    : `渲染 ${dbNodes.length} 个节点…`;

  // 全局角色库 → 灌进「影子节点」，让 @引用 无需先把角色拖到画布也能命中库里的角色。
  const { data: libraryChars } = trpc.characterLibrary.list.useQuery(undefined, {
    enabled: isAuthenticated, refetchOnWindowFocus: true,
  });
  useEffect(() => {
    setLibraryCharacters(
      (libraryChars ?? []).map((it) => ({
        id: "lib:" + it.id,
        data: {
          nodeType: "character",
          // 用库里的 name 覆盖 payload，确保改名后仍以最新名字被 @ 命中。
          payload: {
            ...(it.payload as Record<string, unknown>),
            characterKind: it.characterKind,
            ...(it.characterKind === "scene" ? { sceneName: it.name } : { name: it.name }),
          },
        },
      })),
    );
  }, [libraryChars]);

  // 提示词库 → 灌进客户端镜像，让「/」快捷菜单 / 提示词库面板无需各自订阅 tRPC。
  const { data: promptLib } = trpc.promptLibrary.list.useQuery(undefined, {
    enabled: isAuthenticated, refetchOnWindowFocus: true,
  });
  useEffect(() => { setPromptLibrary((promptLib ?? []).map((it) => ({ ...it }))); }, [promptLib]);

  const utils = trpc.useUtils();
  const createComfyTemplateMut = trpc.comfyTemplates.create.useMutation();
  const updateComfyTemplateMut = trpc.comfyTemplates.update.useMutation();
  const batchUpsertNodes = trpc.nodes.batchUpsert.useMutation();
  const upsertEdge = trpc.edges.upsert.useMutation();
  const deleteNodeMutation = trpc.nodes.delete.useMutation({
    onError: (e) => toast.error("删除节点失败（服务端拒绝）：" + e.message),
  });
  const deleteEdgeMutation = trpc.edges.delete.useMutation();
  const updateProject = trpc.projects.update.useMutation({
    onSuccess: () => {
      utils.projects.get.invalidate({ id: projectId });
      utils.projects.list.invalidate();
    },
  });

  // 项目级「节点默认模型」配置 + 持久化。新建节点据此取默认模型；工具栏弹层可改。
  const defaultModelsConfig =
    (project as { defaultModels?: NodeDefaultModelsConfig | null } | undefined)?.defaultModels ?? null;
  // 管理员「系统默认模型」：作用于项目配置与出厂默认之间（详见 NodeDefaultModelsProvider）。
  const systemDefaultModels = useSystemDefaultModels();
  // 顶栏窄屏信号：给余额/模型块在窄屏收起文字标签，腾横向空间。
  const topbarNarrow = useTopbarNarrow();
  // 移动端（触屏窄屏）判断：仅用于开启单指平移等触屏友好行为，绝不改动桌面端逻辑。
  const isMobile = useIsMobile();
  // 「快速创作栏」折叠状态（底部工具栏那枚按钮控制 StudioCreateBar 展开/收起）。
  const { uiStyle } = useUIStyle();
  const [createBarCollapsed] = useStudioCreateBarCollapsed();
  const handleDefaultModelsChange = useCallback(
    (next: NodeDefaultModelsConfig) => {
      // 乐观更新：先写入 query 缓存让节点解析即时生效，再持久化到项目。
      utils.projects.get.setData({ id: projectId }, (prev) =>
        prev ? ({ ...prev, defaultModels: next } as typeof prev) : prev,
      );
      updateProject.mutate({ id: projectId, defaultModels: next });
    },
    [projectId, updateProject, utils],
  );
  const saveAsMutation = trpc.projects.saveAs.useMutation({
    onSuccess: (proj) => { utils.projects.list.invalidate(); if (proj) navigate(`/canvas/${proj.id}`); },
    onError: (e) => toast.error("另存为失败：" + e.message),
  });
  const handleSaveAs = useCallback(async () => {
    if (saveAsMutation.isPending) return;
    const def = `${project?.name ?? "画布"} 副本`;
    const name = window.prompt("另存为新项目，输入名称：", def)?.trim();
    if (!name) return;
    // Persist any pending edits first so the copy includes them.
    try { await saveCanvasRef.current?.(); } catch { /* non-fatal */ }
    await saveAsMutation.mutateAsync({ sourceProjectId: projectId, name });
    toast.success(`已另存为「${name}」`);
  }, [project?.name, projectId, saveAsMutation]);

  // Reset canvas store on unmount to prevent stale nodes polluting next canvas
  useEffect(() => {
    setProjectId(projectId);
    return () => { resetCanvas(); };
  }, [projectId, setProjectId, resetCanvas]);

  // Keep the store's current-user id in sync so nodes created here are stamped
  // with their author (drives the per-creator collaborator color dot).
  useEffect(() => {
    useCanvasStore.getState().setCurrentUserId(user?.id ?? null);
  }, [user?.id]);

  useEffect(() => {
    if (!dbNodes) return;
    // Apply the DB snapshot ONCE (initial load). `nodes.list` uses React Query's
    // default refetchOnWindowFocus, so without this guard a focus-triggered
    // refetch would overwrite local state — resurrecting a just-deleted node
    // (not yet reconciled to the server) which would then be re-upserted by the
    // save. Remote changes arrive via the collaboration socket, not this query.
    if (nodesLoadedRef.current) return;
    nodesLoadedRef.current = true;
    const flowNodes: CanvasNode[] = dbNodes.map((n) => {
      const cfg = getNodeConfig(n.type as NodeType);
      // Decide whether to apply the stored height to React Flow's style.
      // For content-driven node types (no `defaultHeight` in config), addNode
      // omits style.height so content drives node size. Auto-save stores 0
      // as a sentinel for "no explicit height" (new path), but legacy rows
      // saved before the fix carry height=200 (the historical fallback) —
      // applying 200 would lock the node at 200px and break expansion. Treat
      // both 0 and 200 as "no explicit height" for content-driven types.
      const isLegacyFallback = n.height === 200;
      const useStoredHeight =
        cfg.defaultHeight !== undefined ||
        (n.height > 0 && !isLegacyFallback);
      const style: React.CSSProperties = { width: n.width };
      if (useStoredHeight) {
        // A fixed-height node (config.defaultHeight) saved with height 0 — agent
        // nodes were created without an explicit style.height, so auto-save stored
        // 0 and applying it rendered the node at 0px (invisible). Fall back to the
        // config's defaultHeight so such nodes show after reload.
        style.height = n.height > 0 ? n.height : (cfg.defaultHeight ?? n.height);
      }
      return {
        id: n.id, type: "custom",
        position: { x: n.posX, y: n.posY },
        data: { nodeType: n.type as NodeType, title: n.title ?? cfg.defaultTitle, payload: (n.data as Record<string, unknown>) ?? {}, projectId },
        style,
        zIndex: n.zIndex,
      };
    });
    setNodes(flowNodes);
    // Seed the save baseline so unchanged loaded nodes are never re-upserted.
    savedNodeSigsRef.current = new Map(flowNodes.map((n) => [n.id, nodeSig(n)]));
    // #122 二次修正：空态判定的「水合完成」标志。此前用 dbNodes 就绪当门槛仍会闪——
    // 数据已返回但尚未灌进 store 的渲染空窗里「就绪 + 本地为空」恰好成立。此标志与
    // setNodes 同一 effect 同批提交，与 store nodes 永远同帧一致，结构性消除空窗。
    setNodesHydrated(true);
  }, [dbNodes]);

  useEffect(() => {
    if (!dbEdges || !dbNodes) return;
    if (edgesLoadedRef.current) return; // apply DB snapshot once; later local state is source of truth (see nodes effect)
    edgesLoadedRef.current = true;
    // Migration: 5 processing nodes (merge / subtitle / subtitle_motion /
    // pose_control / smart_cut) previously rendered `input` at Position.Top and
    // `output` at Position.Bottom via showHandles={false}. They now use
    // BaseNode's default handles where `input` is at Left and `top` is at Top.
    // Rewrite legacy `input`/`output` ports on edges that target/source these
    // node types so existing projects keep their visual top→bottom wiring.
    const LEGACY_VERTICAL_NODES = new Set([
      "merge", "subtitle", "subtitle_motion", "pose_control", "smart_cut",
    ]);
    const nodeTypeById = new Map(dbNodes.map((n) => [n.id, n.type as string]));
    const nodeDataById = new Map(dbNodes.map((n) => [n.id, (n.data as Record<string, unknown>) ?? {}]));
    const flowEdges: CanvasEdge[] = dbEdges.map((e) => {
      // clip 无 `input` 桩，缺省端口时按目标类型推默认输入桩（clip→video-in/audio-in），
      // 否则历史里缺端口的剪辑入边会落到不存在的 `input` 桩、加载后不可见。
      // 音频源判定与连线期一致（复用 isAudioAssetSource），使「音频 asset→clip」缺端口的
      // 历史边也落到 audio-in，而非 video-in（加载与连线/保存口径对称）。
      const srcType = nodeTypeById.get(e.sourceNodeId) as NodeType | undefined;
      const srcIsAudio = isAudioAssetSource(
        { data: { nodeType: srcType, payload: nodeDataById.get(e.sourceNodeId) ?? {} } } as unknown as CanvasNode,
      );
      let targetHandle = e.targetPort ?? defaultTargetHandle(
        nodeTypeById.get(e.targetNodeId) as NodeType | undefined,
        srcType,
        srcIsAudio,
      );
      let sourceHandle = e.sourcePort ?? "output";
      if (targetHandle === "input" && LEGACY_VERTICAL_NODES.has(nodeTypeById.get(e.targetNodeId) ?? "")) {
        targetHandle = "top";
      }
      if (sourceHandle === "output" && LEGACY_VERTICAL_NODES.has(nodeTypeById.get(e.sourceNodeId) ?? "")) {
        sourceHandle = "bottom";
      }
      return {
        id: e.id, type: "custom",
        source: e.sourceNodeId, target: e.targetNodeId,
        sourceHandle, targetHandle,
        label: e.label ?? undefined,
      };
    });
    // 清理历史重复边：同一「源→目标→目标桩」只保留第一条（修复此前可能积累的重叠重复连线）。
    // 必须带上 targetHandle——剪辑节点的 video-in / audio-in 是两个独立输入，同源的
    // 视频边与音频边合法共存，按「源→目标」去重会把其中一条误删（加载后丢线）。
    const seenPair = new Set<string>();
    const dedupedEdges = flowEdges.filter((e) => {
      const k = `${e.source}->${e.target}->${e.targetHandle ?? ""}`;
      if (seenPair.has(k)) return false;
      seenPair.add(k);
      return true;
    });
    setEdges(dedupedEdges);
    // 播种保存基线：加载的边未改动则不再重复 upsert，也不会被误删。
    savedEdgeSigsRef.current = new Map(dedupedEdges.map((e) => [e.id, edgeSig(e)]));
  }, [dbEdges, dbNodes]);

  // Restore the saved viewport ONCE on initial load. Previously this re-ran on
  // every `project` refetch (e.g. after auto-save invalidates the query), which
  // snapped the canvas back mid-pan — "画布自己突然移动". Canvas is keyed by
  // projectId (remounts per project), so a per-mount ref guard is sufficient.
  const viewportRestoredRef = useRef(false);
  const viewportScheduledRef = useRef(false);
  const reactFlowReadyRef = useRef(false);
  // Apply the saved pan/zoom (or fit a fresh project) exactly ONCE — only after BOTH
  // ReactFlow has initialized (onInit) AND the project + nodes have loaded. Doing it
  // before init silently no-ops (setViewport needs the rendered flow); doing it
  // before data loads has nothing to restore. `fitView` is disabled on the flow so
  // this is the single source of truth. Called from onInit and from the effect
  // below, whichever happens last wins (guarded so it runs once).
  const applyInitialViewport = useCallback(() => {
    if (viewportRestoredRef.current || viewportScheduledRef.current) return;
    if (!reactFlowReadyRef.current) return;
    if (project === undefined || dbNodes === undefined) return;
    viewportScheduledRef.current = true; // sync guard: prevent onInit+effect double-schedule
    // viewportState is a JSON column — MySQL returns it parsed (object) but some
    // drivers (e.g. MariaDB) return it as a JSON string, so handle both. A popout
    // window restores its OWN (localStorage) viewport instead of the shared one.
    let vpRaw: unknown = project?.viewportState;
    if (isPopout) { try { vpRaw = JSON.parse(localStorage.getItem(popoutVpKey) ?? "null"); } catch { vpRaw = null; } }
    if (typeof vpRaw === "string") { try { vpRaw = JSON.parse(vpRaw); } catch { vpRaw = null; } }
    const vp = vpRaw as { x: number; y: number; zoom: number } | null | undefined;
    const valid = !!vp && typeof vp.x === "number" && typeof vp.y === "number" && typeof vp.zoom === "number";
    // Defer a frame so the rendered flow has its dimensions before we set/fit.
    // Mark restored ONLY after the viewport actually lands — otherwise an onMoveEnd
    // firing in the gap would markDirty and persist the un-restored viewport.
    requestAnimationFrame(() => {
      if (valid) reactFlow.setViewport(vp!, { duration: 0 });
      else reactFlow.fitView({ padding: 0.2 });
      viewportRestoredRef.current = true;
    });
  }, [project, dbNodes, reactFlow]);
  useEffect(() => { applyInitialViewport(); }, [applyInitialViewport]);

  // ── Auto-save ───────────────────────────────────────────────────────────────
  const saveCanvas = useCallback(async () => {
    if (isReadOnly) return; // read-only collaborators must never write (server also rejects)
    if (!isDirty) return;
    if (savingRef.current) return; // in-flight mutex: never run two saves concurrently
    savingRef.current = true;
    try {
    // Each part saves INDEPENDENTLY so a failure in one (e.g. a node the DB schema
    // rejects) can't block the others — previously a failed node-batch threw before
    // the viewport save, so neither the agent node NOR the pan/zoom persisted.
    const currentSigs = new Map(nodes.map((n) => [n.id, nodeSig(n)]));
    const baseline = savedNodeSigsRef.current;
    const toUpsert = nodes.filter((n) => baseline.get(n.id) !== currentSigs.get(n.id));
    let toDelete = Array.from(baseline.keys()).filter((id) => !currentSigs.has(id));
    // Data-loss safety valve: if the local node set is suspiciously empty while the
    // baseline had nodes, this is almost certainly a transient/incomplete snapshot
    // (load race, reset mid-flight), NOT a real "delete everything" — skip deletion
    // so we never nuke the project's nodes from a bad snapshot. 边删除也共用此守卫。
    const suspiciousSnapshot = currentSigs.size === 0 && baseline.size > 0;
    if (toDelete.length > 0 && suspiciousSnapshot) {
      console.warn("[save] skipping suspicious bulk delete (local nodes empty, baseline non-empty)");
      toDelete = [];
    }

    let nodesOk = true;
    for (const id of toDelete) {
      try { await deleteNodeMutation.mutateAsync({ id, projectId }); }
      catch (e) { nodesOk = false; console.error("[save] delete node failed:", id, e); }
    }
    if (toUpsert.length > 0) {
      try {
        await batchUpsertNodes.mutateAsync(toUpsert.map((n) => ({ id: n.id, projectId, ...nodeUpsertFields(n) })));
      } catch (err) {
        nodesOk = false;
        console.error("[save] node upsert failed:", err);
        toast.error("节点保存失败：" + (err instanceof Error ? err.message : String(err)));
      }
    }
    // Edges + viewport persist regardless of node-save outcome. 与节点对称做「增量 upsert +
    // 删除对账」：仅推送签名变化的边、删除本地已消失的边（修复删边刷新后复活）。
    const currentEdgeSigs = new Map(edges.map((e) => [e.id, edgeSig(e)]));
    let edgesOk = true;
    try {
      const edgeBaseline = savedEdgeSigsRef.current;
      const edgesToUpsert = edges.filter((e) => edgeBaseline.get(e.id) !== currentEdgeSigs.get(e.id));
      let edgesToDelete = Array.from(edgeBaseline.keys()).filter((id) => !currentEdgeSigs.has(id));
      if (edgesToDelete.length > 0 && suspiciousSnapshot) edgesToDelete = []; // 同守卫：可疑快照不删
      for (const id of edgesToDelete) {
        try { await deleteEdgeMutation.mutateAsync({ id, projectId }); }
        catch (e) { edgesOk = false; console.error("[save] delete edge failed:", id, e); }
      }
      for (const edge of edgesToUpsert) {
        await upsertEdge.mutateAsync({
          id: edge.id, projectId, sourceNodeId: edge.source, targetNodeId: edge.target,
          sourcePort: edge.sourceHandle ?? "output", targetPort: edge.targetHandle ?? "input",
          label: typeof edge.label === "string" ? edge.label : undefined,
        });
      }
    } catch (e) { edgesOk = false; console.error("[save] edge save failed:", e); }
    try {
      // A popout window keeps its viewport local (independent second-monitor view)
      // so it never clobbers the main window's shared, server-persisted viewport.
      if (isPopout) localStorage.setItem(popoutVpKey, JSON.stringify(reactFlow.getViewport()));
      else await updateProject.mutateAsync({ id: projectId, viewportState: reactFlow.getViewport() });
    } catch (e) { console.error("[save] viewport save failed:", e); }

    // Only advance a baseline when its ops landed, so failures retry next save.
    // markClean 需节点与边都成功——否则删失败的边会被漏掉、不再重试。
    if (nodesOk) savedNodeSigsRef.current = currentSigs;
    if (edgesOk) savedEdgeSigsRef.current = currentEdgeSigs;
    if (nodesOk && edgesOk) markClean();
    } finally { savingRef.current = false; }
  }, [isReadOnly, isDirty, nodes, edges, projectId, batchUpsertNodes, upsertEdge, updateProject, markClean, reactFlow, deleteNodeMutation, deleteEdgeMutation]);
  saveCanvasRef.current = saveCanvas;

  useEffect(() => {
    if (!isDirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(saveCanvas, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [isDirty, saveCanvas]);

  // Flush a pending (debounced) save when leaving the canvas — logout, navigation,
  // or tab close. The 2s debounce timer above is cleared on unmount, so without
  // this any node added/edited within ~2s of leaving would never persist and would
  // vanish on next load (most often the agent node: users add it, chat, then leave
  // quickly). saveCanvasRef holds the latest saveCanvas (with current nodes/edges)
  // and self-guards on isReadOnly/isDirty.
  useEffect(() => {
    const flush = () => { if (useCanvasStore.getState().isDirty) void saveCanvasRef.current?.(); };
    window.addEventListener("beforeunload", flush);
    return () => { window.removeEventListener("beforeunload", flush); flush(); };
  }, []);

  // ── Socket ──────────────────────────────────────────────────────────────────
  const emitCollabEvent = useCallback((type: string, payload: unknown) => {
    // Mirror to same-browser windows (multi-monitor) regardless of socket state.
    try { bcRef.current?.postMessage({ type, payload }); } catch { /* channel closed */ }
    if (!socketRef.current?.connected || !user) return;
    socketRef.current.emit("collaboration-event", {
      type, projectId, userId: user.id,
      userName: user.name ?? "匿名",
      color: COLLABORATOR_COLORS[user.id % COLLABORATOR_COLORS.length],
      payload,
    });
  }, [user, projectId]);

  // 把一次批量操作（复制/粘贴/组合/变体/导入）新增的节点与边广播给协作者（#86）——此前这些操作
  // 只改本地 store、不 emit，协作者要保存刷新才见。传入操作前的 id 集合，操作后 diff 出新增项，
  // 逐个 emit node:add / edge:add（与手动建节点一致）。防回声同 #85：远端 apply 走 setNodes 不回传。
  const snapshotGraphIds = useCallback((): { n: Set<string>; e: Set<string> } => {
    const st = useCanvasStore.getState();
    return { n: new Set(st.nodes.map((x) => x.id)), e: new Set(st.edges.map((x) => x.id)) };
  }, []);
  const emitGraphAdditions = useCallback((before: { n: Set<string>; e: Set<string> }) => {
    const st = useCanvasStore.getState();
    for (const nd of st.nodes) if (!before.n.has(nd.id)) emitCollabEvent("node:add", nd);
    for (const ed of st.edges) if (!before.e.has(ed.id)) emitCollabEvent("edge:add", ed);
  }, [emitCollabEvent]);

  // 撤销/重做把整图替换为历史快照——用全量 diff 广播给协作者（#87），否则本地回退后与协作者分叉。
  // 新增/变化的节点用 node:add 整体替换（applyRemoteMutation 的 node:add 会 filter+add 覆盖），
  // 消失的用 node:delete；边同理 add/delete。防回声同前：远端 apply 走 setNodes 不回传。
  const snapshotGraphSigs = useCallback(() => {
    const st = useCanvasStore.getState();
    return {
      nodes: new Map(st.nodes.map((n) => [n.id, nodeSig(n)])),
      edges: new Map(st.edges.map((e) => [e.id, edgeSig(e)])),
    };
  }, []);
  const emitGraphDiff = useCallback((before: { nodes: Map<string, string>; edges: Map<string, string> }) => {
    const st = useCanvasStore.getState();
    const afterNodeIds = new Set(st.nodes.map((n) => n.id));
    for (const id of Array.from(before.nodes.keys())) if (!afterNodeIds.has(id)) emitCollabEvent("node:delete", { id });
    for (const n of st.nodes) if (before.nodes.get(n.id) !== nodeSig(n)) emitCollabEvent("node:add", n);
    const afterEdgeIds = new Set(st.edges.map((e) => e.id));
    for (const id of Array.from(before.edges.keys())) if (!afterEdgeIds.has(id)) emitCollabEvent("edge:delete", { id });
    for (const e of st.edges) if (!before.edges.has(e.id)) emitCollabEvent("edge:add", e);
  }, [emitCollabEvent]);

  // 协作撤销/重做：undo/redo 用整张本地快照替换当前图，多人协同时会连带回退协作者的并发改动。
  // 有协作者在线时首次撤销给一条一次性警示（不阻断）；撤销/重做后用全量 diff 广播给协作者（#87）。
  const collabUndoWarnedRef = useRef(false);
  // 协作者全部离线时复位一次性警告，使下次有人在线撤销时能再次提醒（此前置 true 后永不复位）。
  useEffect(() => { if (collaborators.size === 0) collabUndoWarnedRef.current = false; }, [collaborators.size]);
  const handleUndo = useCallback(() => {
    if (useCanvasStore.getState().collaborators.size > 0 && !collabUndoWarnedRef.current) {
      collabUndoWarnedRef.current = true;
      toast.warning("撤销会影响整张协作画布", { description: "当前有协作者在线，撤销可能一并回退他人的并发改动。", duration: 5000 });
    }
    const before = snapshotGraphSigs();
    undo();
    emitGraphDiff(before); // 把撤销结果广播给协作者，避免本地回退后与其分叉
    toast.info("已撤销", { duration: 1200 });
  }, [undo, collaborators, snapshotGraphSigs, emitGraphDiff]);
  const handleRedo = useCallback(() => {
    const before = snapshotGraphSigs();
    redo();
    emitGraphDiff(before);
    toast.info("已重做", { duration: 1200 });
  }, [redo, snapshotGraphSigs, emitGraphDiff]);

  // 协作实时同步：把本地的节点配置/标题改动广播给协作者（#85）。updateNodeData/updateNodeTitle
  // 经 store 的注册钩子回调到这里；按节点节流(400ms)合并补丁，减少高频输入(如逐字打提示词)的洪泛。
  // 远端改动经 applyRemoteMutation 的 setNodes 落地、不经 updateNodeData，故不会回声成环。
  useEffect(() => {
    const pending = new Map<string, { patch: Record<string, unknown>; title?: string }>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const flush = (id: string) => {
      const acc = pending.get(id); pending.delete(id);
      const t = timers.get(id); if (t) clearTimeout(t); timers.delete(id);
      if (!acc) return;
      if (acc.patch && Object.keys(acc.patch).length) emitCollabEvent("node:update", { id, patch: acc.patch });
      if (acc.title !== undefined) emitCollabEvent("node:title", { id, title: acc.title });
    };
    registerNodeMutationBroadcaster((m) => {
      if (m.kind === "add") { // 变体等新增节点/边：立即广播，不进节流
        for (const nd of m.nodes) emitCollabEvent("node:add", nd);
        for (const ed of m.edges) emitCollabEvent("edge:add", ed);
        return;
      }
      const acc = pending.get(m.id) ?? { patch: {} };
      if (m.kind === "update") acc.patch = { ...acc.patch, ...m.patch };
      else acc.title = m.title;
      pending.set(m.id, acc);
      const prev = timers.get(m.id); if (prev) clearTimeout(prev);
      timers.set(m.id, setTimeout(() => flush(m.id), 400));
    });
    return () => {
      // 卸载前把未发的补丁 flush 掉，避免最后一次编辑丢广播；再注销钩子。
      for (const id of Array.from(pending.keys())) flush(id);
      for (const t of Array.from(timers.values())) clearTimeout(t);
      registerNodeMutationBroadcaster(null);
    };
  }, [emitCollabEvent]);

  // #11 协作编辑锁：当本地用户「聚焦」到单个节点时广播「正在编辑 nodeId」，供其他人在该
  // 节点角标显示头像 + 柔性锁；选中 0 个或多个节点则广播释放（null）。仅在单选目标变化时发。
  const lastEditingRef = useRef<string | null>(null);
  useEffect(() => {
    const sel = nodes.filter((n) => n.selected);
    const editingId = sel.length === 1 ? sel[0].id : null;
    if (editingId === lastEditingRef.current) return;
    lastEditingRef.current = editingId;
    emitCollabEvent("node:editing", { nodeId: editingId });
  }, [nodes, emitCollabEvent]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const socket = io("/", { path: "/api/socket", transports: ["websocket", "polling"], withCredentials: true, auth: { deviceFp: getDeviceFingerprint() ?? undefined } });
    socket.on("connect", () => {
      setSocketConnected(true);
      socket.emit("join-project", { projectId, userName: user.name ?? "匿名", color: COLLABORATOR_COLORS[user.id % COLLABORATOR_COLORS.length] });
    });
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", (err) => {
      setSocketConnected(false);
      if (err.message === "unauthenticated") {
        console.warn("[Socket] Authentication failed — collaboration disabled");
      }
    });
    socket.on("auth-error", (e: { code: string; projectId: number }) => {
      console.warn("[Socket] auth-error", e);
    });
    // Shared apply logic for peer node/edge mutations — used by BOTH the socket
    // (cross-device collaborators) and the BroadcastChannel (same-browser windows
    // on a second monitor). Pulled out so the two transports stay in lockstep.
    const applyRemoteMutation = (event: { type: string; payload: unknown }) => {
      // Node/edge mutations from peers: ignore until our OWN DB snapshot has loaded —
      // otherwise the load-once setNodes would clobber an early remote change (or vice
      // versa), diverging collaborators. Apply WITHOUT markDirty (the author already
      // persisted it) and keep the save baseline in sync so our local diff never
      // re-persists or re-deletes a peer's node (was: every receiver re-wrote the row).
      if (!nodesLoadedRef.current) return;
      const store = useCanvasStore.getState();
      const syncBaseline = (id: string) => {
        const n = useCanvasStore.getState().nodes.find((x) => x.id === id);
        if (n) savedNodeSigsRef.current.set(id, nodeSig(n)); else savedNodeSigsRef.current.delete(id);
      };
      if (event.type === "node:move") {
        const p = event.payload as { id: string; x: number; y: number };
        store.setNodes(store.nodes.map((n) => n.id === p.id ? { ...n, position: { x: p.x, y: p.y } } : n));
        syncBaseline(p.id);
      } else if (event.type === "node:add") {
        const newNode = event.payload as CanvasNode;
        store.setNodes([...store.nodes.filter((n) => n.id !== newNode.id), newNode]);
        syncBaseline(newNode.id);
      } else if (event.type === "node:delete") {
        const p = event.payload as { id: string };
        store.setNodes(store.nodes.filter((n) => n.id !== p.id));
        store.setEdges(store.edges.filter((e) => e.source !== p.id && e.target !== p.id));
        savedNodeSigsRef.current.delete(p.id);
      } else if (event.type === "node:update") {
        const p = event.payload as { id: string; patch: Record<string, unknown> };
        store.setNodes(store.nodes.map((n) =>
          n.id === p.id ? { ...n, data: { ...n.data, payload: { ...n.data.payload, ...p.patch } } } : n
        ) as CanvasNode[]);
        syncBaseline(p.id);
      } else if (event.type === "node:title") {
        const p = event.payload as { id: string; title: string };
        store.setNodes(store.nodes.map((n) =>
          n.id === p.id ? { ...n, data: { ...n.data, title: p.title } } : n
        ) as CanvasNode[]);
        syncBaseline(p.id);
      } else if (event.type === "edge:add") {
        const newEdge = event.payload as CanvasEdge;
        if (!store.edges.find((e) => e.id === newEdge.id)) store.setEdges([...store.edges, newEdge]);
      } else if (event.type === "edge:delete") {
        const p = event.payload as { id: string };
        store.setEdges(store.edges.filter((e) => e.id !== p.id));
      }
    };

    socket.on("collaboration-event", (event: { type: string; userId: number; userName: string; color: string; payload: unknown }) => {
      if (event.userId === user.id) return;
      if (event.type === "cursor:move") {
        const p = event.payload as { x: number; y: number };
        setCollaborator({ userId: event.userId, userName: event.userName, color: event.color, x: p.x, y: p.y });
        return;
      }
      if (event.type === "user:leave") { removeCollaborator(event.userId); return; }
      if (event.type === "node:editing") {
        const p = event.payload as { nodeId: string | null };
        useCanvasStore.getState().setPeerEditing(event.userId, event.userName, event.color, p?.nodeId ?? null);
        return;
      }
      applyRemoteMutation(event);
    });

    // Same-browser window sync (multi-monitor). Note: a BroadcastChannel never
    // receives its own posts, so no self-echo filtering is needed.
    try {
      const bc = new BroadcastChannel(`canvas-sync:${projectId}`);
      bc.onmessage = (e: MessageEvent) => { const d = e.data as { type?: string; payload?: unknown }; if (d?.type) applyRemoteMutation({ type: d.type, payload: d.payload }); };
      bcRef.current = bc;
    } catch { /* BroadcastChannel unsupported — socket still covers cross-device */ }

    // 画布助手共享对话被协作者更新：转发为 window 事件，CanvasAgentChat 收到后从服务器权威重载。
    socket.on("agent:history-updated", (e: { projectId: number; byUserId: number }) => {
      if (e?.projectId === projectId) window.dispatchEvent(new CustomEvent("avc:agent-history-updated", { detail: e }));
    });
    socket.on("comfyui:progress", (event: { nodeId: string; type: string; value?: number; max?: number; preview?: string; queueRemaining?: number }) => {
      if (event.type === "progress" && event.value != null && event.max != null && event.max > 0) {
        const pct = Math.round((event.value / event.max) * 100);
        // Sampling has started → clear any "排队中" hint.
        useCanvasStore.getState().updateNodeData(event.nodeId, { progress: pct, queueRemaining: 0 }, true);
      } else if (event.type === "preview" && typeof event.preview === "string") {
        // Live sampling preview — kept in a transient store (never persisted).
        useComfyPreviewStore.getState().setPreview(event.nodeId, event.preview);
      } else if (event.type === "queue" && typeof event.queueRemaining === "number") {
        useCanvasStore.getState().updateNodeData(event.nodeId, { queueRemaining: event.queueRemaining }, true);
      }
    });
    // 工程智能体（super_agent）活动日志：把服务端 emit 的事件追加到目标节点的 log（transient）。
    socket.on("superagent:event", (msg: { nodeId: string | null; event: { type: string; iteration: number; message: string } }) => {
      if (!msg?.nodeId) return;
      const node = useCanvasStore.getState().nodes.find((n) => n.id === msg.nodeId);
      if (!node) return;
      const prev = ((node.data.payload as { log?: { type: string; iteration: number; message: string }[] }).log) ?? [];
      const next = [...prev, { type: msg.event.type, iteration: msg.event.iteration, message: msg.event.message }].slice(-200);
      useCanvasStore.getState().updateNodeData(msg.nodeId, { log: next }, true);
    });
    socketRef.current = socket;
    return () => { socket.emit("leave-project", { projectId }); socket.disconnect(); bcRef.current?.close(); bcRef.current = null; };
  }, [isAuthenticated, user, projectId]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!socketRef.current?.connected || !user) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    socketRef.current.emit("collaboration-event", {
      type: "cursor:move", projectId, userId: user.id, userName: user.name ?? "匿名",
      color: COLLABORATOR_COLORS[user.id % COLLABORATOR_COLORS.length],
      payload: { x: (e.clientX - rect.left - viewport.x) / viewport.zoom, y: (e.clientY - rect.top - viewport.y) / viewport.zoom },
    });
  }, [user, projectId, viewport]);

  // ── Context menu ────────────────────────────────────────────────────────────
  // Counter for stacking-offset on repeated adds from the same pinned menu;
  // declared before the right-click handler so it can be reset on each open.
  const addOffsetRef = useRef(0);
  // #R4-2 触屏长按空白画布 → 打开「放置节点」上下文菜单（节点长按已由 BaseNode 处理）。
  const paneLongPressTimerRef = useRef<number | undefined>(undefined);
  const paneLongPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    addOffsetRef.current = 0;
    setContextMenu({
      x: e.clientX, y: e.clientY, type: "canvas",
      canvasPos: { x: (e.clientX - rect.left - viewport.x) / viewport.zoom, y: (e.clientY - rect.top - viewport.y) / viewport.zoom },
    });
  }, [viewport]);

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: CanvasNode) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, type: "node", nodeId: node.id });
  }, []);

  // ── 群组「统一拖动」：拖动 group 容器时，其成员（childIds 中、且未被一起多选拖动的）
  //    按相同位移实时跟随（绝对坐标 + 静默更新，与普通拖动一致不入历史）。 ──
  const groupDragRef = useRef<{ groupStart: { x: number; y: number }; children: { id: string; start: { x: number; y: number } }[] } | null>(null);
  const handleNodeDragStart = useCallback((_: React.MouseEvent, node: CanvasNode) => {
    // 「拖拽不展开」：把被拖动(含随之移动的整个选区)的节点标记为手势选中——不展开配置区，
    // 直到被真正点击。onNodeClick(仅无拖动时触发)会清除该标记。
    const sel = useCanvasStore.getState().nodes.filter((n) => n.selected).map((n) => n.id);
    markGestureSelected(sel.length ? sel : [node.id]);
    if (node.data.nodeType !== "group") { groupDragRef.current = null; return; }
    const childIds = ((node.data.payload as GroupNodeData).childIds) ?? [];
    const all = useCanvasStore.getState().nodes;
    const children = childIds
      .map((cid) => all.find((n) => n.id === cid))
      .filter((c): c is CanvasNode => !!c && !c.selected)
      .map((c) => ({ id: c.id, start: { x: c.position.x, y: c.position.y } }));
    groupDragRef.current = { groupStart: { x: node.position.x, y: node.position.y }, children };
  }, []);
  const handleNodeDrag = useCallback((_: React.MouseEvent, node: CanvasNode) => {
    const g = groupDragRef.current;
    if (!g || node.data.nodeType !== "group" || g.children.length === 0) return;
    const dx = node.position.x - g.groupStart.x;
    const dy = node.position.y - g.groupStart.y;
    useCanvasStore.getState().setNodePositionsSilent(
      g.children.map((c) => ({ id: c.id, position: { x: c.start.x + dx, y: c.start.y + dy } })),
    );
  }, []);

  // ── 群组派生层：折叠群组隐藏成员（含相连边）；选中群组给成员加高亮描边类 ──
  // 必须放在所有 early return 之前（Hooks 规则：每次渲染 hook 数量须一致）。
  const { displayNodes, displayEdges } = useMemo(() => {
    const collapsedHiddenIds = new Set<string>();
    const highlightIds = new Set<string>();
    for (const n of nodes) {
      if (n.data.nodeType !== "group") continue;
      const gp = n.data.payload as GroupNodeData;
      const cids = gp.childIds ?? [];
      if (gp.collapsed) cids.forEach((c) => collapsedHiddenIds.add(c));
      if (n.selected) cids.forEach((c) => highlightIds.add(c));
    }
    // ◆6 锁定：payload.locked 的节点不可拖、不可删（draggable/deletable=false）。
    const anyLocked = nodes.some((n) => (n.data.payload as { locked?: boolean } | undefined)?.locked);
    if (collapsedHiddenIds.size === 0 && highlightIds.size === 0 && !anyLocked) {
      return { displayNodes: nodes, displayEdges: edges };
    }
    const dNodes = nodes.map((n) => {
      const hide = collapsedHiddenIds.has(n.id);
      const hl = highlightIds.has(n.id) && !hide;
      const locked = !!(n.data.payload as { locked?: boolean } | undefined)?.locked;
      if (!hide && !hl && !locked) return n;
      return {
        ...n,
        ...(locked ? { draggable: false, deletable: false } : {}),
        hidden: hide || n.hidden,
        className: hl ? `${n.className ?? ""} group-member-highlight`.trim() : n.className,
      };
    });
    const dEdges = collapsedHiddenIds.size === 0
      ? edges
      : edges.map((e) => (collapsedHiddenIds.has(e.source) || collapsedHiddenIds.has(e.target)
          ? { ...e, hidden: true } : e));
    return { displayNodes: dNodes, displayEdges: dEdges };
  }, [nodes, edges]);

  // Mobile/tablet have no right-click; double-tap (== double-click) opens the
  // same canvas context menu so users can still add nodes from empty space.
  // Skip when the gesture lands on a node, edge, or any interactive widget so
  // existing dblclick behaviors (e.g. inline title edits) keep working.
  // #128 双击聚焦的还原状态：prev=聚焦链开始前的视口；focused=聚焦动画落定后的视口
  //（判定「二次双击=还原」的参照，用户手动移开超容差则重新聚焦）。
  const dblFocusRef = useRef<{ nodeId: string; prev: { x: number; y: number; zoom: number }; focused: { x: number; y: number; zoom: number } | null } | null>(null);
  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    // #123 双击节点=快速聚焦放大居中。走 wrapper 合成事件而非 onNodeDoubleClick——
    // 后者在本项目环境不触发（节点内原生 dblclick 委托不可靠，见 InlineBarParts 注释）。
    // 豁免：交互控件（各有自身双击语义）、标题（双击=改名，data-dblfocus-exempt）、群组。
    // #128：video 预览不再豁免（视频节点也要双击聚焦）；preventDefault 压掉
    // Chromium 对带原生 controls 的 <video> 的「双击切全屏」默认行为。
    const nodeEl = t.closest(".react-flow__node") as HTMLElement | null;
    if (nodeEl) {
      if (t.closest('input, textarea, select, button, audio, a, [contenteditable="true"], [data-dblfocus-exempt]')) return;
      e.preventDefault();
      const nid = nodeEl.getAttribute("data-id");
      const n = nid ? useCanvasStore.getState().nodes.find((nn) => nn.id === nid) : undefined;
      if (!n || n.data.nodeType === "group") return;
      // #128 二次双击还原：若仍停在上次聚焦后的视口（容差内），双击同一节点=回到聚焦前视口。
      const cur = reactFlow.getViewport();
      const st = dblFocusRef.current;
      if (st && st.nodeId === n.id && st.focused
        && Math.abs(cur.x - st.focused.x) < 40 && Math.abs(cur.y - st.focused.y) < 40
        && Math.abs(cur.zoom - st.focused.zoom) < 0.15) {
        void reactFlow.setViewport(st.prev, { duration: 420 });
        dblFocusRef.current = null;
        return;
      }
      // 手动算目标缩放 + setCenter：fitView 的 maxZoom 选项对单节点聚焦不生效（实测
      // 冲到 5×被实例上限 6 兜底）。目标=节点约占视口 75%，钳制 [0.8, 3]
      //（用户两轮反馈放大不够：1.25→2→3）。
      const nw = n.measured?.width ?? 340;
      const nh = n.measured?.height ?? 240;
      const zoom = Math.min(3, Math.max(0.8, Math.min(window.innerWidth * 0.75 / nw, window.innerHeight * 0.75 / nh)));
      // prev 只在「非聚焦状态→聚焦」时记录；A→B 连续聚焦保留最初的 prev，
      // 使 B 上的二次双击直接回到整个聚焦链开始前的视口。
      dblFocusRef.current = { nodeId: n.id, prev: st?.prev ?? cur, focused: null };
      void reactFlow.setCenter(n.position.x + nw / 2, n.position.y + nh / 2, { zoom, duration: 420 });
      // 动画结束后记录聚焦视口，供下次双击判定「仍在聚焦态」（用户中途手动平移/缩放
      // 超出容差后，双击同一节点=重新聚焦而非还原）。
      window.setTimeout(() => {
        const rec = dblFocusRef.current;
        if (rec && rec.nodeId === n.id && !rec.focused) rec.focused = reactFlow.getViewport();
      }, 470);
      return;
    }
    if (
      t.closest(".react-flow__edge") ||
      t.closest(".react-flow__controls") ||
      t.closest(".react-flow__minimap") ||
      t.closest("button, input, textarea, [contenteditable='true']")
    ) return;
    // ◆7 双击空白 → 直接打开节点选择器(可搜索、回车加首个匹配),而非弹右键菜单。
    if (isReadOnly) return;
    setShowNodePicker(true);
  }, [isReadOnly, setShowNodePicker, reactFlow]);

  // When the canvas right-click menu is pinned, the user can add several nodes
  // in a row from the same anchor — without a per-add offset they all stack at
  // the exact same canvas coords and only the topmost is visible.
  // (addOffsetRef declared above with handleCanvasContextMenu so it can be reset on open.)
  const handleAddNode = useCallback((type: NodeType) => {
    const base = contextMenu?.canvasPos ?? { x: 200, y: 200 };
    // Stagger 0..7 diagonally (28*7 ≈ 196px) so a batch stays near the
    // anchor; after wrap add random jitter so add #9 doesn't land exactly
    // on top of add #1 at the base position.
    const c = addOffsetRef.current++;
    const i = c % 8;
    const jitter = c >= 8 ? Math.floor(Math.random() * 40 - 20) : 0;
    const pos = (i === 0 && jitter === 0) ? base : { x: base.x + i * 28 + jitter, y: base.y + i * 28 + jitter };
    try {
      const newNode = addNode(type, pos);
      emitCollabEvent("node:add", newNode);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加节点失败");
    }
    setShowNodePicker(false);
  }, [contextMenu, addNode, emitCollabEvent]);

  const addNodeAtCenter = useCallback((type: NodeType) => {
    // ◆1 若处于「线上插入」意图：把节点插进那条边的中点（断开旧边、接两条新边），而非画布中心新建。
    const pendingEdge = useEdgeInsert.getState().edgeId;
    if (pendingEdge) {
      try {
        useCanvasStore.getState().insertNodeOnEdge(pendingEdge, type);
        setRecentNodeTypes((prev) => [type, ...prev.filter((t) => t !== type)].slice(0, 8));
      } catch (err) { toast.error(err instanceof Error ? err.message : "插入节点失败"); }
      useEdgeInsert.getState().clear();
      setShowNodePicker(false);
      return;
    }
    const vp = reactFlow.getViewport();
    const cx = (window.innerWidth / 2 - vp.x) / vp.zoom;
    const cy = (window.innerHeight / 2 - vp.y) / vp.zoom;
    try {
      const newNode = addNode(type, { x: cx + Math.random() * 80 - 40, y: cy + Math.random() * 80 - 40 });
      emitCollabEvent("node:add", newNode);
      setRecentNodeTypes((prev) => [type, ...prev.filter((t) => t !== type)].slice(0, 8));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加节点失败");
    }
    setShowNodePicker(false);
  }, [addNode, reactFlow, emitCollabEvent, setRecentNodeTypes]);

  // ◆1 边工具条点 ⊕ → 打开节点选择器（选完由 addNodeAtCenter 走插入分支）。
  const edgeInsertId = useEdgeInsert((s) => s.edgeId);
  useEffect(() => { if (edgeInsertId) setShowNodePicker(true); }, [edgeInsertId]);

  // ◆9 触屏长按节点 → 打开节点右键菜单(BaseNode 派发 avc:node-longpress)。
  useEffect(() => {
    const onLP = (e: Event) => {
      const d = (e as CustomEvent).detail as { nodeId: string; x: number; y: number } | undefined;
      if (d) setContextMenu({ x: d.x, y: d.y, type: "node", nodeId: d.nodeId });
    };
    window.addEventListener("avc:node-longpress", onLP);
    return () => window.removeEventListener("avc:node-longpress", onLP);
  }, []);

  // 一键：在画布中心新建 ComfyUI 自定义节点，并自动打开「导入向导」（_openWizard 瞬态标志）。
  const addComfyWorkflowWithWizard = useCallback(() => {
    const vp = reactFlow.getViewport();
    const cx = (window.innerWidth / 2 - vp.x) / vp.zoom;
    const cy = (window.innerHeight / 2 - vp.y) / vp.zoom;
    try {
      const n = addNode("comfyui_workflow", { x: cx + Math.random() * 80 - 40, y: cy + Math.random() * 80 - 40 });
      updateNodeData(n.id, { _openWizard: true });
      emitCollabEvent("node:add", n);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加节点失败");
    }
    setShowNodePicker(false);
  }, [addNode, updateNodeData, reactFlow, emitCollabEvent]);

  // Re-create a fully-configured ComfyUI node from a library template (like
  // duplicating): add a fresh node at the viewport center, then inject the saved
  // payload. Autosave + collab follow the normal add/update paths.
  const addNodeFromTemplate = useCallback((type: ComfyNodeType, payload: Record<string, unknown>, label: string) => {
    const fromConnect = tplLibConnect;
    let pos: { x: number; y: number };
    if (fromConnect) {
      pos = reactFlow.screenToFlowPosition({ x: fromConnect.x, y: fromConnect.y });
    } else {
      const vp = reactFlow.getViewport();
      pos = { x: (window.innerWidth / 2 - vp.x) / vp.zoom + Math.random() * 80 - 40, y: (window.innerHeight / 2 - vp.y) / vp.zoom + Math.random() * 80 - 40 };
    }
    try {
      const newNode = addNode(type, pos);
      // Inject templateLabel so the new node's corner annotation shows the template name.
      updateNodeData(newNode.id, { ...payload, templateLabel: label } as Partial<NodeData>);
      emitCollabEvent("node:add", newNode);
      // 从「连线放置」打开的：把新模板节点按拖出方向连到源节点。
      if (fromConnect) {
        const srcNode = useCanvasStore.getState().nodes.find((n) => n.id === fromConnect.fromId);
        const srcType = srcNode?.data.nodeType ?? null;
        const conn: Connection = fromConnect.fromHandleType === "source"
          ? { source: fromConnect.fromId, sourceHandle: fromConnect.fromHandle ?? "output", target: newNode.id, targetHandle: defaultTargetHandle(type, srcType, isAudioAssetSource(srcNode)) }
          : { source: newNode.id, sourceHandle: "output", target: fromConnect.fromId, targetHandle: fromConnect.fromHandle ?? "input" };
        const prevIds = new Set(useCanvasStore.getState().edges.map((e) => e.id));
        onConnect(conn);
        const newEdge = useCanvasStore.getState().edges.find((e) => !prevIds.has(e.id));
        if (newEdge) emitCollabEvent("edge:add", newEdge);
        setTplLibConnect(null);
      }
      toast.success("已从模板创建节点");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建节点失败");
    }
  }, [addNode, updateNodeData, reactFlow, emitCollabEvent, tplLibConnect, onConnect]);

  // ── Drag assets from the library onto the canvas ────────────────────────────
  // FloatingAssetPanel rows set `application/x-asset-list` (JSON array of
  // {url,name,type,mimeType,size,storageKey}). Dropping creates a populated
  // `asset` node per item at the cursor, staggered so a multi-select batch
  // fans out instead of stacking.
  const handleAssetDrop = useCallback((e: React.DragEvent) => {
    // If a node's reference drop zone already consumed this drop (it calls
    // preventDefault), don't ALSO spawn an asset node on the canvas — that was
    // the "dropped into a node but a duplicate appears on the canvas" bug.
    if (e.defaultPrevented) return;
    // Node tiles from the picker carry a node type — drop one onto blank canvas
    // and it lands at the cursor (instead of always being added to the center).
    const dropType = e.dataTransfer.getData("application/x-node-type");
    if (dropType) {
      e.preventDefault();
      if (isReadOnly) { toast.error("只读协作者无法添加节点"); return; }
      const at = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      try {
        const newNode = addNode(dropType as NodeType, at);
        emitCollabEvent("node:add", newNode);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "添加节点失败");
      }
      setShowNodePicker(false);
      return;
    }
    const raw = e.dataTransfer.getData("application/x-asset-list");
    if (!raw) return;
    e.preventDefault();
    if (isReadOnly) { toast.error("只读协作者无法添加素材"); return; }
    let items: Array<{ url: string; name?: string; type?: string; mimeType?: string; size?: number; storageKey?: string }> = [];
    try { items = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(items) || items.length === 0) return;
    const base = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    items.forEach((it, i) => {
      try {
        const node = addNode("asset", { x: base.x + i * 28, y: base.y + i * 28 });
        const t = it.type === "video" || it.type === "audio" || it.type === "image" ? it.type : "other";
        updateNodeData(node.id, {
          url: it.url, name: it.name ?? "素材", type: t,
          mimeType: it.mimeType, size: it.size, storageKey: it.storageKey,
        } as Partial<NodeData>, true);
        emitCollabEvent("node:add", { ...node, data: { ...node.data, payload: { ...node.data.payload, url: it.url, name: it.name, type: t } } });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "添加素材失败");
      }
    });
    toast.success(`已添加 ${items.length} 个素材到画布`);
  }, [isReadOnly, reactFlow, addNode, updateNodeData, emitCollabEvent, setShowNodePicker]);

  // ── Global aspect ratio lock ────────────────────────────────────────────────
  const RATIO_PRESETS = ["16:9", "9:16", "1:1", "4:3", "3:4", "2.35:1"];
  const batchUpdateNodeData = useCanvasStore((s) => s.batchUpdateNodeData);
  const applyGlobalRatio = useCallback((ratio: string | null) => {
    setGlobalAspectRatio(ratio);
    setShowRatioPicker(false);
    if (!ratio) { toast.info("已解除纵横比锁定"); return; }
    // Per-node-type patch: different nodes store ratio differently —
    //   aspectRatio 字段: image_gen / storyboard / prompt / image_edit / comfyui_workflow
    //   ComfyUI 图像/视频: width/height（按比例换算 /64 对齐）
    //   video_task: provider 参数 params.aspect_ratio
    //   clip: aspect（仅支持 16:9 / 9:16 / 1:1）
    const updates: { id: string; payload: Record<string, unknown> }[] = [];
    for (const n of useCanvasStore.getState().nodes) {
      const patch = aspectPatchFor(n.data.nodeType, ratio, (n.data.payload as Record<string, unknown>).params as Record<string, unknown> | undefined);
      if (patch) updates.push({ id: n.id, payload: patch });
    }
    if (updates.length > 0) {
      batchUpdateNodeData(updates);
      toast.success(`已将 ${updates.length} 个节点纵横比锁定为 ${ratio}`);
    } else {
      toast.info(`纵横比锁定为 ${ratio}，新建节点将自动继承`);
    }
  }, [batchUpdateNodeData]);

  // New-node auto-inherit: when a ratio lock is active, any newly-added node gets the
  // lock applied. Centralized (catches every add path incl. drop/connect/collab) via a
  // seen-id set so existing nodes are never re-patched (no loops).
  const seenNodeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = nodes.filter((n) => !seenNodeIdsRef.current.has(n.id));
    fresh.forEach((n) => seenNodeIdsRef.current.add(n.id));
    if (!globalAspectRatio || fresh.length === 0) return;
    const updates = fresh
      .map((n) => {
        const patch = aspectPatchFor(n.data.nodeType, globalAspectRatio, (n.data.payload as Record<string, unknown>).params as Record<string, unknown> | undefined);
        return patch ? { id: n.id, payload: patch } : null;
      })
      .filter((x): x is { id: string; payload: Record<string, unknown> } => x !== null);
    if (updates.length) batchUpdateNodeData(updates);
  }, [nodes, globalAspectRatio, batchUpdateNodeData]);

  const isValidConnectionFn = useCallback((connection: Connection | CanvasEdge) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false;
    const sourceNode = nodes.find(n => n.id === connection.source);
    const targetNode = nodes.find(n => n.id === connection.target);
    if (!sourceNode || !targetNode) return false;
    // 句柄级校验：音频源不得落到剪辑的 video-in、视频源不得落到 audio-in（此前两桩都判合法）。
    const srcIsAudio = sourceNode.data.nodeType === "audio" ||
      (sourceNode.data.nodeType === "asset" && (sourceNode.data.payload as { type?: string })?.type === "audio");
    return isHandleConnectionValid(sourceNode.data.nodeType, targetNode.data.nodeType, connection.targetHandle, srcIsAudio);
  }, [nodes]);

  const handleConnectStart = useCallback((_: unknown, params: { nodeId: string | null; handleType: string | null }) => {
    if (params.nodeId) {
      const node = nodes.find(n => n.id === params.nodeId);
      if (node) {
        setConnectingFromType(node.data.nodeType);
        const isAudio = node.data.nodeType === "audio" ||
          (node.data.nodeType === "asset" && (node.data.payload as { type?: string })?.type === "audio");
        // Drive valid-target handle highlighting across the canvas.
        useConnectingStore.getState().begin(node.id, node.data.nodeType, params.handleType === "target" ? "target" : "source", isAudio);
      }
    }
  }, [nodes]);

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: { isValid: boolean | null; toNode?: { id: string } | null; fromHandle?: { id?: string | null } | null }) => {
    const drag = useConnectingStore.getState();
    const fromType = drag.fromType, fromId = drag.fromId, fromHandleType = drag.fromHandleType;
    const fromHandle = connectionState.fromHandle?.id ?? null;
    setConnectingFromType(null);
    useConnectingStore.getState().end();
    // ◆8 落在某节点上但连接非法(isValid=false) → 给出原因，不再静默失败。
    if (connectionState.toNode && connectionState.isValid === false && fromType) {
      const tn = useCanvasStore.getState().nodes.find((n) => n.id === connectionState.toNode!.id);
      if (tn && tn.id !== fromId) {
        toast.error(`「${getNodeConfig(fromType)?.label ?? fromType}」不能连到「${getNodeConfig(tn.data.nodeType)?.label ?? tn.data.nodeType}」：类型不兼容`, { duration: 2200 });
      }
    }
    // 仅在「未连到任何节点」（落在空白）时弹建节点菜单；落在节点上＝原行为（onConnect 已处理）。
    if (isReadOnly || !fromType || !fromId || !fromHandleType || connectionState.toNode) return;
    // 候选 = 该桩点「现有方向」可连接的节点类型（连接矩阵已排除不可连接者，列表里不会出现）。
    const types = sortByConnectOrder(fromHandleType === "source" ? getCompatibleTargets(fromType) : getCompatibleSources(fromType));
    if (types.length === 0) return;
    const pt = "changedTouches" in event ? event.changedTouches[0] : (event as MouseEvent);
    setConnectMenu({ x: pt.clientX, y: pt.clientY, types, fromId, fromHandleType, fromHandle });
  }, [isReadOnly, sortByConnectOrder]);

  // 在菜单里选了一个节点类型：在落点建该节点，并按拖出方向连边。
  const handlePickConnectType = useCallback((type: NodeType) => {
    if (!connectMenu) return;
    const pos = reactFlow.screenToFlowPosition({ x: connectMenu.x, y: connectMenu.y });
    const newNode = addNode(type, pos);
    setConnectMenu(null);
    if (!newNode) return;
    emitCollabEvent("node:add", newNode);
    const srcNode = useCanvasStore.getState().nodes.find((n) => n.id === connectMenu.fromId);
    const srcType = srcNode?.data.nodeType ?? null;
    const conn: Connection = connectMenu.fromHandleType === "source"
      ? { source: connectMenu.fromId, sourceHandle: connectMenu.fromHandle ?? "output", target: newNode.id, targetHandle: defaultTargetHandle(type, srcType, isAudioAssetSource(srcNode)) }
      : { source: newNode.id, sourceHandle: "output", target: connectMenu.fromId, targetHandle: connectMenu.fromHandle ?? "input" };
    const prevIds = new Set(useCanvasStore.getState().edges.map((e) => e.id));
    onConnect(conn);
    const newEdge = useCanvasStore.getState().edges.find((e) => !prevIds.has(e.id));
    if (newEdge) emitCollabEvent("edge:add", newEdge);
  }, [connectMenu, reactFlow, addNode, onConnect, emitCollabEvent]);

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = () => {
    const blob = new Blob([JSON.stringify({
      version: "1.0", projectId, exportedAt: new Date().toISOString(),
      nodes: nodes.map((n) => ({ id: n.id, type: n.data.nodeType, title: n.data.title, position: n.position, data: n.data.payload })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, label: e.label })),
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `canvas-${projectId}-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast.success("画布已导出为 JSON");
  };

  // ── Import ────────────────────────────────────────────────────────────────
  const importInputRef = useRef<HTMLInputElement>(null);
  const handleImportFile = async (file: File) => {
    if (isReadOnly) { toast.error("只读协作者无法导入"); return; }
    try {
      const text = await file.text();
      const graph = JSON.parse(text) as Parameters<typeof importGraph>[0];
      if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
        toast.error("文件格式不符：未找到可导入的节点");
        return;
      }
      const before = snapshotGraphIds();
      const r = importGraph(graph);
      if (r.nodes === 0) { toast.error("未导入任何节点（类型不识别或格式不符）"); return; }
      emitGraphAdditions(before); // 广播导入的节点/边给协作者
      toast.success(`已导入 ${r.nodes} 个节点 · ${r.edges} 条连接`);
      setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 400 }), 80);
    } catch (e) {
      toast.error("导入失败：" + (e instanceof Error ? e.message : "无法解析 JSON"));
    }
  };

  // ── Export images ───────────────────────────────────────────────────────────
  const handleExportImages = useCallback(async () => {
    const imageNodes = nodes.filter((n) => {
      const p = n.data.payload as Record<string, unknown>;
      return (n.data.nodeType === "image_gen" || n.data.nodeType === "storyboard") && p.imageUrl;
    });

    if (imageNodes.length === 0) {
      toast.error("没有可导出的图像");
      return;
    }

    toast.info(`正在下载 ${imageNodes.length} 张图像...`);

    for (let i = 0; i < imageNodes.length; i++) {
      const node = imageNodes[i];
      const p = node.data.payload as Record<string, unknown>;
      const url = p.imageUrl as string;
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          const filename = `${node.data.title.replace(/[^a-zA-Z0-9一-龥]/g, "_")}-${i + 1}.png`;
          void downloadMedia(url, filename, "image");
          resolve();
        }, i * 150);
      });
    }
  }, [nodes]);

  // #102 极简显示：进画布时恢复持久化状态（Alt+Q 切换）；离开画布移除信号，
  // 首页等非画布页面不受 CSS 覆写影响。
  useEffect(() => {
    try {
      if (localStorage.getItem("avc:canvas-minimal") === "1") {
        document.documentElement.setAttribute("data-canvas-minimal", "1");
        window.dispatchEvent(new CustomEvent("canvas:minimal-change"));
      }
    } catch { /* restricted */ }
    return () => {
      document.documentElement.removeAttribute("data-canvas-minimal");
      window.dispatchEvent(new CustomEvent("canvas:minimal-change"));
    };
  }, []);

  // #116 第四批「亲手试一试」：消费教程页写入的导览深链标志——挂载时读一次
  //（教程点击时画布未开的情形），并监听 storage 事件（教程在另一标签页点击、
  // 画布已开着的情形——storage 事件天然只发给其它标签页，正好即时启动）。
  useEffect(() => {
    const consume = () => {
      try {
        const raw = localStorage.getItem("avc:tutorial:tryit");
        if (!raw) return;
        localStorage.removeItem("avc:tutorial:tryit"); // 一次性消费，避免每次进画布都重启导览
        const { step } = JSON.parse(raw) as { step?: string };
        const idx = GUIDE_STEPS.findIndex((s) => s.id === step);
        if (idx >= 0) {
          startGuide(idx);
          toast.info("来自教程的「亲手试一试」：已定位到对应导览步骤", { duration: 2500 });
        }
      } catch { /* 损坏的标志直接忽略 */ }
    };
    consume();
    const onStorage = (e: StorageEvent) => { if (e.key === "avc:tutorial:tryit" && e.newValue) consume(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [startGuide]);

  // #112 画布助手的 fit_view / 整理布局后适应视图：agentApply 无 reactFlow 实例，
  // 经自定义事件转交这里执行。
  useEffect(() => {
    const onFit = () => reactFlow.fitView({ padding: 0.15, duration: 400 });
    window.addEventListener("canvas:fit-view", onFit);
    return () => window.removeEventListener("canvas:fit-view", onFit);
  }, [reactFlow]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip undo/redo when focus is inside an input or textarea
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        const wasDirty = useCanvasStore.getState().isDirty;
        saveCanvas();
        if (wasDirty) toast.success("已保存");
      }
      if (e.key === "Escape") {
        setContextMenu(null); setConnectMenu(null); setShowNodePicker(false); useEdgeInsert.getState().clear(); setShowNodeSearch(false); setShowTemplates(false); setShowNodeLib(false); runConfirmOpenRef.current = false; setShowRunConfirm(false); setRunConfirmCountdown(5); setShowHelp(false); setShowArcPicker(false); setShowShortcuts(false); setShowGridStoryboard(false);
        // 取消节点选中（与快捷键面板「Esc 取消选中」对齐）。用 reactFlow.setNodes 才能让
        // ReactFlow 内部选中态正确同步（直接改 store 的 node.selected 不取消选中）。
        if (!isEditing) reactFlow.setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
      }

      // Alt+W — 临时「速览」：所有节点的左侧参考窗 + 顶部提示词窗一起展开，再次按下或
      // 5 秒后自动恢复。用 e.code === "KeyW" 以兼容 Alt 组合在部分键盘上产生特殊字符。
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyW") {
        e.preventDefault();
        useGlobalPeekStore.getState().toggle();
      }

      // Cmd+A / Ctrl+A — 全选节点（仅画布，不在输入框时）
      if (!isEditing && (e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        const n = useCanvasStore.getState().nodes.length;
        if (n > 0) { reactFlow.setNodes((nds) => nds.map((x) => ({ ...x, selected: true }))); toast.success(`已全选 ${n} 个节点`, { duration: 1000 }); }
      }

      // ? — 开关快捷键速查面板（Shift+/ 产生 "?"）
      if (!isEditing && e.key === "?") {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }

      // Cmd+K / Ctrl+K — studio: switch the selected generative node's model; else node search.
      if (!isEditing && (e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (document.documentElement.getAttribute("data-ui") === "studio") {
          const sel = useCanvasStore.getState().nodes.filter((n) => n.selected);
          const gen = sel.length === 1 && MODEL_SWITCH_FIELD[sel[0].data.nodeType] ? sel[0] : null;
          if (gen) { setModelSwitch({ nodeId: gen.id, nodeType: gen.data.nodeType }); return; }
        }
        setShowNodeSearch((v) => !v);
      }

      // Cmd+T / Ctrl+T — Templates (skip when typing in an input)
      if (!isEditing && (e.metaKey || e.ctrlKey) && e.key === "t") {
        e.preventDefault();
        setShowTemplates((v) => !v);
      }

      // ◆3 F — 缩放到选中/框选内容(无选中则适应全部);Figma/n8n 常见。
      if (!isEditing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        const sel = useCanvasStore.getState().nodes.filter((n) => n.selected);
        if (sel.length > 0) reactFlow.fitView({ nodes: sel.map((n) => ({ id: n.id })), padding: 0.3, duration: 400, maxZoom: 1.6 });
        else reactFlow.fitView({ padding: 0.2, duration: 400 });
      }

      // Duplicate selected node: Cmd+D / Ctrl+D (skip when typing in an input)
      if (!isEditing && (e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        const store = useCanvasStore.getState();
        const selected = store.nodes.filter(n => n.selected);
        // 选中的群组整体复制（含成员）；其成员若也被选中则不再单独复制，避免重复。
        const groupSel = selected.filter(n => n.data.nodeType === "group");
        const inGroups = new Set(groupSel.flatMap(g => (g.data.payload as GroupNodeData).childIds ?? []));
        const loose = selected.filter(n => n.data.nodeType !== "group" && !inGroups.has(n.id));
        if (selected.length > 0) {
          const before = snapshotGraphIds();
          store.runBatch(() => {
            groupSel.forEach(g => store.duplicateGroup(g.id));
            loose.forEach(n => store.duplicateNode(n.id));
          });
          emitGraphAdditions(before); // 广播复制出的新节点/边给协作者
          const parts: string[] = [];
          if (groupSel.length > 0) parts.push(`${groupSel.length} 个群组（含成员）`);
          if (loose.length > 0) parts.push(`${loose.length} 个节点`);
          toast.success(`已复制 ${parts.join(" + ")}`, { duration: 1200 });
        }
      }

      // 子图复制：Cmd/Ctrl+C 记下框选节点（群组展开含成员），不立即克隆。
      if (!isEditing && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "c") {
        const store = useCanvasStore.getState();
        const selected = store.nodes.filter((n) => n.selected);
        if (selected.length === 0) return; // 不拦截浏览器默认复制
        e.preventDefault();
        const ids = new Set(selected.map((n) => n.id));
        for (const g of selected) {
          if (g.data.nodeType === "group") for (const c of (g.data.payload as GroupNodeData).childIds ?? []) ids.add(c);
        }
        clipboardRef.current = Array.from(ids);
        pasteCountRef.current = 0;
        toast.success(`已复制 ${ids.size} 个节点（含内部连线），Ctrl+V 粘贴`, { duration: 1400 });
      }
      // 子图粘贴：Cmd/Ctrl+V 克隆剪贴板子图，连内部连线一并复制；重复粘贴递增偏移。
      if (!isEditing && (e.metaKey || e.ctrlKey) && e.key === "v") {
        if (clipboardRef.current.length === 0) return;
        e.preventDefault();
        const store = useCanvasStore.getState();
        pasteCountRef.current += 1;
        const off = 50 + 40 * pasteCountRef.current;
        const before = snapshotGraphIds();
        const newIds = store.cloneSubgraph(clipboardRef.current, { x: off, y: off });
        emitGraphAdditions(before); // 广播粘贴出的子图给协作者
        if (newIds.length > 0) toast.success(`已粘贴 ${newIds.length} 个节点`, { duration: 1200 });
      }

      // 群组：Cmd/Ctrl/Alt+G 组合选中节点；+Shift 解组（删除选中的 group 容器）。对齐 LibTV
      // 的 Ctrl/Alt+G / Ctrl/Alt/Shift+G。用 e.code 兜底，避免 Alt 组合在部分键盘产生特殊字符。
      if (!isEditing && (e.metaKey || e.ctrlKey || e.altKey) && (e.key === "g" || e.key === "G" || e.code === "KeyG")) {
        e.preventDefault();
        const store = useCanvasStore.getState();
        if (e.shiftKey) {
          const groups = store.nodes.filter((n) => n.selected && n.data.nodeType === "group");
          groups.forEach((g) => { store.ungroup(g.id); deleteNodeMutation.mutate({ id: g.id, projectId }); emitCollabEvent("node:delete", { id: g.id }); });
          if (groups.length > 0) toast.success(`已解组 ${groups.length} 个群组`, { duration: 1200 });
        } else {
          const ids = store.nodes.filter((n) => n.selected && n.data.nodeType !== "group").map((n) => n.id);
          if (ids.length >= 2) { const before = snapshotGraphIds(); const gid = store.groupSelected(ids); if (gid) { emitGraphAdditions(before); toast.success(`已组合 ${ids.length} 个节点为群组`, { duration: 1200 }); } }
          else toast.info("请先框选至少 2 个节点再组合", { duration: 1500 });
        }
      }

      // Shift+R（不带 Ctrl/Meta）：≥2 box-selected → run ONLY those; 1 selected → run from it
      // (its up/downstream chain); none → run everything.
      // 必须排除 Ctrl/Meta，否则浏览器「强制刷新」Ctrl+Shift+R 也会触发运行（与刷新冲突）。
      if (!isEditing && e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === "R") {
        e.preventDefault();
        if (runStateRunningRef.current) return;
        const selIds = nodes.filter((n) => n.selected && RUNNABLE_TYPES.includes(n.data.nodeType as NodeType)).map((n) => n.id);
        if (selIds.length >= 2) handleRunRequest(null, selIds);
        else handleRunRequest(nodes.find((n) => n.selected)?.id ?? null);
      }

      // A：切换选中节点的「高级」参数区（创意模式就地输入条的「高级」开关同款）。
      // 无修饰键，仅非编辑态生效；派发事件由选中的创意节点自行切换 advancedOpen。
      if (!isEditing && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "a" || e.key === "A")) {
        if (nodes.some((n) => n.selected)) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("canvas:toggle-advanced"));
        }
      }

      // Tab — 新建节点（打开节点选择器），对齐 LibTV。仅非编辑态、无修饰键。
      if (!isEditing && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        setShowNodePicker((v) => !v);
      }

      // Cmd/Ctrl + Enter — 生成：运行选中节点（≥2=仅运行选中；1=从该节点运行；无=全部），对齐 LibTV。
      if (!isEditing && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (runStateRunningRef.current) return;
        const selIds = nodes.filter((n) => n.selected && RUNNABLE_TYPES.includes(n.data.nodeType as NodeType)).map((n) => n.id);
        if (selIds.length >= 2) handleRunRequest(null, selIds);
        else handleRunRequest(nodes.find((n) => n.selected)?.id ?? null);
      }

      // Cmd/Ctrl + L — 连线：选中恰好 2 个非群组节点时，按画布位置左→右自动连一条边，对齐 LibTV。
      if (!isEditing && (e.metaKey || e.ctrlKey) && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        const store = useCanvasStore.getState();
        const sel = store.nodes.filter((n) => n.selected && n.data.nodeType !== "group");
        if (sel.length === 2) {
          const [a, b2] = sel[0].position.x <= sel[1].position.x ? [sel[0], sel[1]] : [sel[1], sel[0]];
          store.onConnect({ source: a.id, target: b2.id, sourceHandle: null, targetHandle: null });
          toast.success("已连接选中的两个节点", { duration: 1000 });
        } else {
          toast.info("请先选中恰好 2 个节点，再按 Ctrl+L 连线", { duration: 1600 });
        }
      }

      // #102 Alt+Q — 创意模式「极简显示」开关：所有节点仅留预览框（框线取消，极窄阴影）。
      // 用 e.code 兜底（Alt 组合在部分键盘布局产生特殊字符）；仅创意画布 + 非工作室皮肤生效。
      if (!isEditing && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === "q" || e.key === "Q" || e.code === "KeyQ")) {
        const el = document.documentElement;
        if (el.getAttribute("data-canvas-mode") === "creative" && el.getAttribute("data-ui") !== "studio") {
          e.preventDefault();
          const wasOn = el.getAttribute("data-canvas-minimal") === "1";
          if (wasOn) el.removeAttribute("data-canvas-minimal");
          else el.setAttribute("data-canvas-minimal", "1");
          window.dispatchEvent(new CustomEvent("canvas:minimal-change"));
          try { localStorage.setItem("avc:canvas-minimal", wasOn ? "0" : "1"); } catch { /* restricted */ }
          toast.success(wasOn ? "已恢复标准显示" : "已切换到极简显示（再按 Alt+Q 恢复）", { duration: 1400 });
        }
      }

      // Undo: Cmd+Z / Ctrl+Z
      if (!isEditing && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        handleUndo();
      }
      // Redo: Cmd+Shift+Z or Ctrl+Y
      if (!isEditing && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z") {
        e.preventDefault();
        handleRedo();
      }
      if (!isEditing && e.ctrlKey && !e.shiftKey && e.key === "y") {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveCanvas, handleUndo, handleRedo, runWorkflow, nodes, handleRunRequest, reactFlow]);

  const collaboratorList = Array.from(collaborators.values());

  // ── Error / not found ────────────────────────────────────────────────────────
  if (projectError) {
    // 区分「确实无权/不存在」(NOT_FOUND/FORBIDDEN/UNAUTHORIZED) 与「瞬时网络/服务端错误」。
    // 后者此前也被笼统显示为「无权访问」且无重试入口 —— 现给「重试」(refetch)。
    const code = (projectErr as { data?: { code?: string } } | null)?.data?.code;
    const isAccessErr = code === "NOT_FOUND" || code === "FORBIDDEN" || code === "UNAUTHORIZED";
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center gap-4" style={{ background: "var(--c-canvas)" }}>
        <div style={{ fontSize: 26 }}>{isAccessErr ? "🔒" : "📡"}</div>
        <p className="text-sm" style={{ color: "var(--c-t3)" }}>
          {isAccessErr ? "项目不存在或无权访问" : "加载失败：网络或服务器错误，请重试"}
        </p>
        <div className="flex items-center gap-2">
          {!isAccessErr && (
            <button onClick={() => refetchProject()} disabled={projectFetching}
              className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "oklch(0.62 0.2 285)", color: "#fff", opacity: projectFetching ? 0.6 : 1 }}>
              {projectFetching ? "重新加载中…" : "↻ 重试"}
            </button>
          )}
          <button onClick={() => navigate("/")} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "var(--c-elevated)", color: "var(--c-t2)" }}>
            返回主页
          </button>
        </div>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (projectLoading) {
    return (
      <div
        className="w-screen h-screen flex flex-col items-center justify-center gap-3"
        style={{ background: "var(--c-canvas)" }}
      >
        <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center">
          <img src="/chat-icon.svg" alt="KingTai" className="w-full h-full object-cover" />
        </div>
        <div style={{ width: 240, height: 6, borderRadius: 3, background: "var(--c-input)", overflow: "hidden" }}>
          <div style={{ width: "20%", height: "100%", borderRadius: 3, background: "oklch(0.62 0.19 285)" }} />
        </div>
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--c-t4)" }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          读取项目…
        </div>
      </div>
    );
  }

  return (
   <NodeDefaultModelsProvider config={defaultModelsConfig} systemDefaults={systemDefaultModels} onChange={handleDefaultModelsChange} readOnly={isReadOnly}>
    <div className="w-screen h-screen flex flex-col overflow-hidden" style={{ background: "var(--c-canvas)" }}>
      {/* 读取进度层：节点/连线加载与首帧渲染期间显示，完成后淡出（小画布 180ms 内就绪则不闪） */}
      {bootVisible && !bootDone && (
        <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "var(--c-canvas)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, opacity: bootPct >= 100 ? 0 : 1, transition: "opacity 0.3s", pointerEvents: bootPct >= 100 ? "none" : "auto" }}>
          <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center">
            <img src="/chat-icon.svg" alt="KingTai" className="w-full h-full object-cover" />
          </div>
          <div style={{ width: 240, height: 6, borderRadius: 3, background: "var(--c-input)", overflow: "hidden" }}>
            <div style={{ width: `${bootPct}%`, height: "100%", borderRadius: 3, background: "oklch(0.62 0.19 285)", transition: "width 0.35s ease" }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--c-t4)", fontVariantNumeric: "tabular-nums" }}>{bootLabel}</div>
        </div>
      )}

      {/* ══ Top Bar ══════════════════════════════════════════════════════════ */}
      <header
        className={`canvas-topbar h-11 flex items-center flex-shrink-0 z-20 ${topbarNarrow ? "px-2 gap-1" : "px-3 gap-2"}`}
        style={{
          background: "color-mix(in oklch, var(--c-base) 45%, transparent)",
          backdropFilter: "blur(20px) saturate(1.4)",
          WebkitBackdropFilter: "blur(20px) saturate(1.4)",
          borderBottom: "1px solid var(--c-bd1)",
        }}
      >
        {/* Back */}
        <button
          onClick={() => navigate("/")}
          className="topbar-btn"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Logo + Project name（窄屏隐 logo 腾横向空间） */}
        <div className="flex items-center gap-2 mr-2">
          {!topbarNarrow && (
            <div className="w-6 h-6 rounded-md overflow-hidden flex items-center justify-center flex-shrink-0">
              <img src="/chat-icon.svg" alt="KingTai" className="w-full h-full object-cover" />
            </div>
          )}

          {renamingProject ? (
            <div className="flex items-center gap-1">
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (renameValue.trim()) updateProject.mutate({ id: projectId, name: renameValue.trim() });
                    setRenamingProject(false);
                  }
                  if (e.key === "Escape") setRenamingProject(false);
                }}
                onBlur={() => {
                  if (renameValue.trim()) updateProject.mutate({ id: projectId, name: renameValue.trim() });
                  setRenamingProject(false);
                }}
                className="text-sm font-medium outline-none w-36"
                style={{
                  background: "transparent",
                  color: "var(--c-t1)",
                  borderBottomWidth: 1,
                  borderBottomStyle: "solid",
                  borderBottomColor: "oklch(0.68 0.22 285)",
                }}
                autoFocus
              />
              <button onClick={() => setRenamingProject(false)} style={{ color: "var(--c-t3)" }}>
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div
              className="group/title flex items-center gap-1 cursor-pointer"
              onClick={() => { setRenameValue(project?.name ?? ""); setRenamingProject(true); }}
            >
              <span className="text-sm font-medium truncate" style={{ color: "var(--c-t1)", maxWidth: topbarNarrow ? 96 : 160 }}>
                {project?.name ?? "画布"}
              </span>
              <Pencil
                className="w-3 h-3 opacity-0 group-hover/title:opacity-100 transition-opacity"
                style={{ color: "var(--c-t3)" }}
              />
            </div>
          )}
        </div>

        {/* Dirty dot */}
        {isDirty && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--c-t3)" }}>
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "oklch(0.75 0.15 80)", boxShadow: "0 0 4px oklch(0.75 0.15 80 / 0.6)" }}
            />
            未保存
          </div>
        )}

        {/* 全局运行状态条（生成中/排队/完成/失败，点失败跳转）——仅运行中或有失败时显示。
            运行中可「停止」；失败态可「重试」失败项（走确认弹窗，与正常运行一致）。 */}
        <RunStatusBar runState={runState} onCancel={cancelWorkflowRun} onRetryFailed={(ids) => useCanvasStore.getState().requestRun(null, ids)} />

        {/* Poyo 暂存/存储可达状态灯（顶部工具栏左侧；可达且未暂存时不显示） */}
        {/* 余额/密钥/存储徽章：手机上被压成竖排溢出顶栏（topbar-mid 隐藏），信息可去管理后台看 */}
        <span className="topbar-mid flex items-center gap-2 flex-shrink-0">
          <PoyoStorageStatusChip className="flex-shrink-0" />
          <PoyoBalanceDashboard />
          <KieBalanceDashboard compact={topbarNarrow} />
          <CustomLlmKeyDashboard compact={topbarNarrow} />
        </span>

        <div className="flex-1" />

        {/* Right actions */}
        <div className="flex items-center gap-1">
          {/* Collaborators indicator */}
          <button
            onClick={() => setShowCollaborators(!showCollaborators)}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs transition-all"
            style={{
              background: showCollaborators ? "oklch(0.68 0.22 285 / 0.12)" : "transparent",
              border: showCollaborators ? "1px solid oklch(0.68 0.22 285 / 0.3)" : "1px solid transparent",
              color: "var(--c-t3)",
            }}
            onMouseEnter={(e) => { if (!showCollaborators) { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; } }}
            onMouseLeave={(e) => { if (!showCollaborators) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; } }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: socketConnected ? "oklch(0.72 0.18 155)" : "var(--c-t4)" }}
            />
            <Users className="w-3.5 h-3.5" />
            {collaboratorList.length > 0 && <span>{collaboratorList.length}</span>}
          </button>

          {/* ComfyUI server status (GPU/VRAM/RAM/queue + config panel) — main window only */}
          {!isPopout && <ComfyServerStatusIndicator />}

          {/* Chat (floating in-canvas window) — hidden in popout (second-monitor) windows */}
          {!isPopout && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setChatOpen((v) => !v)}
                className="topbar-btn"
                data-tour="chat"
                data-active={chatOpen ? "true" : undefined}
                style={{ position: "relative", ...(chatOpen ? { background: "oklch(0.68 0.22 285 / 0.12)", border: "1px solid oklch(0.68 0.22 285 / 0.3)", color: "oklch(0.68 0.22 285)" } : {}) }}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                {/* 未读红点：聊天窗关着时收到新消息 → 提示 */}
                {!chatOpen && chatUnread > 0 && (
                  <span style={{ position: "absolute", top: -3, right: -3, minWidth: 15, height: 15, padding: "0 4px", borderRadius: 999, background: "oklch(0.62 0.22 25)", color: "#fff", fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px var(--c-base)" }}>
                    {chatUnread > 99 ? "99+" : chatUnread}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">聊天（悬浮窗）</TooltipContent>
          </Tooltip>
          )}

          {/* 画布助手（对话式操作画布：让 AI 直接建/连/改节点） */}
          {!isPopout && !isReadOnly && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setAgentChatOpen((v) => !v)}
                className="topbar-btn"
                data-tour="agent"
                data-active={agentChatOpen ? "true" : undefined}
                style={agentChatOpen ? { background: "oklch(0.70 0.20 310 / 0.12)", border: "1px solid oklch(0.70 0.20 310 / 0.3)", color: "oklch(0.70 0.20 310)" } : undefined}
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">画布助手（对话式改画布）</TooltipContent>
          </Tooltip>
          )}

          {/* Templates */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowTemplates(!showTemplates)}
                className="topbar-btn topbar-mid"
                data-active={showTemplates ? "true" : undefined}
                style={showTemplates ? { background: "oklch(0.68 0.22 285 / 0.12)", border: "1px solid oklch(0.68 0.22 285 / 0.3)", color: "oklch(0.68 0.22 285)" } : undefined}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              快速模板 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-background/15 border border-background/25 font-mono">⌘T</kbd>
            </TooltipContent>
          </Tooltip>

          {/* ComfyUI node template library */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowNodeLib(!showNodeLib)}
                className="topbar-btn topbar-mid"
                data-tour="node-lib"
                data-active={showNodeLib ? "true" : undefined}
                style={showNodeLib ? { background: "oklch(0.65 0.20 140 / 0.12)", border: "1px solid oklch(0.65 0.20 140 / 0.3)", color: "oklch(0.65 0.20 140)" } : undefined}
              >
                <Boxes className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">ComfyUI 节点模板库</TooltipContent>
          </Tooltip>

          {/* Node Search */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowNodeSearch(true)}
                className="topbar-btn topbar-mid"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              搜索节点 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-background/15 border border-background/25 font-mono">⌘K</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Assets */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowAssets(!showAssets)}
                className="topbar-btn"
                data-tour="assets"
                data-active={showAssets ? "true" : undefined}
                style={showAssets ? { background: "oklch(0.68 0.22 285 / 0.12)", border: "1px solid oklch(0.68 0.22 285 / 0.3)", color: "oklch(0.68 0.22 285)" } : undefined}
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">素材库</TooltipContent>
          </Tooltip>

          {/* Character library（常驻） */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowCharLib((v) => !v)}
                className="topbar-btn topbar-mid"
                data-tour="charlib"
                data-active={showCharLib ? "true" : undefined}
                style={showCharLib ? { background: "oklch(0.66 0.18 30 / 0.12)", border: "1px solid oklch(0.66 0.18 30 / 0.3)", color: "oklch(0.66 0.18 30)" } : undefined}
              >
                <Users className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">角色库</TooltipContent>
          </Tooltip>

          {/* Video editor (jump to the timeline editor) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate("/editor")}
                className="topbar-btn topbar-mid"
                data-tour="editor"
                style={{ background: "oklch(0.65 0.19 310 / 0.12)", border: "1px solid oklch(0.65 0.19 310 / 0.32)", color: "oklch(0.7 0.19 310)" }}
              >
                <Clapperboard className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">视频剪辑器</TooltipContent>
          </Tooltip>

          {/* ── Separator: View panels | Edit actions ── */}
          <div className="w-px h-4 mx-1" style={{ background: "var(--c-bd2)" }} />

          {/* Undo */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleUndo}
                disabled={past.length === 0 || isReadOnly}
                className="topbar-btn"
                title={isReadOnly ? "只读模式下不可编辑" : undefined}
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              撤销 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-background/15 border border-background/25 font-mono">⌘Z</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Redo */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleRedo}
                disabled={future.length === 0 || isReadOnly}
                className="topbar-btn"
                title={isReadOnly ? "只读模式下不可编辑" : undefined}
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              重做 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-background/15 border border-background/25 font-mono">⌘⇧Z</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Save */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { saveCanvas(); toast.success("已保存"); }}
                className="topbar-btn"
                disabled={isReadOnly}
                title={isReadOnly ? "只读模式下不可编辑" : undefined}
              >
                <Save className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              保存 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-background/15 border border-background/25 font-mono">⌘S</kbd>
            </TooltipContent>
          </Tooltip>

          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ""; }}
          />
          {/* Divider */}
          <div className="w-px h-4 mx-1" style={{ background: "var(--c-bd2)" }} />

          {/* Global aspect ratio lock */}
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowRatioPicker((v) => !v)}
                  className="topbar-mid flex items-center gap-1 h-7 px-2 rounded-lg text-[11px] transition-all"
                  style={{
                    background: globalAspectRatio ? "oklch(0.72 0.20 80 / 0.12)" : "transparent",
                    border: globalAspectRatio ? "1px solid oklch(0.72 0.20 80 / 0.35)" : "1px solid var(--c-bd2)",
                    color: globalAspectRatio ? "oklch(0.72 0.20 80)" : "var(--c-t3)",
                  }}
                  onMouseEnter={(e) => { if (!globalAspectRatio) { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; } }}
                  onMouseLeave={(e) => { if (!globalAspectRatio) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; } }}
                >
                  {globalAspectRatio ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  {globalAspectRatio ?? "比例"}
                  <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">全局纵横比锁定</TooltipContent>
            </Tooltip>
            {showRatioPicker && (
              <div
                className="absolute right-0 top-9 z-50 rounded-xl overflow-hidden"
                style={{
                  background: "var(--c-base)",
                  border: "1px solid var(--c-bd2)",
                  boxShadow: "0 8px 32px oklch(0 0 0 / 0.55)",
                  minWidth: 120,
                }}
              >
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-all text-left"
                  style={{ borderBottom: "1px solid var(--c-bd1)", color: "var(--c-t3)" }}
                  onClick={() => applyGlobalRatio(null)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <Unlock className="w-3 h-3" />
                  解除锁定
                </button>
                {RATIO_PRESETS.map((r) => (
                  <button
                    key={r}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs transition-all"
                    style={{
                      borderBottom: "1px solid var(--c-bd1)",
                      background: globalAspectRatio === r ? "oklch(0.72 0.20 80 / 0.10)" : "transparent",
                      color: globalAspectRatio === r ? "oklch(0.72 0.20 80)" : "var(--c-t2)",
                    }}
                    onClick={() => applyGlobalRatio(r)}
                    onMouseEnter={(e) => { if (globalAspectRatio !== r) (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
                    onMouseLeave={(e) => { if (globalAspectRatio !== r) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <span>{r}</span>
                    {globalAspectRatio === r && <Lock className="w-2.5 h-2.5" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="w-px h-4 mx-1" style={{ background: "var(--c-bd2)" }} />

          {/* 更多 ⋯ —— 低频功能收进下拉，给顶栏腾横向空间 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="topbar-btn" data-tour="more" title="更多">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {!isPopout && (
                <DropdownMenuItem onClick={() => {
                  const url = new URL(window.location.href);
                  url.searchParams.set("popout", "1");
                  window.open(url.toString(), "_blank", "noopener,width=1280,height=860");
                }}><MonitorUp className="w-3.5 h-3.5 mr-2" /> 副屏打开</DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setShowHelp((v) => !v)}><HelpCircle className="w-3.5 h-3.5 mr-2" /> 操作指南</DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open("/tutorial", "_blank")}><HelpCircle className="w-3.5 h-3.5 mr-2" /> 详细教程</DropdownMenuItem>
              <DropdownMenuItem onClick={() => startGuide(0)}><Compass className="w-3.5 h-3.5 mr-2" /> 新手导览</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { resetCanvasTips(); toast.success("已重新开启操作小贴士"); }}><Lightbulb className="w-3.5 h-3.5 mr-2" /> 重新开启小贴士</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowNotifySettings(true)}><Bell className="w-3.5 h-3.5 mr-2" /> 产物推送设置</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowPresentation(true)}><Play className="w-3.5 h-3.5 mr-2" /> 演示模式</DropdownMenuItem>

              {/* 手机窄屏 / 创意模式（LibTV 化 3.2 顶栏精简）：顶栏隐藏的中频按钮
                  （.topbar-mid）收进这里，功能不丢只换入口。 */}
              {(isMobile || canvasMode === "creative") && (<>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>工具</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setShowTemplates((v) => !v)}><LayoutGrid className="w-3.5 h-3.5 mr-2" /> 快速模板</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowNodeLib((v) => !v)}><Boxes className="w-3.5 h-3.5 mr-2" /> ComfyUI 模板库</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowNodeSearch(true)}><Search className="w-3.5 h-3.5 mr-2" /> 节点搜索</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowCharLib((v) => !v)}><Users className="w-3.5 h-3.5 mr-2" /> 角色库</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/editor")}><Clapperboard className="w-3.5 h-3.5 mr-2" /> 视频剪辑器</DropdownMenuItem>
              </>)}

              <DropdownMenuSeparator />
              <DropdownMenuLabel>库</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setShowPromptLib((v) => !v)}><BookText className="w-3.5 h-3.5 mr-2" /> 提示词库</DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel>视图 / 面板</DropdownMenuLabel>
              {!isPopout && <DropdownMenuItem onClick={() => setShowStatsSidebar((v) => !v)}><BarChart2 className="w-3.5 h-3.5 mr-2" /> 画布统计</DropdownMenuItem>}
              <DropdownMenuItem onClick={() => setShowLeftPanel((v) => !v)}><PanelLeft className="w-3.5 h-3.5 mr-2" /> 资产管理（大纲 + 资产）</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowPlaza(true)}><Sparkles className="w-3.5 h-3.5 mr-2" /> 特效广场</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowFilmstrip((v) => !v)}><Film className="w-3.5 h-3.5 mr-2" /> 胶片条</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowTimeline((v) => !v)}><ListVideo className="w-3.5 h-3.5 mr-2" /> 时间轴预览</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowArcPicker(true)}><Spline className="w-3.5 h-3.5 mr-2" /> 叙事弧线编排</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowSnapshots((v) => !v)}><History className="w-3.5 h-3.5 mr-2" /> 版本历史</DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel>导入 / 导出</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleSaveAs} disabled={saveAsMutation.isPending}><CopyPlus className="w-3.5 h-3.5 mr-2" /> 另存为新项目</DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportImages}><Image className="w-3.5 h-3.5 mr-2" /> 导出所有图像</DropdownMenuItem>
              <DropdownMenuItem onClick={handleExport}><Download className="w-3.5 h-3.5 mr-2" /> 导出 JSON</DropdownMenuItem>
              {!isReadOnly && <DropdownMenuItem onClick={() => importInputRef.current?.click()}><Upload className="w-3.5 h-3.5 mr-2" /> 导入 JSON</DropdownMenuItem>}

              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowChangePw(true)}><KeyRound className="w-3.5 h-3.5 mr-2" /> 修改密码</DropdownMenuItem>
              <DropdownMenuItem onClick={async () => { await logout(); navigate("/"); }} className="text-red-400 focus:text-red-400"><LogOut className="w-3.5 h-3.5 mr-2" /> 退出登录</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ChangePasswordDialog open={showChangePw} onClose={() => setShowChangePw(false)} />
          <NotifySettingsDialog open={showNotifySettings} onClose={() => setShowNotifySettings(false)} />
        </div>
      </header>

      {/* ══ Main ═════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* Node picker popup — centered above bottom toolbar */}
        {showNodePicker && (
          <div
            className="absolute bottom-20 left-1/2 z-30 rounded-2xl overflow-hidden animate-scale-in"
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: "translateX(-50%)",
              background: "var(--c-base)",
              border: "1px solid var(--c-bd2)",
              boxShadow: "0 20px 80px oklch(0 0 0 / 0.40), 0 4px 16px oklch(0 0 0 / 0.20), 0 0 0 1px var(--c-bd2)",
              backdropFilter: "blur(32px)",
              width: "min(520px, calc(100vw - 24px))",
              maxWidth: "calc(100vw - 24px)",
            }}
          >
            <div
              className="px-4 py-2.5 flex items-center justify-between"
              style={{ borderBottom: "1px solid var(--c-bd1)" }}
            >
              <div className="flex items-center gap-2">
                <Plus className="w-3.5 h-3.5" style={{ color: "oklch(0.68 0.22 285)" }} />
                <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--c-t4)" }}>
                  添加节点
                </p>
              </div>
              <p className="text-[10px]" style={{ color: "var(--c-t4)" }}>点击居中 · 拖拽到指定位置</p>
            </div>
            {/* Search */}
            <div className="px-2.5 pt-2.5">
              <input
                value={nodePickerSearch}
                onChange={(e) => setNodePickerSearch(e.target.value)}
                onKeyDown={(e) => {
                  // Enter 直接添加首个匹配节点（键盘流：输入即建，无需再点选）。
                  if (e.key === "Enter") {
                    const q = nodePickerSearch.trim().toLowerCase();
                    if (!q) return;
                    const first = NODE_TYPE_LIST.find((c) => c.comingSoon !== true && (c.label.toLowerCase().includes(q) || c.type.toLowerCase().includes(q)));
                    if (first) { e.preventDefault(); addNodeAtCenter(first.type); }
                  }
                }}
                placeholder="搜索节点…（回车添加首个匹配）"
                autoFocus
                className="nodrag w-full"
                style={{ padding: "7px 10px", borderRadius: 9, fontSize: 12, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }}
              />
            </div>
            <div className="p-2.5" style={{ maxHeight: 440, overflowY: "auto" }}>
              {(() => {
                const renderTile = (config: NodeConfig) => {
                  const Icon = NODE_ICONS[config.icon] ?? FileText;
                  const soon = config.comingSoon === true;
                  return (
                    <button
                      key={config.type}
                      onClick={() => addNodeAtCenter(config.type)}
                      draggable={!soon}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-node-type", config.type);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      title={soon ? "即将上线" : "点击居中添加，或拖拽到画布指定位置"}
                      className="group/picker relative flex flex-col items-center gap-2.5 px-2 py-3 rounded-xl transition-all text-center"
                      style={{ color: "var(--c-t2)", opacity: soon ? 0.5 : 1 }}
                      onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "var(--c-elevated)"; el.style.color = "var(--c-t1)"; }}
                      onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = "var(--c-t2)"; }}
                    >
                      {soon && (
                        <span className="absolute top-1 right-1 px-1 rounded text-[8px] font-bold uppercase tracking-wider" style={{ background: "var(--c-elevated)", color: "var(--c-t4)", border: "1px solid var(--c-bd2)", lineHeight: "12px" }}>Soon</span>
                      )}
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all" style={{ background: `${config.color}14`, border: `1px solid ${config.color}30`, boxShadow: `0 2px 8px ${config.color}10` }}>
                        <Icon style={{ color: config.color, width: 18, height: 18 }} />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <p className="text-[11px] font-semibold leading-none" style={{ letterSpacing: "-0.01em" }}>{config.label}</p>
                      </div>
                    </button>
                  );
                };
                const q = nodePickerSearch.trim().toLowerCase();
                const list = q
                  ? NODE_TYPE_LIST.filter((c) => c.label.toLowerCase().includes(q) || c.type.toLowerCase().includes(q))
                  : sortNodeConfigsForPalette(NODE_TYPE_LIST);
                // 置顶快捷入口：一键「新建 ComfyUI 工作流并打开导入向导」（带服务器预检）。
                const COMFY_ACC = "oklch(0.7 0.17 195)";
                const showWizardTile = !q || "comfyui工作流导入向导wizardcomfy".includes(q);
                const wizardTile = (
                  <button
                    key="__comfy_wizard"
                    onClick={addComfyWorkflowWithWizard}
                    title="新建 ComfyUI 自定义节点并打开导入向导（含服务器预检 + 一键重映射）"
                    className="group/picker relative flex flex-col items-center gap-2.5 px-2 py-3 rounded-xl transition-all text-center"
                    style={{ color: COMFY_ACC, background: `${COMFY_ACC}0e`, border: `1px solid ${COMFY_ACC}40` }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = `${COMFY_ACC}1c`; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = `${COMFY_ACC}0e`; }}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${COMFY_ACC}1f`, border: `1px solid ${COMFY_ACC}40` }}>
                      <Wand2 style={{ color: COMFY_ACC, width: 18, height: 18 }} />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-[11px] font-semibold leading-none" style={{ letterSpacing: "-0.01em" }}>导入工作流</p>
                    </div>
                  </button>
                );
                if (list.length === 0 && !showWizardTile) return <p className="text-[11px] text-center py-6" style={{ color: "var(--c-t4)" }}>未找到匹配的节点</p>;
                // 无搜索时，把最近添加过的类型置顶为「最近使用」快速区。
                const recentConfigs = !q
                  ? recentNodeTypes.map((t) => NODE_TYPE_LIST.find((c) => c.type === t)).filter((c): c is NodeConfig => !!c && c.comingSoon !== true).slice(0, 8)
                  : [];
                return (
                  <>
                    {recentConfigs.length > 0 && (
                      <div className="mb-2">
                        <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5 px-0.5" style={{ color: "var(--c-t4)" }}>最近使用</p>
                        <div className="grid grid-cols-4 gap-1.5">{recentConfigs.map(renderTile)}</div>
                        <div className="mt-2.5 mb-0.5" style={{ height: 1, background: "var(--c-bd1)" }} />
                      </div>
                    )}
                    <div className="grid grid-cols-4 gap-1.5">
                      {q
                        ? <>{showWizardTile && wizardTile}{list.map(renderTile)}</>
                        // 无搜索时把首个节点（工程智能体，HEAD_ORDER 置顶）排在最前面，
                        // 甚至先于「导入工作流」快捷入口。
                        : (() => { const [first, ...rest] = list; return <>{first && renderTile(first)}{showWizardTile && wizardTile}{rest.map(renderTile)}</>; })()}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── Canvas ── */}
        <div
          className="flex-1 relative canvas-vignette"
          style={{ background: effectiveBgColor }}
          onContextMenu={handleCanvasContextMenu}
          onDoubleClick={handleCanvasDoubleClick}
          onMouseMove={handleMouseMove}
          onClick={() => { setShowNodePicker(false); useEdgeInsert.getState().clear(); }}
          // 用 capture 相位：ReactFlow 的 pane 会吞掉 touchstart 冒泡（用于平移），冒泡相位收不到，
          // capture 在祖先先于 pane 触发，故长按可靠。仅空白画布长按（节点/桩自身已有长按）。
          onTouchStartCapture={(e) => {
            if (isReadOnly || e.touches.length !== 1) return;
            const tgt = e.target as HTMLElement;
            if (tgt.closest(".react-flow__node") || tgt.closest(".react-flow__handle") || tgt.closest("button, input, textarea, select, a")) return;
            const t = e.touches[0];
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const cx = t.clientX, cy = t.clientY;
            paneLongPressStartRef.current = { x: cx, y: cy };
            window.clearTimeout(paneLongPressTimerRef.current);
            paneLongPressTimerRef.current = window.setTimeout(() => {
              addOffsetRef.current = 0;
              setContextMenu({ x: cx, y: cy, type: "canvas", canvasPos: { x: (cx - rect.left - viewport.x) / viewport.zoom, y: (cy - rect.top - viewport.y) / viewport.zoom } });
            }, 500);
          }}
          onTouchMoveCapture={(e) => {
            const t = e.touches[0], s = paneLongPressStartRef.current;
            if (t && s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 12) window.clearTimeout(paneLongPressTimerRef.current);
          }}
          onTouchEndCapture={() => window.clearTimeout(paneLongPressTimerRef.current)}
        >
          {/* Studio skin: the selected node's params float BELOW the node (handled in
              BaseNode via NodeToolbar), so the right-side inspector is no longer mounted. */}
          {isReadOnly && (
            <div
              className="absolute top-3 left-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
              style={{
                transform: "translateX(-50%)",
                background: "oklch(0.72 0.18 45 / 0.10)",
                border: "1px solid oklch(0.72 0.18 45 / 0.30)",
                color: "oklch(0.72 0.18 45)",
                pointerEvents: "none",
              }}
            >
              只读模式 — 你以查看者身份打开了此项目
            </div>
          )}
          <WorkflowRunProvider value={runState}>
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            // #81 lite 档 + 节点数阈值：只在大画布（>30 节点）才裁剪视口外节点/边——
            // 少节点时裁剪省不了合成开销，反而在手势中反复挂载/卸载边界节点 + 图片重解码
            // （#94 手机真实反馈：流畅模式反而更慢）。代价：滚出视口的节点卸载、其未持久化
            // 的临时 UI 态复位——数据全在 store 不受影响；未降档时行为与从前完全一致。
            onlyRenderVisibleElements={perfCullOffscreen}
            style={{ background: effectiveBgColor }}
            onNodesChange={onNodesChange}
            onNodeDragStart={handleNodeDragStart as unknown as Parameters<typeof ReactFlow>[0]["onNodeDragStart"]}
            onNodeDrag={handleNodeDrag as unknown as Parameters<typeof ReactFlow>[0]["onNodeDrag"]}
            onNodeDragStop={(_, node, draggedNodes) => {
              // 群组容器拖动结束：成员已随动（静默），这里广播成员的最终位置给协作者。
              const g = groupDragRef.current;
              if (g && (node as CanvasNode).data.nodeType === "group" && g.children.length > 0) {
                const dx = node.position.x - g.groupStart.x;
                const dy = node.position.y - g.groupStart.y;
                for (const c of g.children) {
                  emitCollabEvent("node:move", { id: c.id, x: c.start.x + dx, y: c.start.y + dy });
                }
              }
              groupDragRef.current = null;
              // 拖入/拖出自动归组：被拖动的非 group 节点，按其中心落点归入命中的群组
              // （取面积最小者，便于嵌套时归入最内层）；未命中则从原群组移出。
              if ((node as CanvasNode).data.nodeType !== "group") {
                const all = useCanvasStore.getState().nodes;
                const groups = all.filter((n) => n.data.nodeType === "group");
                const moved = (draggedNodes?.length ? draggedNodes : [node]).filter((n) => (n as CanvasNode).data.nodeType !== "group");
                for (const mn of moved) {
                  const mw = (mn as CanvasNode).measured?.width ?? 280;
                  const mh = (mn as CanvasNode).measured?.height ?? 120;
                  const cx = mn.position.x + mw / 2;
                  const cy = mn.position.y + mh / 2;
                  let hit: CanvasNode | null = null;
                  let hitArea = Infinity;
                  for (const grp of groups) {
                    const gw = typeof grp.style?.width === "number" ? grp.style.width : 320;
                    const gh = typeof grp.style?.height === "number" ? grp.style.height : 200;
                    if (cx >= grp.position.x && cx <= grp.position.x + gw && cy >= grp.position.y && cy <= grp.position.y + gh) {
                      const area = gw * gh;
                      if (area < hitArea) { hit = grp; hitArea = area; }
                    }
                  }
                  useCanvasStore.getState().assignNodeToGroup(mn.id, hit?.id ?? null);
                }
              }
              // Broadcast the final position(s) to collaborators (live-move sync).
              for (const n of (draggedNodes?.length ? draggedNodes : [node])) {
                emitCollabEvent("node:move", { id: n.id, x: n.position.x, y: n.position.y });
              }
            }}
            onEdgesChange={onEdgesChange}
            onConnect={(connection) => {
              const prevIds = new Set(useCanvasStore.getState().edges.map((e) => e.id));
              onConnect(connection);
              const newEdge = useCanvasStore.getState().edges.find((e) => !prevIds.has(e.id));
              if (newEdge) emitCollabEvent("edge:add", newEdge);
            }}
            edgesReconnectable={!isReadOnly}
            onReconnect={(oldEdge, newConnection) => {
              useCanvasStore.getState().reconnectEdge(oldEdge as CanvasEdge, newConnection);
            }}
            onNodeContextMenu={handleNodeContextMenu as Parameters<typeof ReactFlow>[0]["onNodeContextMenu"]}
            onNodesDelete={(deleted) => deleted.forEach((n) => {
              deleteNodeMutation.mutate({ id: n.id, projectId });
              emitCollabEvent("node:delete", { id: n.id });
            })}
            onEdgesDelete={(deleted) => deleted.forEach((e) => {
              deleteEdgeMutation.mutate({ id: e.id, projectId });
              emitCollabEvent("edge:delete", { id: e.id });
            })}
            onInit={() => { reactFlowReadyRef.current = true; applyInitialViewport(); }}
            onMoveEnd={(_, vp) => { setViewport(vp); if (viewportRestoredRef.current) markDirty(); }}
            onDrop={handleAssetDrop}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("application/x-asset-list") || e.dataTransfer.types.includes("application/x-node-type")) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            }}
            nodesDraggable={!isReadOnly}
            nodesConnectable={!isReadOnly}
            snapToGrid={snapEnabled}
            snapGrid={[20, 20]}
            edgesFocusable={!isReadOnly}
            elementsSelectable
            selectionMode={SelectionMode.Partial}
            selectionOnDrag={!isMobile}
            onSelectionStart={() => setBoxSelecting(true)}
            onSelectionEnd={() => {
              setBoxSelecting(false);
              // 「框选不展开」：框选结束后把选中的节点标记为手势选中——即便最终只框到 1 个也不展开，
              // 维持点击前收起的样子，直到被真正点击。
              markGestureSelected(useCanvasStore.getState().nodes.filter((n) => n.selected).map((n) => n.id));
            }}
            onNodeClick={(_, node) => clearGestureSelected(node.id)}
            onPaneClick={() => clearGestureSelected()}
            panOnDrag={isMobile ? true : [1, 2]}
            panOnScroll
            panOnScrollMode={PanOnScrollMode.Free}
            zoomOnScroll={false}
            zoomOnPinch
            zoomOnDoubleClick={false}
            zoomActivationKeyCode="Control"
            fitView={false}
            elevateNodesOnSelect={false /* #117 关闭选中自动抬高：群组盒 zIndex=-1 常居底层，
              选中若被抬到 1000 会盖住组内成员——点组内空白选中群组后成员就点不到 */}
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.05}
            maxZoom={6}
            deleteKeyCode={["Delete", "Backspace"]}
            multiSelectionKeyCode="Shift"
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: "custom", animated: false }}
            isValidConnection={isValidConnectionFn}
            onConnectStart={handleConnectStart}
            onConnectEnd={handleConnectEnd}
            connectionRadius={35}
          >
            {canvasBg.pattern !== "none" && (
              <Background
                variant={
                  canvasBg.pattern === "dots"  ? BackgroundVariant.Dots  :
                  canvasBg.pattern === "lines" ? BackgroundVariant.Lines :
                  BackgroundVariant.Cross
                }
                gap={canvasBg.gap}
                size={canvasBg.size}
                color={effectivePatternColor}
              />
            )}
            {/* 鸟瞰图（MiniMap）：创意模式隐藏（LibTV 无总览缩略图），专业/工作室保留 */}
            {canvasMode !== "creative" && (<>
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeColor={(n) => getNodeConfig((n.data as { nodeType: NodeType }).nodeType)?.color ?? "var(--c-bd3)"}
              maskColor={isLight ? "oklch(0.95 0.004 255 / 0.55)" : "oklch(0.09 0.006 260 / 0.55)"}
              style={{
                background: isLight ? "oklch(0.95 0.004 255 / 0.38)" : "oklch(0.09 0.006 260 / 0.38)",
                backdropFilter: "blur(6px)",
                border: "1px solid var(--c-bd2)",
                borderRadius: 12,
                bottom: mmPos.bottom,
                right: mmPos.right,
                margin: 0,
                width: mmSize.w,
                height: mmSize.h,
                // Force above filmstrip (15) / timeline (25) / bottom toolbar
                // (20). Inline so it wins against the lib's .react-flow__panel
                // baseline z-index 5 regardless of CSS load order.
                zIndex: 40,
              }}
            />
            {/* Minimap drag handle + resize grip — transparent overlay.
                z-index: 41 so it stays just above .react-flow__minimap (40)
                and clears the filmstrip (15) / timeline (25) panels. The body is
                pointer-events:none so drag-to-pan reaches the minimap below. */}
            <div
              style={{
                position: "absolute",
                bottom: mmPos.bottom,
                right: mmPos.right,
                width: mmSize.w,
                height: mmSize.h,
                zIndex: 41,
                pointerEvents: "none",
                borderRadius: 12,
              }}
            >
              {/* Drag handle — top strip (doesn't block minimap click-to-navigate below) */}
              <div
                style={{
                  position: "absolute",
                  top: 0, left: 0, right: 0,
                  height: 20,
                  cursor: "grab",
                  pointerEvents: "all",
                  borderRadius: "12px 12px 0 0",
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  mmDragRef.current = { sx: e.clientX, sy: e.clientY, sb: mmPos.bottom, sr: mmPos.right };
                  const onMove = (me: MouseEvent) => {
                    if (!mmDragRef.current) return;
                    setMmPos({
                      bottom: Math.max(4, Math.min(window.innerHeight - 80, mmDragRef.current.sb - (me.clientY - mmDragRef.current.sy))),
                      right: Math.max(4, Math.min(window.innerWidth - 100, mmDragRef.current.sr - (me.clientX - mmDragRef.current.sx))),
                    });
                  };
                  const onUp = () => { mmDragRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
              />
              {/* Resize grip — top-left corner (drag toward top-left to enlarge) */}
              <div
                style={{
                  position: "absolute",
                  top: 4, left: 4,
                  width: 14, height: 14,
                  cursor: "nw-resize",
                  pointerEvents: "all",
                  opacity: 0.4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  mmResizeRef.current = { sx: e.clientX, sy: e.clientY, sw: mmSize.w, sh: mmSize.h };
                  const onMove = (me: MouseEvent) => {
                    if (!mmResizeRef.current) return;
                    setMmSize({
                      w: Math.max(120, Math.min(420, mmResizeRef.current.sw - (me.clientX - mmResizeRef.current.sx))),
                      h: Math.max(80, Math.min(320, mmResizeRef.current.sh - (me.clientY - mmResizeRef.current.sy))),
                    });
                  };
                  const onUp = () => { mmResizeRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
              >
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ color: "var(--c-t3)" }}>
                  <line x1="0.5" y1="8.5" x2="8.5" y2="0.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <line x1="0.5" y1="4.5" x2="4.5" y2="0.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
            </>)}
          </ReactFlow>
          </WorkflowRunProvider>

          {/* Studio fullscreen media viewer (opened from a node hero) */}
          <Lightbox />
          {/* Studio multi-select action bar (≥2 nodes selected) */}
          <MultiSelectBar />
          {/* ◆2 对齐/分布工具条(≥2 选中，所有皮肤) */}
          <AlignToolbar />
          {/* 操作小贴士（右下角，定时/情境弹出，可自动消失，右键不再显示） */}
          <CanvasTips />
          {/* 「返回节点」提示：视野里看不到任何节点时浮出，一键归位（对标 LibTV） */}
          <ReturnToNodesHint />
          {/* 空画布引导：双击提示 + 工作流入口卡（对标 LibTV；有节点即消失）。
              #122 须等节点快照灌入 store（nodesHydrated）再判空——dbNodes 就绪但未
              灌入的渲染空窗仍会闪，标志与 setNodes 同批提交才无时序窗口。 */}
          {!isReadOnly && nodesHydrated && <EmptyCanvasGuide />}
          {/* Studio global creation bar (nothing selected → quick prompt → 生成) */}
          <StudioCreateBar />
          {/* ◆10 非 studio 皮肤的空画布空态 CTA（studio 由 StudioCreateBar 负责）。
              #122 nodesHydrated 门控：与 setNodes 同批置位，「已灌入且确实为空」才显示，
              不存在「数据已回但还没灌进 store」的误判空窗。 */}
          {uiStyle !== "studio" && !isReadOnly && nodesHydrated && nodes.filter((n) => n.data.nodeType !== "group").length === 0 && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-55%)", zIndex: 6,
              display: "flex", flexDirection: "column", alignItems: "center", gap: 14, pointerEvents: "none", textAlign: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--c-surface)", border: "1.5px dashed var(--c-bd3)", color: "var(--c-t3)" }}>
                <Plus className="w-7 h-7" />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-t2)" }}>画布是空的</div>
                <div style={{ fontSize: 12.5, color: "var(--c-t4)", marginTop: 4 }}>添加节点开始创作，或导入一个工作流。双击空白也能快速添加。</div>
              </div>
              <div style={{ display: "flex", gap: 10, pointerEvents: "auto" }}>
                <button onClick={() => setShowNodePicker(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                    background: "var(--color-brand, oklch(0.62 0.2 285))", color: "#fff", border: "none", cursor: "pointer" }}>
                  <Plus className="w-4 h-4" /> 添加第一个节点
                </button>
                <button onClick={addComfyWorkflowWithWizard}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: "var(--c-surface)", color: "var(--c-t2)", border: "1px solid var(--c-bd2)", cursor: "pointer" }}>
                  <LayoutGrid className="w-4 h-4" /> 导入工作流
                </button>
              </div>
            </div>
          )}
          {/* Studio ⌘K model quick-switch (a generative node is selected) */}
          {modelSwitch && <ModelQuickSwitch nodeId={modelSwitch.nodeId} nodeType={modelSwitch.nodeType} onClose={() => setModelSwitch(null)} />}

          <ConnectionHintsPanel
            visible={showConnectionHints}
            selectedNodeType={connectingFromType}
            onClose={() => setShowConnectionHints(false)}
          />
          <WorkflowStatusPanel runState={runState} onReset={resetWorkflowRun} />
          <BeginnerGuide onStartTour={() => startGuide(0)} />
          <GuidedTour onStep={handleGuideStep} />
          <HelpPanel
            open={showHelp}
            onClose={() => setShowHelp(false)}
            activeNodeType={nodes.find((n) => n.selected)?.data.nodeType ?? null}
            onAddNode={(nodeType) => { addNodeAtCenter(nodeType); setShowHelp(false); }}
            onStartTour={() => startGuide(0)}
          />
          {showArcPicker && (
            <NarrativeArcPicker onClose={() => setShowArcPicker(false)} />
          )}

          {/* ── 框选放大遮罩：开启后全屏捕获鼠标，拖出矩形 → 松手放大该区域 ── */}
          {regionZoomActive && (
            <div
              onPointerDown={onRegionPointerDown}
              onPointerMove={onRegionPointerMove}
              onPointerUp={onRegionPointerUp}
              style={{ position: "fixed", inset: 0, zIndex: 60, cursor: "crosshair", background: "oklch(0 0 0 / 0.06)" }}
            >
              {regionRect && regionRect.w > 0 && regionRect.h > 0 && (
                <div style={{
                  position: "fixed", left: regionRect.x, top: regionRect.y, width: regionRect.w, height: regionRect.h,
                  border: "1.5px dashed oklch(0.68 0.22 285)", background: "oklch(0.68 0.22 285 / 0.12)", pointerEvents: "none",
                }} />
              )}
              <div style={{
                position: "fixed", top: 18, left: "50%", transform: "translateX(-50%)", pointerEvents: "none",
                padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                background: "color-mix(in oklch, var(--c-base) 80%, transparent)", backdropFilter: "blur(12px)",
                border: "1px solid var(--c-bd2)", color: "var(--c-t1)", boxShadow: "var(--c-node-shadow-hover)",
              }}>
                框选要放大的区域，松手即放大铺满全屏（Esc 取消）
              </div>
            </div>
          )}

          {/* ── Floating toolbar — drops anywhere; horizontal/vertical via toggle ── */}
          <div
            className={`canvas-bottombar absolute z-20 flex items-center rounded-2xl ${toolbarOrient === "v" ? "flex-col " : ""}${canvasMode === "creative" ? "bottombar-creative gap-0.5 px-1.5 py-1" : "gap-1.5 px-2.5 py-1.5"}`}
            data-bar-orient={toolbarOrient}
            data-toolbar-collapsed={toolbarCollapsed ? "true" : "false"}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              // 只响应直接在工具栏背景上的拖拽（不拦截按钮点击）。Pointer 事件统一鼠标 +
              // 触屏 → 移动端也能拖动；setPointerCapture 让 move/up 始终落到本元素。
              if ((e.target as HTMLElement).closest("button,input,select")) return;
              e.preventDefault();
              const el = e.currentTarget as HTMLElement;
              try { el.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
              const rect = el.getBoundingClientRect();
              const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
              const startX = e.clientX, startY = e.clientY;
              let dragged = false;
              const onMove = (mv: PointerEvent) => {
                if (!dragged && Math.hypot(mv.clientX - startX, mv.clientY - startY) < 5) return;
                dragged = true;
                const w = el.offsetWidth, h = el.offsetHeight;
                const x = Math.max(0, Math.min(window.innerWidth - w, mv.clientX - offX));
                const y = Math.max(0, Math.min(window.innerHeight - h, mv.clientY - offY));
                setToolbarPos({ x, y });
              };
              const onUp = () => {
                el.removeEventListener("pointermove", onMove);
                el.removeEventListener("pointerup", onUp);
                el.removeEventListener("pointercancel", onUp);
              };
              el.addEventListener("pointermove", onMove);
              el.addEventListener("pointerup", onUp);
              el.addEventListener("pointercancel", onUp);
            }}
            style={{
              left: toolbarPos.x < 0 ? Math.max(8, window.innerWidth / 2 - 180) : toolbarPos.x,
              // 默认位置上移并改用 visualViewport 高度：移动端浏览器地址栏会吃掉 innerHeight，
              // 旧的 innerHeight-64 常把工具栏顶到可视区外只露一半。
              top: toolbarPos.x < 0 ? (window.visualViewport?.height ?? window.innerHeight) - 104 : toolbarPos.y,
              touchAction: "none",
              cursor: "grab",
              // 创意模式（LibTV 风）：容器更实一点、模糊更强、边框更淡、圆角更大、阴影更柔，
              // 与媒体优先画布上的胶囊 dock 观感一致；其它模式沿用原质感。
              ...(canvasMode === "creative"
                ? {
                    background: "color-mix(in oklch, var(--c-base) 66%, transparent)",
                    backdropFilter: "blur(30px)",
                    border: "1px solid color-mix(in oklch, var(--c-bd2) 60%, transparent)",
                    borderRadius: 20,
                    boxShadow: "0 10px 34px oklch(0 0 0 / 0.4)",
                  }
                : {
                    background: "color-mix(in oklch, var(--c-base) 38%, transparent)",
                    backdropFilter: "blur(24px)",
                    border: "1px solid var(--c-bd2)",
                    boxShadow: "var(--c-node-shadow-hover), 0 0 0 1px var(--c-bd2)",
                  }),
            }}
          >
            {/* Collapse toggle — folds the less-used tools (always visible, far left) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setToolbarCollapsed((v) => !v)}
                  className="w-7 h-7 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
                  style={{ color: toolbarCollapsed ? "oklch(0.72 0.18 285)" : "var(--c-t3)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = toolbarCollapsed ? "oklch(0.72 0.18 285)" : "var(--c-t3)"; }}
                >
                  {toolbarCollapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">{toolbarCollapsed ? "展开工具栏" : "折叠工具栏（隐藏不常用）"}</TooltipContent>
            </Tooltip>

            {/* Orientation toggle (horizontal ↔ vertical) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-tb-sec
                  onClick={() => setToolbarOrient((o) => (o === "h" ? "v" : "h"))}
                  className="w-7 h-7 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
                  style={{ color: "var(--c-t3)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
                >
                  {toolbarOrient === "h" ? <MoveVertical className="w-3.5 h-3.5" /> : <MoveHorizontal className="w-3.5 h-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">{toolbarOrient === "h" ? "切换为竖排" : "切换为横排"}</TooltipContent>
            </Tooltip>
            <div style={{ width: 1, height: 18, background: "var(--c-bd2)", flexShrink: 0 }} />

            {/* 阶段四 4.2：特效广场（运镜/画风特效/工作流配方） */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-tb-sec
                  onClick={() => setShowPlaza(true)}
                  className="w-7 h-7 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
                  style={{ color: "var(--c-t3)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
                >
                  <Sparkles className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">特效广场（运镜 / 画风特效 / 工作流）</TooltipContent>
            </Tooltip>

            {/* LibTV 化 2.4：资产管理左栏开关（画布大纲 + 资产双 tab）。
                常用入口：不标 data-tb-sec，收缩工具条时保留。 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowLeftPanel((v) => !v)}
                  className="w-7 h-7 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
                  style={{ color: showLeftPanel ? "oklch(0.72 0.18 285)" : "var(--c-t3)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = showLeftPanel ? "oklch(0.72 0.18 285)" : "var(--c-t3)"; }}
                >
                  <PanelLeft className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">资产管理（画布大纲 + 资产）</TooltipContent>
            </Tooltip>

            {/* #80 角色库：底部悬浮工具栏常显入口（不标 data-tb-sec，收缩时保留） */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowCharLib((v) => !v)}
                  title="角色库"
                  aria-label="角色库（跨项目复用角色 / 场景）"
                  className="w-7 h-7 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
                  style={{ color: showCharLib ? "oklch(0.66 0.18 30)" : "var(--c-t3)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = showCharLib ? "oklch(0.66 0.18 30)" : "var(--c-t3)"; }}
                >
                  <Users className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">角色库（跨项目复用角色 / 场景）</TooltipContent>
            </Tooltip>

            {/* #81 渲染性能三档：自适应（FPS 哨兵自动降档）/ 流畅（老旧电脑）/ 画质。常显不收缩。 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    const next = PERF_MODE_ORDER[(PERF_MODE_ORDER.indexOf(perfMode) + 1) % PERF_MODE_ORDER.length];
                    usePerfStore.getState().setMode(next);
                    toast.success(
                      next === "lite" ? "渲染：流畅模式（降低模糊/阴影/离屏渲染开销，适合老旧电脑）"
                      : next === "quality" ? "渲染：画质模式（完整视觉效果，永不自动降档）"
                      : "渲染：自适应（帧率偏低时自动切换流畅模式）",
                      { id: "perf-mode" },
                    );
                  }}
                  className="w-7 h-7 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
                  style={{ color: perfLite ? "oklch(0.75 0.16 85)" : perfMode === "quality" ? "oklch(0.7 0.16 200)" : "var(--c-t3)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = perfLite ? "oklch(0.75 0.16 85)" : perfMode === "quality" ? "oklch(0.7 0.16 200)" : "var(--c-t3)"; }}
                >
                  <Gauge className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                渲染性能：{PERF_MODE_LABEL[perfMode]}{perfLite && perfMode === "auto" ? "（已自动降为流畅）" : ""} · 点击切换 自适应/流畅/画质
              </TooltipContent>
            </Tooltip>

            {/* Add node — primary action (hidden for viewers) */}
            {!isReadOnly && <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-tb-sec
                  data-tour="add-node"
                  onClick={() => setShowNodePicker(!showNodePicker)}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-semibold transition-all"
                  style={{
                    background: showNodePicker
                      ? "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))"
                      : "oklch(0.68 0.22 285 / 0.15)",
                    border: `1px solid oklch(0.68 0.22 285 / ${showNodePicker ? "0" : "0.35"})`,
                    color: showNodePicker ? "white" : "oklch(0.78 0.15 285)",
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span data-toolbar-label>添加</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">添加节点</TooltipContent>
            </Tooltip>}

            {/* Run workflow — 悬浮工具条主操作（不标 data-tb-sec，折叠时仍保留）。选择感知同 Shift+R：
                框选多个=仅运行选中；选 1 个=从该节点运行；不选=运行全部。 */}
            {!isReadOnly && <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-tour="run"
                  disabled={runState.running}
                  onClick={() => {
                    if (runStateRunningRef.current) return;
                    const selIds = nodes.filter((n) => n.selected && RUNNABLE_TYPES.includes(n.data.nodeType as NodeType)).map((n) => n.id);
                    if (selIds.length >= 2) handleRunRequest(null, selIds);
                    else handleRunRequest(nodes.find((n) => n.selected)?.id ?? null);
                  }}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-semibold transition-all"
                  style={{
                    background: "oklch(0.72 0.22 142 / 0.15)",
                    border: "1px solid oklch(0.72 0.22 142 / 0.35)",
                    color: "oklch(0.75 0.18 142)",
                    opacity: runState.running ? 0.55 : 1,
                    cursor: runState.running ? "not-allowed" : "pointer",
                  }}
                >
                  <Play className="w-3.5 h-3.5" />
                  <span data-toolbar-label>运行</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">运行工作流（框选多个=仅运行选中；选 1 个=从该节点运行；不选=运行全部）· 快捷键 Shift+R</TooltipContent>
            </Tooltip>}

            {/* Grid storyboard starter (hidden for viewers)。标 data-tb-sec → 收缩工具条时隐藏。 */}
            {!isReadOnly && <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-tb-sec
                  onClick={() => setShowGridStoryboard(true)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                  style={{ color: "oklch(0.65 0.20 160)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.65 0.20 160 / 0.14)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <Grid2x2 className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">网格分镜起稿（九宫格/三视图…）</TooltipContent>
            </Tooltip>}

            {/* 快速创作栏 开关（工作室模式）——从浮动胶囊改为并入底部工具栏，与其它按钮同尺寸 */}
            {uiStyle === "studio" && !isReadOnly && <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setStudioCreateBarCollapsed(!createBarCollapsed)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                  style={{ color: createBarCollapsed ? "var(--c-t3)" : "oklch(0.70 0.20 310)", background: createBarCollapsed ? "transparent" : "oklch(0.70 0.20 310 / 0.14)" }}
                  onMouseEnter={(e) => { if (createBarCollapsed) { (e.currentTarget as HTMLElement).style.background = "oklch(0.70 0.20 310 / 0.14)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.70 0.20 310)"; } }}
                  onMouseLeave={(e) => { if (createBarCollapsed) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; } }}
                >
                  <Sparkles className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">快速创作栏（开/关）</TooltipContent>
            </Tooltip>}

            {/* Divider (only when add button is shown) */}
            {!isReadOnly && <div style={{ width: 1, height: 18, background: "var(--c-bd2)", flexShrink: 0 }} />}

            {/* Zoom controls — 合并为一个百分比药丸，点击向上弹出缩放菜单（三种模式通用） */}
            <ZoomControl />

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => reactFlow.fitView({ padding: 0.15, duration: 400 })}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                  style={{ color: "var(--c-t3)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">适应视图 · 选中时按 F 缩放到选中</TooltipContent>
            </Tooltip>

            {/* ◆3 回到原点：把视口拉回世界原点(0,0)。标 data-tb-sec → 收缩工具条时隐藏（不常用）。 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-tb-sec
                  onClick={() => reactFlow.setCenter(0, 0, { zoom: 1, duration: 400 })}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                  style={{ color: "var(--c-t3)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
                >
                  <LocateFixed className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">回到原点</TooltipContent>
            </Tooltip>

            {/* 一键整理：按连线方向分层排布自由节点 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-tb-sec
                  aria-label="整理布局（点击循环切换排列方式）"
                  onClick={() => { const r = useCanvasStore.getState().autoLayout(); if (r.count > 0) { toast.success(`已按「${r.label}」整理 ${r.count} 个节点 · 再点切换排列`, { duration: 1600 }); setTimeout(() => reactFlow.fitView({ padding: 0.15, duration: 400 }), 60); } else toast.info("没有可整理的自由节点（群组内节点不参与）"); }}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                  style={{ color: "var(--c-t3)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
                >
                  <Network className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">一键整理画布</TooltipContent>
            </Tooltip>

            {/* 网格吸附开关 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-tb-sec
                  onClick={toggleSnap}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                  style={snapEnabled
                    ? { background: "oklch(0.68 0.22 285 / 0.18)", color: "oklch(0.72 0.18 285)", border: "1px solid oklch(0.68 0.22 285 / 0.4)" }
                    : { color: "var(--c-t3)" }}
                  onMouseEnter={(e) => { if (!snapEnabled) { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; } }}
                  onMouseLeave={(e) => { if (!snapEnabled) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; } }}
                >
                  <Magnet className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">网格吸附{snapEnabled ? "（开）" : "（关）"}</TooltipContent>
            </Tooltip>

            {/* 框选放大区域：开启后在画布拖出矩形，松手放大铺满全屏 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setRegionZoomActive((v) => !v)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                  style={regionZoomActive
                    ? { background: "oklch(0.68 0.22 285 / 0.18)", color: "oklch(0.72 0.18 285)", border: "1px solid oklch(0.68 0.22 285 / 0.4)" }
                    : { color: "var(--c-t3)" }}
                  onMouseEnter={(e) => { if (!regionZoomActive) { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; } }}
                  onMouseLeave={(e) => { if (!regionZoomActive) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; } }}
                >
                  <Scan className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">框选放大区域（拖出矩形放大铺满全屏 · Esc 取消）</TooltipContent>
            </Tooltip>

            {/* Divider */}
            <div style={{ width: 1, height: 18, background: "var(--c-bd2)", flexShrink: 0 }} />

            {/* 运行入口：悬浮工具条「运行」按钮（见上，选择感知）、Shift+R 快捷键、
                每个节点标题栏的「运行/重新生成」、悬停节点的快速运行、以及框选后的「运行全部」。 */}

            {/* Shortcut help button */}
            <div className="relative" data-tb-sec>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    data-tour="shortcuts"
                    onClick={() => setShowShortcuts((v) => !v)}
                    className="w-8 h-8 rounded-xl flex items-center justify-center transition-all text-xs font-bold"
                    style={{
                      color: showShortcuts ? "oklch(0.80 0.18 285)" : "var(--c-t3)",
                      background: showShortcuts ? "oklch(0.68 0.22 285 / 0.15)" : "transparent",
                    }}
                    onMouseEnter={(e) => { if (!showShortcuts) { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; } }}
                    onMouseLeave={(e) => { if (!showShortcuts) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; } }}
                  >
                    ?
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">快捷键列表</TooltipContent>
              </Tooltip>

              {/* Shortcuts panel — LibTV 风四栏（创作 / 缩放 / 移动画布 / 其他），屏幕居中弹窗 */}
              {showShortcuts && (
                <div
                  onClick={() => setShowShortcuts(false)}
                  style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0 0 0 / 0.45)", backdropFilter: "blur(3px)" }}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="animate-scale-in"
                    style={{
                      position: "relative", width: "min(880px, 92vw)", maxHeight: "82vh", overflowY: "auto",
                      borderRadius: 18, padding: "22px 24px",
                      background: "color-mix(in oklch, var(--c-base) 97%, transparent)", backdropFilter: "blur(24px)",
                      border: "1px solid var(--c-bd2)", boxShadow: "0 24px 64px oklch(0 0 0 / 0.6)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--c-t1)" }}>快捷键</span>
                      <button onClick={() => setShowShortcuts(false)} title="关闭（Esc）"
                        style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", color: "var(--c-t3)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                        onMouseEnter={(e)=>{(e.currentTarget as HTMLElement).style.background="var(--c-elevated)";}}
                        onMouseLeave={(e)=>{(e.currentTarget as HTMLElement).style.background="transparent";}}
                      ><X className="w-4 h-4" /></button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 22 }}>
                    {[
                      { group: "创作", items: [
                        { key: "⌘/Ctrl/Alt + G", desc: "成组" },
                        { key: "⌘/Ctrl/Alt + ⇧ + G", desc: "解组" },
                        { key: "⌘/Ctrl + L", desc: "连线（选中 2 个节点）" },
                        { key: "⌘/Ctrl + D", desc: "复制节点和连线" },
                        { key: "⌘/Ctrl + Enter", desc: "生成（运行选中）" },
                        { key: "Tab", desc: "新建节点" },
                        { key: "⌘/Ctrl + A", desc: "全选节点" },
                        { key: "⌘/Ctrl + C / V", desc: "复制 / 粘贴子图" },
                        { key: "Del / ⌫", desc: "删除" },
                        { key: "Esc", desc: "取消选中" },
                      ]},
                      { group: "缩放", items: [
                        { key: "⌘/Ctrl + +", desc: "放大" },
                        { key: "⌘/Ctrl + -", desc: "缩小" },
                        { key: "⌘/Ctrl + 0", desc: "适应画布" },
                        { key: "F", desc: "缩放到选中" },
                        { key: "Ctrl + 滚轮", desc: "缩放画布" },
                      ]},
                      { group: "移动画布", items: [
                        { key: "拖拽空白处", desc: "平移画布" },
                        { key: "滚轮", desc: "上下平移" },
                        { key: "⇧ + 滚轮", desc: "左右平移" },
                        { key: "Alt + ⇧ + F", desc: "整理画布" },
                      ]},
                      { group: "其他", items: [
                        { key: "⌘/Ctrl + Z", desc: "撤销" },
                        { key: "⌘/Ctrl + ⇧ + Z", desc: "重做" },
                        { key: "⇧ + R", desc: "运行工作流" },
                        { key: "⌘/Ctrl + K", desc: "搜索节点" },
                        { key: "⌘/Ctrl + T", desc: "模板面板" },
                        { key: "⌘/Ctrl + S", desc: "保存画布" },
                        { key: "Alt + W", desc: "速览（临时展开参考/提示词）" },
                        { key: "Alt + Q", desc: "极简显示（创意模式，仅留预览框）" },
                        { key: "?", desc: "开关本面板" },
                      ]},
                    ].map(({ group, items }) => (
                      <div key={group}>
                        <p className="text-[10px] font-semibold uppercase tracking-widest mb-2.5" style={{ color: "oklch(0.68 0.16 250)" }}>{group}</p>
                        <div className="flex flex-col gap-2">
                          {items.map(({ key, desc }) => (
                            <div key={key} className="flex items-center justify-between gap-3">
                              <span style={{ fontSize: 12, color: "var(--c-t2)" }}>{desc}</span>
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t2)", whiteSpace: "nowrap", flexShrink: 0 }}>{key}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Connection hints toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-tb-sec
                  data-tour="conn-hints"
                  aria-label="连线指引"
                  aria-pressed={showConnectionHints}
                  onClick={() => setShowConnectionHints(h => !h)}
                  style={{
                    width: 32, height: 32, borderRadius: 10,
                    background: showConnectionHints ? "oklch(0.68 0.22 285 / 0.15)" : "transparent",
                    border: showConnectionHints ? "1px solid oklch(0.68 0.22 285 / 0.35)" : "1px solid transparent",
                    color: showConnectionHints ? "oklch(0.78 0.18 285)" : "var(--c-t4)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer",
                    transition: "all 150ms ease",
                  }}
                >
                  <span style={{ fontSize: 14 }} aria-hidden="true">🔗</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">连线指引</TooltipContent>
            </Tooltip>

            {/* Canvas mode (专业/创意) now lives in the unified UIStyleSwitcher below. */}

            {/* 节点默认模型设置 */}
            <NodeDefaultModelsButton orient={toolbarOrient} />

            {/* 预算管控（画布预估消耗 vs 余额） */}
            <span data-tour="budget" style={{ display: "inline-flex", alignItems: "center" }}><BudgetButton orient={toolbarOrient} /></span>

            {/* UI style switcher (专业 / 创意 / 工作室) */}
            <UIStyleSwitcher orient={toolbarOrient} />

            {/* Theme + background pickers —— 创意(LibTV)模式隐藏：创意皮肤有自己固定的
                媒体优先配色与画布底，主题/背景选择在此模式无意义、只增噪声。 */}
            {canvasMode !== "creative" && (<>
              <span data-tb-sec data-tour="theme" style={{ display: "inline-flex", alignItems: "center" }}><ThemeSwitcher /></span>
              <span data-tb-sec style={{ display: "inline-flex", alignItems: "center" }}><CanvasBgPicker value={canvasBg} onChange={setCanvasBg} /></span>
            </>)}
          </div>

          {/* Filmstrip panel */}
          {showFilmstrip && (
            <FilmstripPanel onClose={() => setShowFilmstrip(false)} />
          )}

          {/* Grid storyboard starter modal */}
          {showGridStoryboard && (
            <GridStoryboardModal projectId={projectId} onClose={() => setShowGridStoryboard(false)} />
          )}
          {directorNodeId && (
            <Suspense fallback={<div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: "#0b0d12" }}><span style={{ color: "var(--c-t3)", fontSize: 13 }}>正在加载 3D 导演台…</span></div>}>
              <DirectorEditor nodeId={directorNodeId} projectId={projectId} onClose={() => setDirectorNodeId(null)} />
            </Suspense>
          )}

          {/* Timeline panel */}
          {showTimeline && (
            <TimelinePanel onClose={() => setShowTimeline(false)} />
          )}

          {/* Version history snapshot panel */}
          {showSnapshots && (
            <SnapshotPanel
              projectId={projectId}
              onSave={(name) => { saveNamedSnapshot(name); }}
              onRestore={restoreNamedSnapshot}
              onDelete={deleteNamedSnapshot}
              onClose={() => setShowSnapshots(false)}
            />
          )}

          {/* Collaborator cursors */}
          <CollaboratorCursors cursors={collaboratorList} viewport={viewport} />

          {/* Collaborators panel */}
          {showCollaborators && (
            <div
              className="absolute top-3 right-3 rounded-xl p-3 min-w-[180px] z-20 animate-scale-in"
              style={{
                background: "color-mix(in oklch, var(--c-base) 95%, transparent)",
                backdropFilter: "blur(20px)",
                border: "1px solid var(--c-bd2)",
                boxShadow: "0 8px 32px oklch(0 0 0 / 0.3)",
              }}
            >
              <p className="text-[10px] font-medium uppercase tracking-wider mb-2.5" style={{ color: "var(--c-t4)" }}>
                在线协作者
              </p>
              <div className="flex items-center gap-2 py-1">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white"
                  style={{ background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))" }}
                >
                  {(user?.name ?? "U")[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-xs font-medium" style={{ color: "var(--c-t1)" }}>{user?.name ?? "我"}</p>
                  <p className="text-[10px]" style={{ color: "var(--c-t4)" }}>本人</p>
                </div>
              </div>
              {collaboratorList.map((c) => (
                <div key={c.userId} className="flex items-center gap-2 py-1">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white"
                    style={{ background: c.color }}
                  >
                    {c.userName[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-medium" style={{ color: "var(--c-t1)" }}>{c.userName}</p>
                    <p className="text-[10px]" style={{ color: "var(--c-t4)" }}>协作中</p>
                  </div>
                </div>
              ))}
              {collaboratorList.length === 0 && (
                <p className="text-xs mt-1" style={{ color: "var(--c-t4)" }}>暂无其他协作者</p>
              )}
              <div className="h-px my-2" style={{ background: "var(--c-bd1)" }} />
              <button
                onClick={() => { setShowCollaboratorPanel(true); setShowCollaborators(false); }}
                className="w-full mt-1 px-2 py-1.5 rounded-md text-xs font-medium"
                style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}
              >
                管理协作 / 邀请成员
              </button>
            </div>
          )}

          {showCollaboratorPanel && project && (
            <CollaborationPanel
              projectId={projectId}
              currentUserRole={(project as { role?: "owner" | "viewer" | "editor" | "admin" }).role ?? "viewer"}
              publicReadAccess={(project as { publicReadAccess?: boolean }).publicReadAccess ?? false}
              onClose={() => setShowCollaboratorPanel(false)}
            />
          )}
        </div>

        {/* ── Template panel (full-screen modal) ── */}
        {showTemplates && (
          <TemplatePanel
            onClose={() => setShowTemplates(false)}
            centerX={(() => { const vp = reactFlow.getViewport(); return (window.innerWidth / 2 - vp.x) / vp.zoom; })()}
            centerY={(() => { const vp = reactFlow.getViewport(); return (window.innerHeight / 2 - vp.y) / vp.zoom; })()}
          />
        )}

        {/* ── ComfyUI node template library (full-param, click → new node) ── */}
        {showNodeLib && (
          <NodeTemplateLibrary
            onClose={() => { setShowNodeLib(false); setTplLibConnect(null); }}
            onUse={addNodeFromTemplate}
          />
        )}

        {/* ── Save-to-library dialog (name + note + model preview) ── */}
        {comfySaveTarget && (
          <SaveComfyTemplateDialog
            nodeType={comfySaveTarget.nodeType}
            defaultName={comfySaveTarget.defaultName}
            useCloud={comfySaveTarget.useCloud}
            thumbnail={comfySaveTarget.thumbnail}
            modelInfo={describeComfyTemplate(comfySaveTarget.nodeType, comfySaveTarget.payload)}
            onCancel={() => setComfySaveTarget(null)}
            onSave={(label, note, overwriteId) => {
              const target = comfySaveTarget;
              setComfySaveTarget(null);
              if (overwriteId != null) {
                updateComfyTemplateMut.mutate(
                  {
                    id: overwriteId, label, payload: target.payload,
                    note: note || undefined,
                    thumbnail: target.thumbnail,
                    useCloud: target.nodeType === "comfyui_workflow" ? target.useCloud : undefined,
                  },
                  {
                    onSuccess: () => {
                      utils.comfyTemplates.list.invalidate();
                      toast.success(`已覆盖更新模板「${label}」`);
                    },
                    onError: (e) => toast.error("覆盖失败：" + e.message),
                  },
                );
                return;
              }
              createComfyTemplateMut.mutate(
                {
                  label, nodeType: target.nodeType, payload: target.payload,
                  note: note || undefined,
                  thumbnail: target.thumbnail,
                  useCloud: target.nodeType === "comfyui_workflow" ? target.useCloud : undefined,
                },
                {
                  onSuccess: (saved) => {
                    utils.comfyTemplates.list.invalidate();
                    toast.success(`已存入共享模板库「${saved.label}」`);
                  },
                  onError: (e) => toast.error("保存失败：" + e.message),
                },
              );
            }}
          />
        )}

        {/* 画布级图片放大预览（节点参考图点击放大） */}
        <NodeImageLightbox />
        {/* 就地对比查看器（openNodeCompare 打开；不建对比节点） */}
        <CompareLightbox />
        {/* 画布拾取模式浮条（＋参考=从画布选择参考 / 标记=元素选择模式） */}
        <PickModeBar />

        {/* ── Asset panel (floating, draggable, resizable) ── */}
        {showCharLib && <CharacterLibraryPanel onClose={() => setShowCharLib(false)} />}
        {showPromptLib && <PromptLibraryPanel onClose={() => setShowPromptLib(false)} />}
        {showAssets && (
          <FloatingAssetPanel projectId={projectId} onClose={() => setShowAssets(false)} />
        )}

        {/* ── LibTV 化 2.4：资产管理左栏（画布大纲 + 资产双 tab，左侧滑入） ── */}
        <CanvasLeftPanel open={showLeftPanel && !isPopout} projectId={projectId} onClose={() => setShowLeftPanel(false)} />

        {/* ── 阶段四 4.2：特效广场 ── */}
        {showPlaza && <EffectsPlaza onClose={() => setShowPlaza(false)} />}

        {/* ── Stats sidebar ── */}
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 200,
            background: "var(--c-base)",
            borderLeft: "1px solid var(--c-bd1)",
            display: "flex",
            flexDirection: "column",
            transform: (showStatsSidebar && !isPopout) ? "translateX(0)" : "translateX(100%)",
            transition: "transform 280ms cubic-bezier(0.23, 1, 0.32, 1)",
            zIndex: 15,
            pointerEvents: showStatsSidebar ? "auto" : "none",
          }}
        >
          <div className="p-3 flex flex-col gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--c-t4)" }}>
              画布统计
            </p>

            {/* Node counts by type */}
            <div className="flex flex-col gap-1.5">
              {NODE_TYPE_LIST.map((config) => {
                const count = nodes.filter((n) => n.data.nodeType === config.type).length;
                if (count === 0) return null;
                return (
                  <div key={config.type} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: config.color }}
                      />
                      <span style={{ fontSize: 11, color: "var(--c-t2)" }}>{config.label}</span>
                    </div>
                    <span
                      className="font-mono text-[11px] px-1.5 py-0.5 rounded"
                      style={{ background: `${config.color}18`, color: config.color, border: `1px solid ${config.color}28` }}
                    >
                      {count}
                    </span>
                  </div>
                );
              })}
              {nodes.length === 0 && (
                <p style={{ fontSize: 11, color: "var(--c-t4)" }}>暂无节点</p>
              )}
            </div>

            <div style={{ height: 1, background: "var(--c-bd1)" }} />

            {/* Edge count */}
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 11, color: "var(--c-t3)" }}>连接数</span>
              <span className="font-mono text-[11px]" style={{ color: "var(--c-t2)" }}>{edges.length}</span>
            </div>

            {/* Total nodes */}
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 11, color: "var(--c-t3)" }}>节点总数</span>
              <span className="font-mono text-[11px]" style={{ color: "var(--c-t2)" }}>{nodes.length}</span>
            </div>

            {/* Last run status */}
            {(runState.completedIds.length > 0 || runState.failedIds.length > 0) && !runState.running && (
              <>
                <div style={{ height: 1, background: "var(--c-bd1)" }} />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "var(--c-t4)" }}>
                    上次运行
                  </p>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ background: "oklch(0.72 0.18 155)" }} />
                    <span style={{ fontSize: 11, color: "var(--c-t2)" }}>
                      {runState.completedIds.length} 完成
                    </span>
                  </div>
                  {runState.failedIds.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: "oklch(0.62 0.22 25)" }} />
                      <span style={{ fontSize: 11, color: "var(--c-t2)" }}>
                        {runState.failedIds.length} 失败
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Workflow progress bar ── */}
      {runState.running && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 flex items-center gap-3 px-4 py-2"
          style={{
            background: "color-mix(in oklch, var(--c-base) 95%, transparent)",
            backdropFilter: "blur(20px)",
            borderTop: "1px solid var(--c-bd2)",
          }}
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" style={{ color: "oklch(0.68 0.22 285)" }} />
          <div className="flex-1">
            <div
              className="h-1.5 rounded-full overflow-hidden"
              style={{ background: "var(--c-bd1)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: runState.runnableCount > 0
                    ? `${(runState.completedIds.length / runState.runnableCount) * 100}%`
                    : "0%",
                  background: "linear-gradient(90deg, oklch(0.68 0.22 285), oklch(0.65 0.20 160))",
                }}
              />
            </div>
          </div>
          <span className="text-[11px] font-mono flex-shrink-0" style={{ color: "var(--c-t3)" }}>
            运行中 {runState.completedIds.length}/{runState.runnableCount}
          </span>
        </div>
      )}

      {/* ── Context menu ── */}
      {contextMenu && (() => {
        const ctxNode = contextMenu.nodeId ? nodes.find((n) => n.id === contextMenu.nodeId) : undefined;
        const ctxPinned = Boolean((ctxNode?.data.payload as { pinned?: boolean } | undefined)?.pinned);
        const ctxNodeType = ctxNode?.data.nodeType;
        // ComfyUI nodes use the dedicated 节点模板库 (full params incl. prompts)
        // instead of the generic per-type setting templates.
        const ctxIsComfy = isComfyNodeType(ctxNodeType);
        // tplBump is read so this list refreshes after a save/delete.
        void tplBump;
        const ctxTemplates = ctxNodeType && !ctxIsComfy ? listNodeTemplates(ctxNodeType) : [];
        // 群组：选中 ≥2 个非 group 节点 → 可组合；右键 group 容器 → 可解组。
        const selectedGroupableIds = nodes.filter((n) => n.selected && n.data.nodeType !== "group").map((n) => n.id);
        return (
          <ContextMenu
            x={contextMenu.x} y={contextMenu.y}
            type={contextMenu.type} nodeId={contextMenu.nodeId}
            nodePinned={ctxPinned}
            onClose={() => setContextMenu(null)}
            onAddNode={handleAddNode}
            onAutoLayout={() => { const r = useCanvasStore.getState().autoLayout(); if (r.count > 0) { toast.success(`已按「${r.label}」整理 ${r.count} 个节点 · 再点切换排列`, { duration: 1600 }); setTimeout(() => reactFlow.fitView({ padding: 0.15, duration: 400 }), 60); } else toast.info("没有可整理的自由节点（群组内节点不参与）"); }}
            // LibTV-D 画布根菜单：上传素材 / 撤销 / 重做 / 粘贴（只读画布不提供编辑项）
            onOpenAssets={() => setShowAssets(true)}
            onUndo={!isReadOnly ? handleUndo : undefined}
            onRedo={!isReadOnly ? handleRedo : undefined}
            onPaste={!isReadOnly && clipboardRef.current.length > 0 ? () => {
              const store = useCanvasStore.getState();
              pasteCountRef.current += 1;
              const off = 50 + 40 * pasteCountRef.current;
              const before = snapshotGraphIds();
              const newIds = store.cloneSubgraph(clipboardRef.current, { x: off, y: off });
              emitGraphAdditions(before);
              if (newIds.length > 0) toast.success(`已粘贴 ${newIds.length} 个节点`, { duration: 1200 });
            } : undefined}
            onOpenNodeLibrary={() => { setContextMenu(null); setShowNodeLib(true); }}
            nodeTemplates={ctxTemplates}
            onSaveToLibrary={ctxNode && ctxIsComfy ? () => {
              const payload = ctxNode.data.payload as Record<string, unknown>;
              const useCloud = (payload as { useCloudComfy?: boolean }).useCloudComfy === true;
              // Auto-fill the model name as the default template name (editable in the dialog).
              const defaultName = suggestComfyTemplateName(ctxNodeType as ComfyNodeType, payload) || ctxNode.data.title;
              const thumbnail = extractComfyThumbnail(ctxNodeType as ComfyNodeType, payload);
              setComfySaveTarget({ nodeType: ctxNodeType as ComfyNodeType, payload, useCloud, defaultName, thumbnail });
            } : undefined}
            onSaveTemplate={ctxNode && !ctxIsComfy ? () => {
              const label = window.prompt("模板名称", ctxNode.data.title)?.trim();
              if (!label) return;
              const saved = saveNodeTemplate(ctxNodeType!, label, ctxNode.data.payload as Record<string, unknown>);
              setTplBump((v) => v + 1);
              toast[saved ? "success" : "error"](saved ? `已存为模板「${saved.label}」` : "保存失败（数量已达上限或内容过大）");
            } : undefined}
            onApplyTemplate={ctxNode && !ctxIsComfy ? (id) => {
              const tpl = listNodeTemplates(ctxNodeType!).find((t) => t.id === id);
              if (!tpl) return;
              updateNodeData(ctxNode.id, tpl.payload as Partial<NodeData>);
              toast.success(`已应用模板「${tpl.label}」`);
            } : undefined}
            onDeleteTemplate={ctxNodeType && !ctxIsComfy ? (id) => {
              deleteNodeTemplate(ctxNodeType, id);
              setTplBump((v) => v + 1);
            } : undefined}
            onExportTemplates={ctxNodeType && !ctxIsComfy ? () => {
              const json = exportNodeTemplatesJson(ctxNodeType);
              if (!json) { toast.info("该节点类型还没有已保存的模板"); return; }
              downloadTextFile(`${ctxNodeType}-templates.json`, json);
            } : undefined}
            onImportTemplates={ctxNodeType && !ctxIsComfy ? (file) => {
              file.text().then((txt) => {
                const { imported, skipped } = importNodeTemplatesJson(ctxNodeType, txt);
                setTplBump((v) => v + 1);
                toast[imported > 0 ? "success" : "error"](
                  imported > 0
                    ? `已导入 ${imported} 个模板${skipped ? `（跳过 ${skipped}）` : ""}`
                    : "未导入任何模板（格式不符或重名）",
                );
              }).catch(() => toast.error("读取文件失败"));
            } : undefined}
            onDeleteNode={contextMenu.nodeId ? () => {
              const nid = contextMenu.nodeId!;
              deleteNode(nid);
              deleteNodeMutation.mutate({ id: nid, projectId });
              emitCollabEvent("node:delete", { id: nid });
            } : undefined}
            onDuplicateNode={contextMenu.nodeId ? () => { const before = snapshotGraphIds(); duplicateNode(contextMenu.nodeId!); emitGraphAdditions(before); } : undefined}
            onGroup={selectedGroupableIds.length >= 2 ? () => {
              const before = snapshotGraphIds();
              const gid = useCanvasStore.getState().groupSelected(selectedGroupableIds);
              if (gid) { emitGraphAdditions(before); toast.success(`已组合 ${selectedGroupableIds.length} 个节点为群组`); }
            } : undefined}
            onUngroup={ctxNodeType === "group" ? () => {
              const gid = contextMenu.nodeId!;
              useCanvasStore.getState().ungroup(gid);
              deleteNodeMutation.mutate({ id: gid, projectId });
              emitCollabEvent("node:delete", { id: gid });
            } : undefined}
            onDeleteGroup={ctxNodeType === "group" ? () => {
              const gid = contextMenu.nodeId!;
              const cnt = (((nodes.find((n) => n.id === gid)?.data.payload) as GroupNodeData | undefined)?.childIds ?? []).length;
              if (!window.confirm(`确定删除该群组及其 ${cnt} 个成员节点？此操作可撤销（Ctrl+Z）。`)) return;
              const removed = useCanvasStore.getState().deleteGroupWithMembers(gid);
              for (const rid of removed) {
                deleteNodeMutation.mutate({ id: rid, projectId });
                emitCollabEvent("node:delete", { id: rid });
              }
            } : undefined}
            onDuplicateGroup={ctxNodeType === "group" ? () => {
              const before = snapshotGraphIds();
              const gid = useCanvasStore.getState().duplicateGroup(contextMenu.nodeId!);
              if (gid) {
                emitGraphAdditions(before);
                const cnt = (((useCanvasStore.getState().nodes.find((n) => n.id === gid)?.data.payload) as GroupNodeData | undefined)?.childIds ?? []).length;
                toast.success(`已复制群组及 ${cnt} 个成员`);
              }
            } : undefined}
            onRunWorkflow={contextMenu.nodeId && ctxNodeType !== "group" ? () => handleRunRequest(contextMenu.nodeId ?? null) : undefined}
            // LibTV 化 1.7：带图节点 → 以结果图为参考图新建角色主体节点（对齐「创建主体」）。
            onSaveAsCharacter={(() => {
              if (!ctxNode || ctxNodeType === "group" || ctxNodeType === "character") return undefined;
              const p = ctxNode.data.payload as Record<string, unknown>;
              const img = (typeof p.imageUrl === "string" && p.imageUrl) || (typeof p.resultImageUrl === "string" && p.resultImageUrl) || (typeof p.outputUrl === "string" && /\.(png|jpe?g|webp)(\?|#|$)/i.test(p.outputUrl) && p.outputUrl) || "";
              if (!img) return undefined;
              return () => {
                const st = useCanvasStore.getState();
                const self = st.nodes.find((n) => n.id === ctxNode.id);
                if (!self) return;
                const node = st.addNode("character", { x: self.position.x, y: self.position.y + 420 });
                st.updateNodeTitle(node.id, "角色主体");
                st.updateNodeData(node.id, { characterKind: "person", name: "", referenceImageUrl: img });
                st.setNodes(st.nodes.map((n) => ({ ...n, selected: n.id === node.id })));
                toast.success("已创建角色主体节点（本图作参考）——补充姓名/外貌后连到分镜或生成节点即可跨镜保持一致");
              };
            })()}
            // Pin: toggle payload.pinned so the node's input area stays expanded
            // even when the user clicks elsewhere on the canvas.
            onTogglePin={contextMenu.nodeId ? () => {
              updateNodeData(contextMenu.nodeId!, { pinned: !ctxPinned });
            } : undefined}
            nodeLocked={Boolean((ctxNode?.data.payload as { locked?: boolean } | undefined)?.locked)}
            onToggleLock={contextMenu.nodeId ? () => {
              const wasLocked = Boolean((ctxNode?.data.payload as { locked?: boolean } | undefined)?.locked);
              updateNodeData(contextMenu.nodeId!, { locked: !wasLocked });
            } : undefined}
            // 跳过执行（payload.disabled）：运行全部/框选运行整体跳过、估价不计。
            // 仅对参与「运行全部」的可运行类型展示——其它类型本就不执行，开关无意义。
            nodeDisabled={Boolean((ctxNode?.data.payload as { disabled?: boolean } | undefined)?.disabled)}
            onToggleDisabled={contextMenu.nodeId && ctxNode && RUNNABLE_TYPES.includes(ctxNode.data.nodeType as NodeType) ? () => {
              const was = Boolean((ctxNode?.data.payload as { disabled?: boolean } | undefined)?.disabled);
              updateNodeData(contextMenu.nodeId!, { disabled: !was });
              toast.success(was ? "已恢复参与执行" : "已设为跳过执行（运行/估价均不再包含该节点）", { duration: 2000 });
            } : undefined}
            // Collapse: clear pinned + deselect the node so it returns to its
            // compact preview-only height.
            onCollapse={contextMenu.nodeId ? () => {
              const nid = contextMenu.nodeId!;
              updateNodeData(nid, { pinned: false });
              setNodes(nodes.map((n) => n.id === nid ? { ...n, selected: false } : n));
            } : undefined}
          />
        );
      })()}

      {/* ── 拉线松手建节点小菜单（落在空白处时，仅列可连接类型）── */}
      {connectMenu && (
        <>
          {/* 透明遮罩：点击空白 / Esc 关闭 */}
          <div
            onClick={() => setConnectMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setConnectMenu(null); }}
            style={{ position: "fixed", inset: 0, zIndex: 100050 }}
          />
          <div
            className="nodrag nowheel"
            style={{
              position: "fixed", left: Math.min(connectMenu.x, window.innerWidth - 200), top: Math.min(connectMenu.y, window.innerHeight - 320),
              zIndex: 100051, minWidth: 168, maxHeight: 300, overflowY: "auto",
              background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 10,
              boxShadow: "0 12px 36px oklch(0 0 0 / 0.45)", padding: 4,
            }}
          >
            <div style={{ fontSize: 9.5, color: "var(--c-t4)", padding: "4px 8px 5px", display: "flex", alignItems: "center", gap: 4 }}>
              <span>{connectMenu.fromHandleType === "source" ? "连接到新节点…" : "从新节点连入…"}</span>
              <span style={{ marginLeft: "auto", opacity: 0.7 }}><GripVertical style={{ width: 9, height: 9, display: "inline" }} /> 拖动排序</span>
            </div>
            {/* #R4-7 搜索框常显 + ↑↓/Enter 键盘导航（与 ⌘K 面板对齐） */}
            {(() => {
              const q = connectSearch.trim().toLowerCase();
              const shown = q ? connectMenu.types.filter((t) => (getNodeConfig(t)?.label ?? CONNECTION_HINTS[t]?.label ?? t).toLowerCase().includes(q)) : connectMenu.types;
              const activeIdx = Math.max(0, Math.min(connectActiveIdx, shown.length - 1));
              const pickType = (t: NodeType) => {
                if (t === "comfyui_workflow") { setTplLibConnect({ x: connectMenu.x, y: connectMenu.y, fromId: connectMenu.fromId, fromHandleType: connectMenu.fromHandleType, fromHandle: connectMenu.fromHandle }); setConnectMenu(null); setShowNodeLib(true); }
                else handlePickConnectType(t);
              };
              const onMenuKey = (e: React.KeyboardEvent) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setConnectActiveIdx((i) => Math.min(i + 1, shown.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setConnectActiveIdx((i) => Math.max(i - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); const t = shown[activeIdx]; if (t) pickType(t); }
                else if (e.key === "Escape") { setConnectMenu(null); }
              };
              return (
                <>
                  <input autoFocus value={connectSearch}
                    onChange={(e) => setConnectSearch(e.target.value)}
                    onKeyDown={onMenuKey}
                    placeholder="搜索节点类型…（↑↓ 选择 · Enter 确认）"
                    style={{ width: "calc(100% - 8px)", margin: "0 4px 4px", boxSizing: "border-box", padding: "6px 8px", fontSize: 12,
                      borderRadius: 7, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }} />
                  {shown.length === 0
                    ? <div style={{ fontSize: 11.5, color: "var(--c-t4)", padding: "8px 10px" }}>无匹配</div>
                    : shown.map((t, idx) => {
              const isActive = idx === activeIdx;
              const cfg = getNodeConfig(t);
              // ComfyUI 自定义节点 → 改为「节点模板库」：点击打开模板库二级列表，选模板后在落点
              // 建节点并连边（替代直接建空白工作流节点）。
              const isTplLib = t === "comfyui_workflow";
              const Icon = isTplLib ? LayoutGrid : (cfg ? (NODE_ICONS[cfg.icon] ?? FileText) : FileText);
              const color = cfg?.color ?? "var(--c-t3)";
              if (isTplLib) {
                return (
                  <div key={t} className="nodrag flex items-center gap-1 w-full"
                    onMouseEnter={() => setConnectActiveIdx(idx)}
                    onDragOver={(e) => { if (connectDragType) e.preventDefault(); }}
                    onDrop={(e) => { e.preventDefault(); if (connectDragType) reorderConnectType(connectDragType, t); setConnectDragType(null); }}
                    style={{ borderRadius: 7, background: isActive ? `${color}1f` : "transparent" }}>
                    <span draggable onDragStart={() => setConnectDragType(t)} onDragEnd={() => setConnectDragType(null)} title="拖动排序" className="flex-shrink-0 flex items-center" style={{ cursor: "grab", color: "var(--c-t4)", padding: "0 1px" }}><GripVertical style={{ width: 12, height: 12 }} /></span>
                    <button onClick={() => { setTplLibConnect({ x: connectMenu.x, y: connectMenu.y, fromId: connectMenu.fromId, fromHandleType: connectMenu.fromHandleType, fromHandle: connectMenu.fromHandle }); setConnectMenu(null); setShowNodeLib(true); }}
                      className="flex items-center gap-2 text-left" style={{ flex: 1, minWidth: 0, padding: "6px 6px", borderRadius: 7, cursor: "pointer", border: "none", background: "transparent", color: "var(--c-t1)", fontSize: 12 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = `${color}1f`)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      <span className="flex items-center justify-center flex-shrink-0" style={{ width: 20, height: 20, borderRadius: 5, background: `${color}1a` }}><Icon style={{ width: 12, height: 12, color }} /></span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>节点模板库<span style={{ color: "var(--c-t4)", marginLeft: 4, fontSize: 10 }}>›</span></span>
                    </button>
                  </div>
                );
              }
              return (
                <div
                  key={t}
                  className="nodrag flex items-center gap-1 w-full"
                  onMouseEnter={() => setConnectActiveIdx(idx)}
                  onDragOver={(e) => { if (connectDragType) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); if (connectDragType) reorderConnectType(connectDragType, t); setConnectDragType(null); }}
                  style={{ borderRadius: 7, background: isActive ? `${color}1f` : (connectDragType === t && connectDragType !== null ? `${color}14` : "transparent") }}
                >
                  {/* 拖拽手柄：按住重排（与单击建节点互不干扰） */}
                  <span
                    draggable
                    onDragStart={() => setConnectDragType(t)}
                    onDragEnd={() => setConnectDragType(null)}
                    title="拖动排序"
                    className="flex-shrink-0 flex items-center"
                    style={{ cursor: "grab", color: "var(--c-t4)", padding: "0 1px" }}
                  >
                    <GripVertical style={{ width: 12, height: 12 }} />
                  </span>
                  <button
                    onClick={() => handlePickConnectType(t)}
                    className="flex items-center gap-2 text-left"
                    style={{ flex: 1, minWidth: 0, padding: "6px 6px", borderRadius: 7, cursor: "pointer", border: "none", background: "transparent", color: "var(--c-t1)", fontSize: 12 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = `${color}1f`)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span className="flex items-center justify-center flex-shrink-0" style={{ width: 20, height: 20, borderRadius: 5, background: `${color}1a` }}>
                      <Icon style={{ width: 12, height: 12, color }} />
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cfg?.label ?? CONNECTION_HINTS[t]?.label ?? t}</span>
                  </button>
                </div>
              );
            })}
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* ── Node search ── */}
      {showNodeSearch && (
        <NodeSearch onClose={() => setShowNodeSearch(false)} />
      )}

      {/* ── Presentation mode ── */}
      {showPresentation && (
        <PresentationMode nodes={nodes} onClose={() => setShowPresentation(false)} />
      )}

      {/* ── Run workflow confirmation dialog ── */}
      {showRunConfirm && (() => {
        // Single source of truth — what the workflow runner will actually execute.
        // Keeping this in sync with RUNNABLE_TYPES prevents the dialog from claiming
        // "N AI nodes will run" for stub/manual-only nodes (pose_control / voice_clone /
        // lip_sync / avatar) that runWorkflow() refuses to dispatch.
        const onlySet = pendingRunOnlyIds ? new Set(pendingRunOnlyIds) : null;
        const scopeNodes = onlySet ? nodes.filter(n => onlySet.has(n.id)) : nodes;
        const aiNodes = scopeNodes.filter(n => RUNNABLE_TYPES.includes(n.data.nodeType as NodeType));
        const totalNodes = scopeNodes.length;
        // 预估本次消耗（复用 BudgetButton 同源的精算函数，逐节点按当前模型/参数汇总）。
        const budget = estimateCanvasBudget(
          scopeNodes.map((n) => ({ id: n.id, data: { nodeType: n.data.nodeType, payload: n.data.payload as Record<string, unknown> } })),
          resolveActiveNodeModel as (nt: string, slot: "llm" | "image" | "video") => string,
          // edges：让「有下游 image_gen 的分镜」按运行器同口径不计价（防 Nano Banana 幻影预算）。
          edges.map((e) => ({ source: e.source, target: e.target })),
        );
        const kieAmount = kieBalQ.data?.configured ? (kieBalQ.data.creditsAmount ?? null) : null;
        const poyoAmount = poyoBalQ.data?.configured ? (poyoBalQ.data.creditsAmount ?? null) : null;
        const overKie = kieAmount != null && budget.pt > kieAmount;
        const overPoyo = poyoAmount != null && budget.cr > poyoAmount;
        const fmtN = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
        const startLabel = onlySet
          ? `仅运行框选的 ${aiNodes.length} 个节点（不自动带上下游）`
          : pendingRunNodeId
            ? `从节点「${nodes.find(n => n.id === pendingRunNodeId)?.data.title ?? pendingRunNodeId}」开始执行`
            : "从头执行全部流程";
        return (
          <div
            style={{
              position: "fixed", inset: 0, zIndex: 9999,
              background: "oklch(0 0 0 / 0.55)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) { runConfirmOpenRef.current = false; setShowRunConfirm(false); setRunConfirmCountdown(5); } }}
          >
            <div style={{
              background: "var(--c-surface)",
              border: "1px solid var(--c-bd2)",
              borderRadius: 16,
              padding: "28px 32px",
              width: 380,
              boxShadow: "0 24px 64px oklch(0 0 0 / 0.4)",
              display: "flex", flexDirection: "column", gap: 16,
            }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>▶</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "var(--c-text)" }}>确认执行工作流</span>
              </div>

              {/* Info */}
              <div style={{ fontSize: 13, color: "var(--c-text-2)", lineHeight: 1.65 }}>
                <div>{startLabel}</div>
                <div style={{ marginTop: 8 }}>
                  共 <b style={{ color: "var(--c-text)" }}>{totalNodes}</b> 个节点，
                  其中 <b style={{ color: "oklch(0.72 0.22 142)" }}>{aiNodes.length}</b> 个 AI 节点将调用大模型接口，消耗相应算力额度。
                </div>
              </div>

              {/* 预估消耗 vs 余额（复用 BudgetButton 同源精算） */}
              {(budget.pt > 0 || budget.cr > 0 || budget.runnableCount > 0) && (
                <div style={{
                  background: "oklch(0.62 0.2 285 / 0.08)", border: "1px solid oklch(0.62 0.2 285 / 0.28)",
                  borderRadius: 10, padding: "10px 13px", fontSize: 12.5, lineHeight: 1.7, color: "var(--c-text-2)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--c-t3)" }}>本次预计消耗</span>
                    {budget.pt > 0 && <b style={{ color: overKie ? "oklch(0.62 0.20 25)" : "oklch(0.78 0.16 285)" }}>≈ ⚡{fmtN(budget.pt)} 点</b>}
                    {budget.pt > 0 && budget.cr > 0 && <span style={{ color: "var(--c-t4)" }}>·</span>}
                    {budget.cr > 0 && <b style={{ color: overPoyo ? "oklch(0.62 0.20 25)" : "oklch(0.72 0.16 250)" }}>≈ {fmtN(budget.cr)} cr</b>}
                    {budget.pt === 0 && budget.cr === 0 && <b style={{ color: "var(--c-t2)" }}>本地/免费</b>}
                    {budget.approx && <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>（近似）</span>}
                  </div>
                  {(kieAmount != null || poyoAmount != null) && (
                    <div style={{ fontSize: 11, color: "var(--c-t4)", marginTop: 2 }}>
                      余额 {kieAmount != null && `kie ${fmtN(kieAmount)} 点`}{kieAmount != null && poyoAmount != null && " · "}{poyoAmount != null && `Poyo ${fmtN(poyoAmount)} cr`}
                    </div>
                  )}
                  {(overKie || overPoyo) && (
                    <div style={{ marginTop: 5, color: "oklch(0.68 0.20 25)", fontWeight: 600 }}>
                      ⚠️ 预估消耗已超当前余额，运行可能中途失败——请先充值或减少节点。
                    </div>
                  )}
                  {budget.unknownCount > 0 && (
                    <div style={{ fontSize: 10.5, color: "var(--c-t4)", marginTop: 2 }}>{budget.unknownCount} 项未估价（未选模型/无固定价），实际以账单为准。</div>
                  )}
                </div>
              )}

              {/* Warning */}
              <div style={{
                background: "oklch(0.78 0.18 60 / 0.1)",
                border: "1px solid oklch(0.78 0.18 60 / 0.3)",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 12,
                color: "oklch(0.78 0.18 60)",
                lineHeight: 1.7,
              }}>
                <div>⚠️ 执行过程中将按实际调用次数计费，请确认后再继续。</div>
                <div style={{ marginTop: 4 }}>📋 请确认所有节点 AI 模型选择正确，避免使用错误模型造成额度浪费。</div>
              </div>

              {/* Buttons */}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <button
                  onClick={() => { runConfirmOpenRef.current = false; setShowRunConfirm(false); setRunConfirmCountdown(5); }}
                  style={{
                    padding: "7px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                    background: "var(--c-surface-2)", border: "1px solid var(--c-bd2)",
                    color: "var(--c-text-2)", cursor: "pointer",
                  }}
                >
                  取消
                </button>
                <button
                  disabled={runConfirmCountdown > 0 || runState.running}
                  onClick={() => {
                    runConfirmOpenRef.current = false;
                    setShowRunConfirm(false);
                    runWorkflow(pendingRunNodeId, { onlyIds: pendingRunOnlyIds ?? undefined });
                  }}
                  style={{
                    padding: "7px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                    background: (runConfirmCountdown > 0 || runState.running)
                      ? "oklch(0.72 0.22 142 / 0.07)"
                      : "oklch(0.72 0.22 142 / 0.15)",
                    border: `1px solid oklch(0.72 0.22 142 / ${(runConfirmCountdown > 0 || runState.running) ? "0.2" : "0.5"})`,
                    color: (runConfirmCountdown > 0 || runState.running) ? "oklch(0.72 0.22 142 / 0.45)" : "oklch(0.72 0.22 142)",
                    cursor: (runConfirmCountdown > 0 || runState.running) ? "not-allowed" : "pointer",
                    minWidth: 110,
                    transition: "all 0.3s ease",
                  }}
                >
                  {runState.running ? "运行中…" : runConfirmCountdown > 0 ? `确认执行 (${runConfirmCountdown}s)` : "确认执行"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {!isPopout && chatOpen && <CanvasChatWindow onClose={() => setChatOpen(false)} />}
      {/* 聊天窗关闭时的常驻通知监听器：收新消息给声音/桌面/横幅提醒 + 顶栏红点（窗打开时由 ChatProvider 负责） */}
      {!isPopout && !chatOpen && isAuthenticated && <CanvasChatNotifier onNewMessage={() => setChatUnread((n) => n + 1)} />}
      {/* 持续公告进入提醒：每次进入画布弹 5 秒自动消失的顶部横幅（不依赖聊天窗开关） */}
      {!isPopout && isAuthenticated && <CanvasAnnounceBanner />}
      {!isPopout && !isReadOnly && agentChatOpen && <CanvasAgentChat projectId={projectId} onClose={() => setAgentChatOpen(false)} />}
    </div>
   </NodeDefaultModelsProvider>
  );
}

export default function Canvas() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId ?? "0", 10);
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/");
  }, [loading, isAuthenticated, navigate]);

  // Show auth loading screen — prevents CanvasInner from rendering with isAuthenticated=false
  // which would cause projectLoading to never resolve (query is disabled when not authenticated)
  if (loading) {
    return (
      <div
        className="w-screen h-screen flex flex-col items-center justify-center gap-3"
        style={{ background: "var(--c-canvas)" }}
      >
        <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center">
          <img src="/chat-icon.svg" alt="KingTai" className="w-full h-full object-cover" />
        </div>
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--c-t4)" }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          验证身份中...
        </div>
      </div>
    );
  }

  if (!projectId || isNaN(projectId)) {
    return (
      <div className="w-screen h-screen flex items-center justify-center" style={{ background: "var(--c-canvas)", color: "var(--c-t4)" }}>
        无效的项目 ID
      </div>
    );
  }

  // Only mount CanvasInner once auth is confirmed — avoids infinite loading spinner
  if (!isAuthenticated) return null;

  return (
    <ReactFlowProvider>
      <CanvasInner projectId={projectId} />
    </ReactFlowProvider>
  );
}
