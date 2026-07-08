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
import { useCanvasStore, aspectToComfyWH, type CanvasNode, type CanvasEdge } from "../hooks/useCanvasStore";
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
import { CharacterLibraryPanel } from "../components/canvas/CharacterLibraryPanel";
import { PromptLibraryPanel } from "../components/canvas/PromptLibraryPanel";
import { setLibraryCharacters } from "../lib/characterConditioning";
import { setPromptLibrary } from "../lib/promptLibraryStore";
import { ChangePasswordDialog } from "../components/ChangePasswordDialog";
import { NodeImageLightbox } from "../components/canvas/NodeImageLightbox";
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
import { setBoxSelecting } from "../hooks/useBoxSelecting";
import { useEdgeInsert } from "../hooks/useEdgeInsert";
import { StudioCreateBar } from "../components/canvas/studio/StudioCreateBar";
import { ModelQuickSwitch, MODEL_SWITCH_FIELD } from "../components/canvas/studio/ModelQuickSwitch";
import { isConnectionValid, getCompatibleTargets, getCompatibleSources, CONNECTION_HINTS, defaultTargetHandle } from "../lib/connectionRules";
import { listNodeTemplates, saveNodeTemplate, deleteNodeTemplate, exportNodeTemplatesJson, importNodeTemplatesJson } from "../lib/nodeTemplates";
import { isComfyNodeType, suggestComfyTemplateName, describeComfyTemplate, extractComfyThumbnail, type ComfyNodeType } from "../lib/comfyNodeTemplates";
import { SaveComfyTemplateDialog } from "../components/canvas/SaveComfyTemplateDialog";
import { downloadMedia, downloadTextFile } from "@/lib/download";
import { BeginnerGuide, ConnectionHintsPanel } from "../components/canvas/BeginnerGuide";
import { GuidedTour } from "../components/canvas/GuidedTour";
import { NotifySettingsDialog } from "../components/canvas/NotifySettingsDialog";
import { useGuideStore } from "../hooks/useGuideStore";
import type { TourStep } from "../lib/guideSteps";
import { HelpPanel } from "../components/canvas/HelpPanel";
import { CollaborationPanel } from "../components/canvas/CollaborationPanel";
import { NarrativeArcPicker } from "../components/canvas/NarrativeArcPicker";
import { WorkflowStatusPanel } from "../components/canvas/WorkflowStatusPanel";
import { ThemeSwitcher } from "../components/canvas/ThemeSwitcher";
import { UIStyleSwitcher } from "../components/canvas/UIStyleSwitcher";
import { CanvasBgPicker, loadCanvasBg, type CanvasBg } from "../components/canvas/CanvasBgPicker";
import { useCanvasMode } from "../contexts/CanvasModeContext";
import { useTheme, THEMES } from "../contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import type { NodeType, NodeData, GroupNodeData } from "../../../shared/types";
import { getNodeConfig, NODE_TYPE_LIST, NODE_ICONS, COLLABORATOR_COLORS, type NodeConfig } from "../lib/nodeConfig";
import { sortNodeConfigsForPalette } from "../lib/nodeOrder";
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
} from "lucide-react";
import { loadNamedSnapshots, type NamedSnapshot } from "../hooks/useCanvasStore";
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
  return {
    type: n.data.nodeType,
    title: n.data.title,
    data: n.data.payload as Record<string, unknown>,
    posX: n.position.x,
    posY: n.position.y,
    width: (n.style?.width as number) ?? 320,
    height: (n.style?.height as number | undefined) ?? 0,
    zIndex: n.zIndex ?? 0,
  };
}
function nodeSig(n: CanvasNode): string {
  return JSON.stringify(nodeUpsertFields(n));
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
  const isLight = !themeIsDark || canvasMode === "creative";
  // Effective canvas background: in "follow theme" mode use the theme's own
  // --c-canvas (so switching theme updates it) with a theme-appropriate pattern
  // color; otherwise use the user's explicit picker color.
  const effectiveBgColor = canvasBg.followTheme ? "var(--c-canvas)" : canvasBg.bgColor;
  const effectivePatternColor = canvasBg.followTheme
    ? (themeIsDark ? "oklch(0.32 0.010 260 / 0.6)" : "oklch(0.60 0.010 260 / 0.5)")
    : canvasBg.patternColor;
  // Auto-show the filmstrip when ENTERING creative mode and hide when LEAVING —
  // but only on an actual mode transition, so the persisted open-state isn't
  // clobbered on mount/reload.
  const prevCanvasModeRef = useRef(canvasMode);
  useEffect(() => {
    const prev = prevCanvasModeRef.current;
    if (prev === canvasMode) return;
    prevCanvasModeRef.current = canvasMode;
    if (canvasMode === "creative") setShowFilmstrip(true);
    else setShowFilmstrip(false);
  }, [canvasMode, setShowFilmstrip]);
  const [connectingFromType, setConnectingFromType] = useState<NodeType | null>(null);
  // 拉线松手落在空白处时，在鼠标位置弹出的「建节点并连线」小菜单（仅列可连接类型）。
  const [connectMenu, setConnectMenu] = useState<{ x: number; y: number; types: NodeType[]; fromId: string; fromHandleType: "source" | "target"; fromHandle: string | null } | null>(null);
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
  const { runState, runWorkflow, reset: resetWorkflowRun } = useWorkflowRunner();
  const [showRunConfirm, setShowRunConfirm] = useState(false);
  const [pendingRunNodeId, setPendingRunNodeId] = useState<string | null>(null);
  // When set, the run is restricted to exactly these (box-selected) node ids.
  const [pendingRunOnlyIds, setPendingRunOnlyIds] = useState<string[] | null>(null);
  const [runConfirmCountdown, setRunConfirmCountdown] = useState(3);
  const runConfirmOpenRef = useRef(false);
  const runStateRunningRef = useRef(false);
  runStateRunningRef.current = runState.running;
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
    "ui:toolbar:collapsed:v1", false,
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
  const saveCanvasRef = useRef<(() => Promise<void>) | null>(null);
  // Baseline of what each node looked like at last successful save/load (id → sig).
  // saveCanvas upserts only nodes whose sig changed and deletes ids that vanished.
  const savedNodeSigsRef = useRef<Map<string, string>>(new Map());

  // ── Data loading ────────────────────────────────────────────────────────────
  const { data: project, isLoading: projectLoading, isError: projectError } = trpc.projects.get.useQuery(
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
    // so we never nuke the project's nodes from a bad snapshot.
    if (toDelete.length > 0 && currentSigs.size === 0 && baseline.size > 0) {
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
    // Edges + viewport persist regardless of node-save outcome.
    try {
      for (const edge of edges) {
        await upsertEdge.mutateAsync({
          id: edge.id, projectId, sourceNodeId: edge.source, targetNodeId: edge.target,
          sourcePort: edge.sourceHandle ?? "output", targetPort: edge.targetHandle ?? "input",
          label: typeof edge.label === "string" ? edge.label : undefined,
        });
      }
    } catch (e) { console.error("[save] edge upsert failed:", e); }
    try {
      // A popout window keeps its viewport local (independent second-monitor view)
      // so it never clobbers the main window's shared, server-persisted viewport.
      if (isPopout) localStorage.setItem(popoutVpKey, JSON.stringify(reactFlow.getViewport()));
      else await updateProject.mutateAsync({ id: projectId, viewportState: reactFlow.getViewport() });
    } catch (e) { console.error("[save] viewport save failed:", e); }

    // Only advance the node baseline / mark clean when ALL node ops landed, so a
    // failed node retries next save (but viewport/edges already persisted above).
    if (nodesOk) { savedNodeSigsRef.current = currentSigs; markClean(); }
    } finally { savingRef.current = false; }
  }, [isReadOnly, isDirty, nodes, edges, projectId, batchUpsertNodes, upsertEdge, updateProject, markClean, reactFlow, deleteNodeMutation]);
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

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const socket = io("/", { path: "/api/socket", transports: ["websocket", "polling"], withCredentials: true });
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
      applyRemoteMutation(event);
    });

    // Same-browser window sync (multi-monitor). Note: a BroadcastChannel never
    // receives its own posts, so no self-echo filtering is needed.
    try {
      const bc = new BroadcastChannel(`canvas-sync:${projectId}`);
      bc.onmessage = (e: MessageEvent) => { const d = e.data as { type?: string; payload?: unknown }; if (d?.type) applyRemoteMutation({ type: d.type, payload: d.payload }); };
      bcRef.current = bc;
    } catch { /* BroadcastChannel unsupported — socket still covers cross-device */ }

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
    if (collapsedHiddenIds.size === 0 && highlightIds.size === 0) {
      return { displayNodes: nodes, displayEdges: edges };
    }
    const dNodes = nodes.map((n) => {
      const hide = collapsedHiddenIds.has(n.id);
      const hl = highlightIds.has(n.id) && !hide;
      if (!hide && !hl) return n;
      return {
        ...n,
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
  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (
      t.closest(".react-flow__node") ||
      t.closest(".react-flow__edge") ||
      t.closest(".react-flow__controls") ||
      t.closest(".react-flow__minimap") ||
      t.closest("button, input, textarea, [contenteditable='true']")
    ) return;
    handleCanvasContextMenu(e);
  }, [handleCanvasContextMenu]);

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
    return isConnectionValid(sourceNode.data.nodeType, targetNode.data.nodeType);
  }, [nodes]);

  const handleConnectStart = useCallback((_: unknown, params: { nodeId: string | null; handleType: string | null }) => {
    if (params.nodeId) {
      const node = nodes.find(n => n.id === params.nodeId);
      if (node) {
        setConnectingFromType(node.data.nodeType);
        // Drive valid-target handle highlighting across the canvas.
        useConnectingStore.getState().begin(node.id, node.data.nodeType, params.handleType === "target" ? "target" : "source");
      }
    }
  }, [nodes]);

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: { isValid: boolean | null; toNode?: { id: string } | null; fromHandle?: { id?: string | null } | null }) => {
    const drag = useConnectingStore.getState();
    const fromType = drag.fromType, fromId = drag.fromId, fromHandleType = drag.fromHandleType;
    const fromHandle = connectionState.fromHandle?.id ?? null;
    setConnectingFromType(null);
    useConnectingStore.getState().end();
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
      const r = importGraph(graph);
      if (r.nodes === 0) { toast.error("未导入任何节点（类型不识别或格式不符）"); return; }
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
          store.runBatch(() => {
            groupSel.forEach(g => store.duplicateGroup(g.id));
            loose.forEach(n => store.duplicateNode(n.id));
          });
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
        const newIds = store.cloneSubgraph(clipboardRef.current, { x: off, y: off });
        if (newIds.length > 0) toast.success(`已粘贴 ${newIds.length} 个节点`, { duration: 1200 });
      }

      // 群组：Cmd/Ctrl+G 组合选中节点；Cmd/Ctrl+Shift+G 解组（删除选中的 group 容器）。
      if (!isEditing && (e.metaKey || e.ctrlKey) && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        const store = useCanvasStore.getState();
        if (e.shiftKey) {
          const groups = store.nodes.filter((n) => n.selected && n.data.nodeType === "group");
          groups.forEach((g) => { store.ungroup(g.id); deleteNodeMutation.mutate({ id: g.id, projectId }); emitCollabEvent("node:delete", { id: g.id }); });
          if (groups.length > 0) toast.success(`已解组 ${groups.length} 个群组`, { duration: 1200 });
        } else {
          const ids = store.nodes.filter((n) => n.selected && n.data.nodeType !== "group").map((n) => n.id);
          if (ids.length >= 2) { const gid = store.groupSelected(ids); if (gid) toast.success(`已组合 ${ids.length} 个节点为群组`, { duration: 1200 }); }
          else toast.info("请先框选至少 2 个节点再组合", { duration: 1500 });
        }
      }

      // Shift+R: ≥2 box-selected → run ONLY those; 1 selected → run from it
      // (its up/downstream chain); none → run everything.
      if (!isEditing && e.shiftKey && e.key === "R") {
        e.preventDefault();
        if (runStateRunningRef.current) return;
        const selIds = nodes.filter((n) => n.selected && RUNNABLE_TYPES.includes(n.data.nodeType as NodeType)).map((n) => n.id);
        if (selIds.length >= 2) handleRunRequest(null, selIds);
        else handleRunRequest(nodes.find((n) => n.selected)?.id ?? null);
      }

      // Undo: Cmd+Z / Ctrl+Z
      if (!isEditing && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        undo();
        toast.info("已撤销", { duration: 1200 });
      }
      // Redo: Cmd+Shift+Z or Ctrl+Y
      if (!isEditing && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z") {
        e.preventDefault();
        redo();
        toast.info("已重做", { duration: 1200 });
      }
      if (!isEditing && e.ctrlKey && !e.shiftKey && e.key === "y") {
        e.preventDefault();
        redo();
        toast.info("已重做", { duration: 1200 });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveCanvas, undo, redo, runWorkflow, nodes, handleRunRequest, reactFlow]);

  const collaboratorList = Array.from(collaborators.values());

  // ── Error / not found ────────────────────────────────────────────────────────
  if (projectError) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center gap-4" style={{ background: "var(--c-canvas)" }}>
        <p className="text-sm" style={{ color: "var(--c-t3)" }}>项目不存在或无权访问</p>
        <button onClick={() => navigate("/")} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "var(--c-elevated)", color: "var(--c-t2)" }}>
          返回主页
        </button>
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
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--c-t4)" }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      </div>
    );
  }

  return (
   <NodeDefaultModelsProvider config={defaultModelsConfig} systemDefaults={systemDefaultModels} onChange={handleDefaultModelsChange} readOnly={isReadOnly}>
    <div className="w-screen h-screen flex flex-col overflow-hidden" style={{ background: "var(--c-canvas)" }}>

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

        {/* 全局运行状态条（生成中/排队/完成/失败，点失败跳转）——仅运行中或有失败时显示 */}
        <RunStatusBar runState={runState} />

        {/* Poyo 暂存/存储可达状态灯（顶部工具栏左侧；可达且未暂存时不显示） */}
        <PoyoStorageStatusChip className="flex-shrink-0" />

        <PoyoBalanceDashboard />
        <KieBalanceDashboard compact={topbarNarrow} />
        <CustomLlmKeyDashboard compact={topbarNarrow} />

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
                style={chatOpen ? { background: "oklch(0.68 0.22 285 / 0.12)", border: "1px solid oklch(0.68 0.22 285 / 0.3)", color: "oklch(0.68 0.22 285)" } : undefined}
              >
                <MessageSquare className="w-3.5 h-3.5" />
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
                className="topbar-btn"
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
                className="topbar-btn"
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
                className="topbar-btn"
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
                className="topbar-btn"
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
                className="topbar-btn"
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
                onClick={() => { undo(); toast.info("已撤销", { duration: 1200 }); }}
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
                onClick={() => { redo(); toast.info("已重做", { duration: 1200 }); }}
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
                  className="flex items-center gap-1 h-7 px-2 rounded-lg text-[11px] transition-all"
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
              <DropdownMenuItem onClick={() => startGuide(0)}><Compass className="w-3.5 h-3.5 mr-2" /> 新手导览</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { resetCanvasTips(); toast.success("已重新开启操作小贴士"); }}><Lightbulb className="w-3.5 h-3.5 mr-2" /> 重新开启小贴士</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowNotifySettings(true)}><Bell className="w-3.5 h-3.5 mr-2" /> 产物推送设置</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowPresentation(true)}><Play className="w-3.5 h-3.5 mr-2" /> 演示模式</DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel>库</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setShowPromptLib((v) => !v)}><BookText className="w-3.5 h-3.5 mr-2" /> 提示词库</DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel>视图 / 面板</DropdownMenuLabel>
              {!isPopout && <DropdownMenuItem onClick={() => setShowStatsSidebar((v) => !v)}><BarChart2 className="w-3.5 h-3.5 mr-2" /> 画布统计</DropdownMenuItem>}
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
            onSelectionEnd={() => setBoxSelecting(false)}
            panOnDrag={isMobile ? true : [1, 2]}
            panOnScroll
            panOnScrollMode={PanOnScrollMode.Free}
            zoomOnScroll={false}
            zoomOnPinch
            zoomOnDoubleClick={false}
            zoomActivationKeyCode="Control"
            fitView={false}
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
          {/* Studio global creation bar (nothing selected → quick prompt → 生成) */}
          <StudioCreateBar />
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
            className={`canvas-bottombar absolute z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-2xl ${toolbarOrient === "v" ? "flex-col" : ""}`}
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
              background: "color-mix(in oklch, var(--c-base) 38%, transparent)",
              backdropFilter: "blur(24px)",
              border: "1px solid var(--c-bd2)",
              boxShadow: "var(--c-node-shadow-hover), 0 0 0 1px var(--c-bd2)",
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

            {/* Grid storyboard starter (hidden for viewers) */}
            {!isReadOnly && <Tooltip>
              <TooltipTrigger asChild>
                <button
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

            {/* Zoom controls */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => reactFlow.zoomOut({ duration: 200 })}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                  style={{ color: "var(--c-t3)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
                >
                  <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 300 }}>−</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">缩小</TooltipContent>
            </Tooltip>

            <button
              onClick={() => reactFlow.zoomTo(1, { duration: 300 })}
              className="h-7 px-2 rounded-lg text-[11px] font-mono transition-all tabular-nums"
              style={{ color: "var(--c-t3)", minWidth: 44, textAlign: "center" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
              title="点击重置为 100%"
            >
              {Math.round(viewport.zoom * 100)}%
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => reactFlow.zoomIn({ duration: 200 })}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                  style={{ color: "var(--c-t3)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
                >
                  <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 300 }}>+</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">放大</TooltipContent>
            </Tooltip>

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
              <TooltipContent side="top" className="text-xs">适应视图</TooltipContent>
            </Tooltip>

            {/* 一键整理：按连线方向分层排布自由节点 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-tb-sec
                  onClick={() => { const n = useCanvasStore.getState().autoLayout(); if (n > 0) { toast.success(`已整理 ${n} 个节点`, { duration: 1200 }); setTimeout(() => reactFlow.fitView({ padding: 0.15, duration: 400 }), 60); } else toast.info("没有可整理的自由节点（群组内节点不参与）"); }}
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

              {/* Shortcuts panel */}
              {showShortcuts && (
                <div
                  className="absolute bottom-12 right-0 rounded-2xl p-4 z-40 animate-scale-in"
                  style={{
                    width: 280,
                    background: "color-mix(in oklch, var(--c-base) 97%, transparent)",
                    backdropFilter: "blur(24px)",
                    border: "1px solid var(--c-bd2)",
                    boxShadow: "0 16px 48px oklch(0 0 0 / 0.70), 0 4px 12px oklch(0 0 0 / 0.40)",
                  }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--c-t4)" }}>快捷键速查</p>
                  {[
                    { group: "画布操作", items: [
                      { key: "Ctrl + 滚轮", desc: "缩放画布" },
                      { key: "滚轮", desc: "上下平移" },
                      { key: "Shift + 滚轮", desc: "左右平移" },
                      { key: "拖拽空白处", desc: "平移画布" },
                    ]},
                    { group: "节点操作", items: [
                      { key: "Delete / Backspace", desc: "删除选中节点" },
                      { key: "Cmd/Ctrl + D", desc: "原地复制选中节点" },
                      { key: "Cmd/Ctrl + C / V", desc: "复制/粘贴子图（含内部连线）" },
                      { key: "Cmd/Ctrl + G", desc: "组合为群组（Shift 解组）" },
                      { key: "Cmd/Ctrl + A", desc: "全选节点" },
                      { key: "Esc", desc: "取消选中" },
                    ]},
                    { group: "撤销/重做", items: [
                      { key: "Cmd/Ctrl + Z", desc: "撤销" },
                      { key: "Cmd/Ctrl + Shift + Z", desc: "重做" },
                      { key: "Ctrl + Y", desc: "重做（Windows）" },
                    ]},
                    { group: "工作流", items: [
                      { key: "Shift + R", desc: "运行工作流（框选多个=仅运行选中；选 1 个=从该节点运行）" },
                    ]},
                    { group: "其他", items: [
                      { key: "Cmd/Ctrl + K", desc: "搜索节点" },
                      { key: "Cmd/Ctrl + S", desc: "保存画布" },
                      { key: "Alt + W", desc: "速览：临时展开全部节点的参考图 + 提示词窗（再按或 5 秒后恢复）" },
                      { key: "?", desc: "开关快捷键面板" },
                    ]},
                  ].map(({ group, items }) => (
                    <div key={group} className="mb-3 last:mb-0">
                      <p className="text-[9px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "var(--c-t4)" }}>{group}</p>
                      <div className="flex flex-col gap-1">
                        {items.map(({ key, desc }) => (
                          <div key={key} className="flex items-center justify-between">
                            <span style={{ fontSize: 11, color: "var(--c-t2)" }}>{desc}</span>
                            <span
                              className="font-mono text-[10px] px-1.5 py-0.5 rounded-md"
                              style={{
                                background: "var(--c-elevated)",
                                border: "1px solid var(--c-bd3)",
                                color: "oklch(0.72 0.12 285)",
                              }}
                            >{key}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Connection hints toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-tb-sec
                  data-tour="conn-hints"
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
                  <span style={{ fontSize: 14 }}>🔗</span>
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

            {/* Theme switcher (foldable) */}
            <span data-tb-sec data-tour="theme" style={{ display: "inline-flex", alignItems: "center" }}><ThemeSwitcher /></span>

            {/* Canvas background picker (foldable) */}
            <span data-tb-sec style={{ display: "inline-flex", alignItems: "center" }}><CanvasBgPicker value={canvasBg} onChange={setCanvasBg} /></span>
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

        {/* ── Asset panel (floating, draggable, resizable) ── */}
        {showCharLib && <CharacterLibraryPanel onClose={() => setShowCharLib(false)} />}
        {showPromptLib && <PromptLibraryPanel onClose={() => setShowPromptLib(false)} />}
        {showAssets && (
          <FloatingAssetPanel projectId={projectId} onClose={() => setShowAssets(false)} />
        )}

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
            onDuplicateNode={contextMenu.nodeId ? () => duplicateNode(contextMenu.nodeId!) : undefined}
            onGroup={selectedGroupableIds.length >= 2 ? () => {
              const gid = useCanvasStore.getState().groupSelected(selectedGroupableIds);
              if (gid) toast.success(`已组合 ${selectedGroupableIds.length} 个节点为群组`);
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
              const gid = useCanvasStore.getState().duplicateGroup(contextMenu.nodeId!);
              if (gid) {
                const cnt = (((useCanvasStore.getState().nodes.find((n) => n.id === gid)?.data.payload) as GroupNodeData | undefined)?.childIds ?? []).length;
                toast.success(`已复制群组及 ${cnt} 个成员`);
              }
            } : undefined}
            onRunWorkflow={contextMenu.nodeId && ctxNodeType !== "group" ? () => handleRunRequest(contextMenu.nodeId ?? null) : undefined}
            // Pin: toggle payload.pinned so the node's input area stays expanded
            // even when the user clicks elsewhere on the canvas.
            onTogglePin={contextMenu.nodeId ? () => {
              updateNodeData(contextMenu.nodeId!, { pinned: !ctxPinned });
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
            {connectMenu.types.map((t) => {
              const cfg = getNodeConfig(t);
              // ComfyUI 自定义节点 → 改为「节点模板库」：点击打开模板库二级列表，选模板后在落点
              // 建节点并连边（替代直接建空白工作流节点）。
              const isTplLib = t === "comfyui_workflow";
              const Icon = isTplLib ? LayoutGrid : (cfg ? (NODE_ICONS[cfg.icon] ?? FileText) : FileText);
              const color = cfg?.color ?? "var(--c-t3)";
              if (isTplLib) {
                return (
                  <div key={t} className="nodrag flex items-center gap-1 w-full"
                    onDragOver={(e) => { if (connectDragType) e.preventDefault(); }}
                    onDrop={(e) => { e.preventDefault(); if (connectDragType) reorderConnectType(connectDragType, t); setConnectDragType(null); }}
                    style={{ borderRadius: 7 }}>
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
                  onDragOver={(e) => { if (connectDragType) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); if (connectDragType) reorderConnectType(connectDragType, t); setConnectDragType(null); }}
                  style={{ borderRadius: 7, background: connectDragType === t && connectDragType !== null ? `${color}14` : "transparent" }}
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
