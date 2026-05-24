import { useState, useEffect, useRef, useCallback } from "react";
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
import { useCanvasStore, type CanvasNode, type CanvasEdge } from "../hooks/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowRunner, RUNNABLE_TYPES } from "../hooks/useWorkflowRunner";
import { WorkflowRunProvider } from "../contexts/WorkflowRunContext";
import { CustomNode } from "../components/canvas/CustomNode";
import { CustomEdge } from "../components/canvas/CustomEdge";
import { ContextMenu } from "../components/canvas/ContextMenu";
import { CollaboratorCursors } from "../components/canvas/CollaboratorCursors";
import { AssetPanel } from "../components/canvas/AssetPanel";
import { TemplatePanel } from "../components/canvas/TemplatePanel";
import { NodeSearch } from "../components/canvas/NodeSearch";
import { PresentationMode } from "../components/canvas/PresentationMode";
import { FilmstripPanel } from "../components/canvas/FilmstripPanel";
import { TimelinePanel } from "../components/canvas/TimelinePanel";
import { isConnectionValid } from "../lib/connectionRules";
import { BeginnerGuide, ConnectionHintsPanel } from "../components/canvas/BeginnerGuide";
import { ThemeSwitcher } from "../components/canvas/ThemeSwitcher";
import { CanvasBgPicker, loadCanvasBg, type CanvasBg } from "../components/canvas/CanvasBgPicker";
import { useCanvasMode } from "../contexts/CanvasModeContext";
import { useTheme } from "../contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useIsMobile } from "@/hooks/useMobile";
import { toast } from "sonner";
import type { NodeType, CollaboratorCursor } from "../../../shared/types";
import { getNodeConfig, NODE_TYPE_LIST, NODE_ICONS, COLLABORATOR_COLORS } from "../lib/nodeConfig";
import { io, type Socket } from "socket.io-client";
import {
  Film,
  Save,
  Download,
  Users,
  ChevronLeft,
  Plus,
  Paperclip,
  Image,
  Loader2,
  Pencil,
  Check,
  X,
  FileText,
  LayoutGrid,
  BarChart2,
  Maximize2,
  Play,
  LogOut,
  Undo2,
  Redo2,
  Search,
  Lock,
  Unlock,
  ChevronDown,
  History,
  Trash2,
  RotateCcw,
  BookmarkPlus,
  Palette,
  ListVideo,
} from "lucide-react";
import { loadNamedSnapshots, type NamedSnapshot } from "../hooks/useCanvasStore";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const nodeTypes = { custom: CustomNode };
const edgeTypes = { custom: CustomEdge };

// ── Tool button ───────────────────────────────────────────────────────────────
function ToolBtn({
  icon: Icon,
  label,
  active,
  accent,
  onClick,
  kbd,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  accent?: string;
  onClick: () => void;
  kbd?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150"
          style={{
            background: active
              ? accent
                ? `${accent}22`
                : "oklch(0.68 0.22 285 / 0.15)"
              : "transparent",
            border: active
              ? `1px solid ${accent ?? "oklch(0.68 0.22 285 / 0.4)"}`
              : "1px solid transparent",
            color: active
              ? (accent ?? "oklch(0.68 0.22 285)")
              : "var(--c-t3)",
          }}
          onMouseEnter={(e) => {
            if (!active) {
              (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
              (e.currentTarget as HTMLElement).style.color = "var(--c-t1)";
            }
          }}
          onMouseLeave={(e) => {
            if (!active) {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--c-t3)";
            }
          }}
        >
          <Icon className="w-4 h-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        <span>{label}</span>
        {kbd && (
          <kbd className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-[var(--c-elevated)] font-mono">
            {kbd}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────
function ToolDivider() {
  return <div className="w-5 h-px mx-auto my-1" style={{ background: "var(--c-bd1)" }} />;
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

// ── Mobile tool button ────────────────────────────────────────────────────────
function MobileToolBtn({
  icon: Icon, label, onClick, active, accent, color,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string; onClick: () => void; active?: boolean; accent?: string; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: 36, height: 36, borderRadius: 10,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: active ? "oklch(0.68 0.22 285 / 0.15)" : "transparent",
        border: active ? "1px solid oklch(0.68 0.22 285 / 0.35)" : "1px solid transparent",
        color: active ? "oklch(0.68 0.22 285)" : (color ?? "var(--c-t3)"),
        transition: "all 120ms ease",
        flexShrink: 0,
      }}
    >
      <Icon className="w-4 h-4" style={color && !active ? { color } : undefined} />
    </button>
  );
}

function MobileToolDivider() {
  return <div style={{ width: 1, height: 20, background: "var(--c-bd2)", flexShrink: 0 }} />;
}

// ── Canvas inner ──────────────────────────────────────────────────────────────
function CanvasInner({ projectId }: { projectId: number }) {
  const { user, isAuthenticated, logout } = useAuth();
  const [, navigate] = useLocation();
  const reactFlow = useReactFlow();
  const isMobile = useIsMobile();

  const {
    nodes, edges, setNodes, setEdges,
    onNodesChange, onEdgesChange, onConnect,
    addNode, deleteNode, duplicateNode,
    setProjectId, isDirty, markClean, markDirty,
    setCollaborator, removeCollaborator, collaborators, resetCanvas,
    undo, redo, past, future,
    saveNamedSnapshot, restoreNamedSnapshot, deleteNamedSnapshot,
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
  })));

  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; type: "canvas" | "node"; nodeId?: string; canvasPos?: { x: number; y: number };
  } | null>(null);

  const [showAssets, setShowAssets] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showNodeSearch, setShowNodeSearch] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);
  const [showNodePicker, setShowNodePicker] = useState(false);
  const [showPresentation, setShowPresentation] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showStatsSidebar, setShowStatsSidebar] = useState(false);
  const [showFilmstrip, setShowFilmstrip] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [canvasBg, setCanvasBg] = useState<CanvasBg>(() => loadCanvasBg());
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [globalAspectRatio, setGlobalAspectRatio] = useState<string | null>(null);
  const [showRatioPicker, setShowRatioPicker] = useState(false);
  const [showConnectionHints, setShowConnectionHints] = useState(false);
  const { mode: canvasMode, setMode: setCanvasMode } = useCanvasMode();
  const { theme } = useTheme();
  const isLight = theme === "light" || theme === "warm" || canvasMode === "creative";
  // Auto-show filmstrip when entering creative mode, hide when leaving
  useEffect(() => {
    if (canvasMode === "creative") setShowFilmstrip(true);
    else setShowFilmstrip(false);
  }, [canvasMode]);
  const [connectingFromType, setConnectingFromType] = useState<NodeType | null>(null);

  // Workflow runner
  const { runState, runWorkflow } = useWorkflowRunner();
  const [showRunConfirm, setShowRunConfirm] = useState(false);
  const [pendingRunNodeId, setPendingRunNodeId] = useState<string | null>(null);
  const [runConfirmCountdown, setRunConfirmCountdown] = useState(5);
  const runConfirmOpenRef = useRef(false);
  const runStateRunningRef = useRef(false);
  runStateRunningRef.current = runState.running;

  const handleRunRequest = useCallback((startNodeId: string | null) => {
    if (runConfirmOpenRef.current) return;
    runConfirmOpenRef.current = true;
    setPendingRunNodeId(startNodeId);
    setRunConfirmCountdown(5);
    setShowRunConfirm(true);
  }, []);

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
  const [barEdge, setBarEdge] = useState<"bottom" | "top" | "left" | "right">("bottom");
  const [barAlong, setBarAlong] = useState(0); // px offset along the anchor edge (centered = 0)
  const [mmPos, setMmPos] = useState({ bottom: 80, right: 8 });
  const [mmSize, setMmSize] = useState({ w: 200, h: 140 });
  const mmDragRef = useRef<{ sx: number; sy: number; sb: number; sr: number } | null>(null);
  const mmResizeRef = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null);
  const [renamingProject, setRenamingProject] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data loading ────────────────────────────────────────────────────────────
  const { data: project, isLoading: projectLoading, isError: projectError } = trpc.projects.get.useQuery(
    { id: projectId }, { enabled: !!projectId && isAuthenticated, retry: false }
  );
  const { data: dbNodes } = trpc.nodes.list.useQuery(
    { projectId }, { enabled: !!projectId && isAuthenticated }
  );
  const { data: dbEdges } = trpc.edges.list.useQuery(
    { projectId }, { enabled: !!projectId && isAuthenticated }
  );

  const utils = trpc.useUtils();
  const batchUpsertNodes = trpc.nodes.batchUpsert.useMutation();
  const upsertEdge = trpc.edges.upsert.useMutation();
  const deleteNodeMutation = trpc.nodes.delete.useMutation();
  const deleteEdgeMutation = trpc.edges.delete.useMutation();
  const updateProject = trpc.projects.update.useMutation({
    onSuccess: () => {
      utils.projects.get.invalidate({ id: projectId });
      utils.projects.list.invalidate();
    },
  });

  // Reset canvas store on unmount to prevent stale nodes polluting next canvas
  useEffect(() => {
    setProjectId(projectId);
    return () => { resetCanvas(); };
  }, [projectId, setProjectId, resetCanvas]);

  useEffect(() => {
    if (!dbNodes) return;
    const flowNodes: CanvasNode[] = dbNodes.map((n) => ({
      id: n.id, type: "custom",
      position: { x: n.posX, y: n.posY },
      data: { nodeType: n.type as NodeType, title: n.title ?? getNodeConfig(n.type as NodeType).defaultTitle, payload: (n.data as Record<string, unknown>) ?? {}, projectId },
      style: { width: n.width, height: n.height },
      zIndex: n.zIndex,
    }));
    setNodes(flowNodes);
  }, [dbNodes]);

  useEffect(() => {
    if (!dbEdges || !dbNodes) return;
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
    const flowEdges: CanvasEdge[] = dbEdges.map((e) => {
      let targetHandle = e.targetPort ?? "input";
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
    setEdges(flowEdges);
  }, [dbEdges, dbNodes]);

  useEffect(() => {
    if (project?.viewportState) {
      const vp = project.viewportState as { x: number; y: number; zoom: number };
      const tid = setTimeout(() => reactFlow.setViewport(vp), 100);
      return () => clearTimeout(tid);
    }
  }, [project, reactFlow]);

  // ── Auto-save ───────────────────────────────────────────────────────────────
  const saveCanvas = useCallback(async () => {
    if (!isDirty) return;
    try {
      if (nodes.length > 0) {
        await batchUpsertNodes.mutateAsync(nodes.map((n) => ({
          id: n.id, projectId,
          type: n.data.nodeType,
          title: n.data.title,
          data: n.data.payload as Record<string, unknown>,
          posX: n.position.x, posY: n.position.y,
          width: (n.style?.width as number) ?? 320, height: (n.style?.height as number) ?? 200, zIndex: n.zIndex ?? 0,
        })));
      }
      for (const edge of edges) {
        await upsertEdge.mutateAsync({
          id: edge.id, projectId, sourceNodeId: edge.source, targetNodeId: edge.target,
          sourcePort: edge.sourceHandle ?? "output", targetPort: edge.targetHandle ?? "input",
          label: typeof edge.label === "string" ? edge.label : undefined,
        });
      }
      await updateProject.mutateAsync({ id: projectId, viewportState: reactFlow.getViewport() });
      markClean();
    } catch (err) {
      console.error("Auto-save failed:", err);
    }
  }, [isDirty, nodes, edges, projectId, batchUpsertNodes, upsertEdge, updateProject, markClean, reactFlow]);

  useEffect(() => {
    if (!isDirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(saveCanvas, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [isDirty, saveCanvas]);

  // ── Socket ──────────────────────────────────────────────────────────────────
  const emitCollabEvent = useCallback((type: string, payload: unknown) => {
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
    const socket = io("/", { path: "/api/socket", transports: ["websocket", "polling"] });
    socket.on("connect", () => {
      setSocketConnected(true);
      socket.emit("join-project", { projectId, userId: user.id, userName: user.name ?? "匿名", color: COLLABORATOR_COLORS[user.id % COLLABORATOR_COLORS.length] });
    });
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("collaboration-event", (event: { type: string; userId: number; userName: string; color: string; payload: unknown }) => {
      if (event.userId === user.id) return;
      if (event.type === "cursor:move") {
        const p = event.payload as { x: number; y: number };
        setCollaborator({ userId: event.userId, userName: event.userName, color: event.color, x: p.x, y: p.y });
      } else if (event.type === "node:move") {
        const p = event.payload as { id: string; x: number; y: number };
        const { nodes: currentNodes, setNodes: storeSetNodes } = useCanvasStore.getState();
        storeSetNodes(currentNodes.map((n) => n.id === p.id ? { ...n, position: { x: p.x, y: p.y } } : n));
      } else if (event.type === "node:add") {
        const newNode = event.payload as CanvasNode;
        const { nodes: currentNodes, setNodes: storeSetNodes, markDirty } = useCanvasStore.getState();
        storeSetNodes([...currentNodes.filter((n) => n.id !== newNode.id), newNode]);
        markDirty();
      } else if (event.type === "node:delete") {
        const p = event.payload as { id: string };
        const { nodes: currentNodes, setNodes: storeSetNodes, setEdges: storeSetEdges, edges: currentEdges, markDirty } = useCanvasStore.getState();
        storeSetNodes(currentNodes.filter((n) => n.id !== p.id));
        storeSetEdges(currentEdges.filter((e) => e.source !== p.id && e.target !== p.id));
        markDirty();
      } else if (event.type === "node:update") {
        const p = event.payload as { id: string; patch: Record<string, unknown> };
        const { nodes: currentNodes, setNodes: storeSetNodes, markDirty } = useCanvasStore.getState();
        storeSetNodes(currentNodes.map((n) =>
          n.id === p.id ? { ...n, data: { ...n.data, payload: { ...n.data.payload, ...p.patch } } } : n
        ) as CanvasNode[]);
        markDirty();
      } else if (event.type === "edge:add") {
        const newEdge = event.payload as CanvasEdge;
        const { edges: currentEdges, setEdges: storeSetEdges, markDirty } = useCanvasStore.getState();
        if (!currentEdges.find((e) => e.id === newEdge.id)) {
          storeSetEdges([...currentEdges, newEdge]);
          markDirty();
        }
      } else if (event.type === "edge:delete") {
        const p = event.payload as { id: string };
        const { edges: currentEdges, setEdges: storeSetEdges, markDirty } = useCanvasStore.getState();
        storeSetEdges(currentEdges.filter((e) => e.id !== p.id));
        markDirty();
      } else if (event.type === "user:leave") {
        removeCollaborator(event.userId);
      }
    });
    socketRef.current = socket;
    return () => { socket.emit("leave-project", { projectId, userId: user.id }); socket.disconnect(); };
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
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({
      x: e.clientX, y: e.clientY, type: "canvas",
      canvasPos: { x: (e.clientX - rect.left - viewport.x) / viewport.zoom, y: (e.clientY - rect.top - viewport.y) / viewport.zoom },
    });
  }, [viewport]);

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: CanvasNode) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, type: "node", nodeId: node.id });
  }, []);

  const handleAddNode = useCallback((type: NodeType) => {
    const pos = contextMenu?.canvasPos ?? { x: 200, y: 200 };
    try {
      const newNode = addNode(type, pos);
      emitCollabEvent("node:add", newNode);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加节点失败");
    }
    setShowNodePicker(false);
  }, [contextMenu, addNode, emitCollabEvent]);

  const addNodeAtCenter = useCallback((type: NodeType) => {
    const vp = reactFlow.getViewport();
    const cx = (window.innerWidth / 2 - vp.x) / vp.zoom;
    const cy = (window.innerHeight / 2 - vp.y) / vp.zoom;
    try {
      const newNode = addNode(type, { x: cx + Math.random() * 80 - 40, y: cy + Math.random() * 80 - 40 });
      emitCollabEvent("node:add", newNode);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加节点失败");
    }
    setShowNodePicker(false);
  }, [addNode, reactFlow, emitCollabEvent]);

  // ── Global aspect ratio lock ────────────────────────────────────────────────
  const RATIO_PRESETS = ["16:9", "9:16", "1:1", "4:3", "3:4", "2.35:1"];
  const batchUpdateNodeData = useCanvasStore((s) => s.batchUpdateNodeData);
  const applyGlobalRatio = useCallback((ratio: string | null) => {
    setGlobalAspectRatio(ratio);
    setShowRatioPicker(false);
    if (!ratio) { toast.info("已解除纵横比锁定"); return; }
    const targets = useCanvasStore.getState().nodes.filter(n =>
      ["storyboard", "prompt", "image_gen"].includes(n.data.nodeType)
    );
    if (targets.length > 0) {
      batchUpdateNodeData(targets.map(n => ({ id: n.id, payload: { aspectRatio: ratio } })));
      toast.success(`已将 ${targets.length} 个节点纵横比锁定为 ${ratio}`);
    } else {
      toast.info(`纵横比锁定为 ${ratio}，新建节点将自动继承`);
    }
  }, [batchUpdateNodeData]);

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
      if (node) setConnectingFromType(node.data.nodeType);
    }
  }, [nodes]);

  const handleConnectEnd = useCallback(() => {
    setConnectingFromType(null);
  }, []);

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
          const a = document.createElement("a");
          const filename = `${node.data.title.replace(/[^a-zA-Z0-9一-龥]/g, "_")}-${i + 1}.png`;
          if (url.startsWith("/") || url.startsWith(window.location.origin)) {
            a.href = url;
          } else {
            a.href = `/api/image-proxy?url=${encodeURIComponent(url)}&download=1`;
          }
          a.download = filename;
          a.click();
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
      if (e.key === "Escape") { setContextMenu(null); setShowNodePicker(false); setShowNodeSearch(false); setShowTemplates(false); runConfirmOpenRef.current = false; setShowRunConfirm(false); setRunConfirmCountdown(5); }

      // Cmd+K / Ctrl+K — Node search (skip when typing in an input)
      if (!isEditing && (e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
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
        const selected = useCanvasStore.getState().nodes.filter(n => n.selected);
        selected.forEach(n => duplicateNode(n.id));
        if (selected.length > 0) toast.success(`已复制 ${selected.length} 个节点`, { duration: 1200 });
      }

      // Shift+R: run workflow from selected node
      if (!isEditing && e.shiftKey && e.key === "R") {
        e.preventDefault();
        if (runStateRunningRef.current) return;
        const selected = nodes.find((n) => n.selected);
        handleRunRequest(selected?.id ?? null);
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
  }, [saveCanvas, undo, redo, runWorkflow, nodes, handleRunRequest]);

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
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))" }}
        >
          <Film className="w-5 h-5 text-white" />
        </div>
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--c-t4)" }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden" style={{ background: "var(--c-canvas)" }}>

      {/* ══ Top Bar ══════════════════════════════════════════════════════════ */}
      <header
        className="canvas-topbar h-11 flex items-center px-3 gap-2 flex-shrink-0 z-20"
        style={{
          background: "color-mix(in oklch, var(--c-base) 95%, transparent)",
          backdropFilter: "blur(20px)",
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

        {/* Logo + Project name */}
        <div className="flex items-center gap-2 mr-2">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))" }}
          >
            <Film className="w-3.5 h-3.5 text-white" />
          </div>

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
              <span className="text-sm font-medium truncate max-w-[160px]" style={{ color: "var(--c-t1)" }}>
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

          {/* Presentation mode */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowPresentation(true)}
                className="topbar-btn"
              >
                <Play className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">演示模式</TooltipContent>
          </Tooltip>

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
              快速模板 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-[var(--c-elevated)] font-mono">⌘T</kbd>
            </TooltipContent>
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
              搜索节点 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-[var(--c-elevated)] font-mono">⌘K</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Assets */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowAssets(!showAssets)}
                className="topbar-btn"
                data-active={showAssets ? "true" : undefined}
                style={showAssets ? { background: "oklch(0.68 0.22 285 / 0.12)", border: "1px solid oklch(0.68 0.22 285 / 0.3)", color: "oklch(0.68 0.22 285)" } : undefined}
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">素材库</TooltipContent>
          </Tooltip>

          {/* Stats sidebar toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowStatsSidebar((v) => !v)}
                className="topbar-btn"
                data-active={showStatsSidebar ? "true" : undefined}
                style={showStatsSidebar ? { background: "oklch(0.68 0.22 285 / 0.12)", border: "1px solid oklch(0.68 0.22 285 / 0.3)", color: "oklch(0.68 0.22 285)" } : undefined}
              >
                <BarChart2 className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">画布统计</TooltipContent>
          </Tooltip>

          {/* Filmstrip toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowFilmstrip((v) => !v)}
                className="topbar-btn"
                data-active={showFilmstrip ? "true" : undefined}
                style={showFilmstrip ? { background: "oklch(0.68 0.22 285 / 0.12)", border: "1px solid oklch(0.68 0.22 285 / 0.3)", color: "oklch(0.68 0.22 285)" } : undefined}
              >
                <Film className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">胶片条</TooltipContent>
          </Tooltip>

          {/* Timeline toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowTimeline((v) => !v)}
                className="topbar-btn"
                data-active={showTimeline ? "true" : undefined}
                style={showTimeline ? { background: "oklch(0.62 0.20 25 / 0.12)", border: "1px solid oklch(0.62 0.20 25 / 0.3)", color: "oklch(0.65 0.18 30)" } : undefined}
              >
                <ListVideo className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">时间轴预览</TooltipContent>
          </Tooltip>

          {/* ── Version history ── */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowSnapshots((v) => !v)}
                className="topbar-btn"
                data-active={showSnapshots ? "true" : undefined}
                style={showSnapshots ? { background: "oklch(0.68 0.22 45 / 0.12)", border: "1px solid oklch(0.68 0.22 45 / 0.3)", color: "oklch(0.72 0.18 45)" } : undefined}
              >
                <History className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">版本历史</TooltipContent>
          </Tooltip>

          {/* ── Separator: View panels | Edit actions ── */}
          <div className="w-px h-4 mx-1" style={{ background: "var(--c-bd2)" }} />

          {/* Undo */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { undo(); toast.info("已撤销", { duration: 1200 }); }}
                disabled={past.length === 0}
                className="topbar-btn"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              撤销 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-[var(--c-elevated)] font-mono">⌘Z</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Redo */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { redo(); toast.info("已重做", { duration: 1200 }); }}
                disabled={future.length === 0}
                className="topbar-btn"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              重做 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-[var(--c-elevated)] font-mono">⌘⇧Z</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Save */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { saveCanvas(); toast.success("已保存"); }}
                className="topbar-btn"
              >
                <Save className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              保存 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-[var(--c-elevated)] font-mono">⌘S</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Export Images */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleExportImages}
                className="topbar-btn"
              >
                <Image className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">导出所有图像</TooltipContent>
          </Tooltip>

          {/* Export JSON */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleExport}
                className="topbar-btn"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">导出 JSON</TooltipContent>
          </Tooltip>
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
          {/* Logout */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={async () => {
                  await logout();
                  navigate("/");
                }}
                className="topbar-btn topbar-btn--danger"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">退出登录</TooltipContent>
          </Tooltip>
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
              width: 520,
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
              <p className="text-[10px]" style={{ color: "var(--c-t4)" }}>点击添加到画布中心</p>
            </div>
            <div className="p-2.5 grid grid-cols-4 gap-1.5">
              {NODE_TYPE_LIST.map((config) => {
                const Icon = NODE_ICONS[config.icon] ?? FileText;
                return (
                  <button
                    key={config.type}
                    onClick={() => addNodeAtCenter(config.type)}
                    className="group/picker flex flex-col items-center gap-2.5 px-2 py-3 rounded-xl transition-all text-center"
                    style={{ color: "var(--c-t2)" }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = "var(--c-elevated)";
                      el.style.color = "var(--c-t1)";
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = "transparent";
                      el.style.color = "var(--c-t2)";
                    }}
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
                      style={{
                        background: `${config.color}14`,
                        border: `1px solid ${config.color}30`,
                        boxShadow: `0 2px 8px ${config.color}10`,
                      }}
                    >
                      <Icon style={{ color: config.color, width: 18, height: 18 }} />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-[11px] font-semibold leading-none" style={{ letterSpacing: "-0.01em" }}>
                        {config.label}
                      </p>
                      <p className="text-[9px] leading-none" style={{ color: "var(--c-t4)" }}>
                        {config.defaultTitle}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Canvas ── */}
        <div
          className="flex-1 relative canvas-vignette"
          style={{ background: canvasBg.bgColor }}
          onContextMenu={handleCanvasContextMenu}
          onMouseMove={handleMouseMove}
          onClick={() => { setShowNodePicker(false); }}
        >
          <WorkflowRunProvider value={runState}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            style={{ background: canvasBg.bgColor }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={(connection) => {
              const prevIds = new Set(useCanvasStore.getState().edges.map((e) => e.id));
              onConnect(connection);
              const newEdge = useCanvasStore.getState().edges.find((e) => !prevIds.has(e.id));
              if (newEdge) emitCollabEvent("edge:add", newEdge);
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
            onMoveEnd={(_, vp) => { setViewport(vp); markDirty(); }}
            selectionMode={SelectionMode.Partial}
            selectionOnDrag
            panOnDrag={[1, 2]}
            panOnScroll
            panOnScrollMode={PanOnScrollMode.Free}
            zoomOnScroll={false}
            zoomOnPinch
            zoomActivationKeyCode="Control"
            fitView={!project?.viewportState}
            fitViewOptions={{ padding: 0.2 }}
            deleteKeyCode="Delete"
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
                color={canvasBg.patternColor}
              />
            )}
            <MiniMap
              position="bottom-right"
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
              }}
            />
            {/* Minimap drag handle + resize grip — transparent overlay */}
            <div
              style={{
                position: "absolute",
                bottom: mmPos.bottom,
                right: mmPos.right,
                width: mmSize.w,
                height: mmSize.h,
                zIndex: 6,
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

          <ConnectionHintsPanel
            visible={showConnectionHints}
            selectedNodeType={connectingFromType}
            onClose={() => setShowConnectionHints(false)}
          />
          <BeginnerGuide />

          {/* ── Floating toolbar — snaps to viewport edge; vertical when on left/right ── */}
          <div
            className={`canvas-bottombar absolute z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-2xl ${barEdge === "left" || barEdge === "right" ? "flex-col" : ""}`}
            data-bar-edge={barEdge}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
              // 只响应直接在工具栏背景上的拖拽（不拦截按钮点击）
              if ((e.target as HTMLElement).closest("button,input,select")) return;
              e.preventDefault();
              const startX = e.clientX, startY = e.clientY;
              let dragged = false;
              const onMove = (mv: MouseEvent) => {
                // require 5px movement before snapping (avoid accidental snap on click)
                if (!dragged && Math.hypot(mv.clientX - startX, mv.clientY - startY) < 5) return;
                dragged = true;
                const cx = mv.clientX, cy = mv.clientY;
                const W = window.innerWidth, H = window.innerHeight;
                // Distance to each edge
                const dT = cy, dB = H - cy, dL = cx, dR = W - cx;
                const minD = Math.min(dT, dB, dL, dR);
                if (minD === dB) {
                  setBarEdge("bottom");
                  setBarAlong(Math.max(-400, Math.min(400, cx - W / 2)));
                } else if (minD === dT) {
                  setBarEdge("top");
                  setBarAlong(Math.max(-400, Math.min(400, cx - W / 2)));
                } else if (minD === dL) {
                  setBarEdge("left");
                  setBarAlong(Math.max(-300, Math.min(300, cy - H / 2)));
                } else {
                  setBarEdge("right");
                  setBarAlong(Math.max(-300, Math.min(300, cy - H / 2)));
                }
              };
              const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
            style={{
              ...(barEdge === "bottom" && { bottom: 20, left: `calc(50% + ${barAlong}px)`, transform: "translateX(-50%)" }),
              ...(barEdge === "top" && { top: 20, left: `calc(50% + ${barAlong}px)`, transform: "translateX(-50%)" }),
              ...(barEdge === "left" && { left: 20, top: `calc(50% + ${barAlong}px)`, transform: "translateY(-50%)" }),
              ...(barEdge === "right" && { right: 20, top: `calc(50% + ${barAlong}px)`, transform: "translateY(-50%)" }),
              cursor: "default",
              background: "color-mix(in oklch, var(--c-base) 95%, transparent)",
              backdropFilter: "blur(24px)",
              border: "1px solid var(--c-bd2)",
              boxShadow: "var(--c-node-shadow-hover), 0 0 0 1px var(--c-bd2)",
            }}
          >
            {/* Add node — primary action */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
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
                  添加
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">添加节点</TooltipContent>
            </Tooltip>

            {/* Divider */}
            <div style={{ width: 1, height: 18, background: "var(--c-bd2)", flexShrink: 0 }} />

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

            {/* Divider */}
            <div style={{ width: 1, height: 18, background: "var(--c-bd2)", flexShrink: 0 }} />

            {/* Run workflow button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleRunRequest(null)}
                  disabled={runState.running || nodes.length === 0}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-semibold transition-all"
                  style={{
                    background: runState.running
                      ? "oklch(0.72 0.22 142 / 0.12)"
                      : "oklch(0.72 0.22 142 / 0.15)",
                    border: `1px solid oklch(0.72 0.22 142 / ${runState.running ? "0.5" : "0.35"})`,
                    color: runState.running ? "oklch(0.75 0.20 142)" : "oklch(0.72 0.22 142)",
                    cursor: runState.running || nodes.length === 0 ? "not-allowed" : "pointer",
                    opacity: nodes.length === 0 ? 0.5 : 1,
                  }}
                >
                  {runState.running ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      运行中 {runState.completedIds.length + runState.failedIds.length}/{runState.runnableCount || nodes.length}
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3" />
                      运行
                    </>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                运行工作流 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-[var(--c-elevated)] font-mono">Shift+R</kbd>
              </TooltipContent>
            </Tooltip>

            {/* Divider */}
            <div style={{ width: 1, height: 18, background: "var(--c-bd2)", flexShrink: 0 }} />

            {/* Shortcut help button */}
            <div className="relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
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
                      { key: "Cmd/Ctrl + D", desc: "复制节点" },
                      { key: "Cmd/Ctrl + A", desc: "全选节点" },
                      { key: "Esc", desc: "取消选中" },
                    ]},
                    { group: "撤销/重做", items: [
                      { key: "Cmd/Ctrl + Z", desc: "撤销" },
                      { key: "Cmd/Ctrl + Shift + Z", desc: "重做" },
                      { key: "Ctrl + Y", desc: "重做（Windows）" },
                    ]},
                    { group: "工作流", items: [
                      { key: "Shift + R", desc: "从选中节点运行工作流" },
                    ]},
                    { group: "其他", items: [
                      { key: "Cmd/Ctrl + K", desc: "搜索节点" },
                      { key: "Cmd/Ctrl + S", desc: "保存画布" },
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

            {/* Canvas mode toggle: Professional ↔ Creative */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCanvasMode(canvasMode === "creative" ? "professional" : "creative")}
                  className="h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-all"
                  style={{
                    background: canvasMode === "creative"
                      ? "oklch(0.68 0.22 285 / 0.12)"
                      : "transparent",
                    border: canvasMode === "creative"
                      ? "1px solid oklch(0.68 0.22 285 / 0.35)"
                      : "1px solid transparent",
                    color: canvasMode === "creative"
                      ? "oklch(0.68 0.22 285)"
                      : "var(--c-t3)",
                  }}
                  onMouseEnter={(e) => {
                    if (canvasMode !== "creative") {
                      (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
                      (e.currentTarget as HTMLElement).style.color = "var(--c-t1)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (canvasMode !== "creative") {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                      (e.currentTarget as HTMLElement).style.color = "var(--c-t3)";
                    }
                  }}
                >
                  <Palette className="w-3.5 h-3.5" />
                  <span>{canvasMode === "creative" ? "创意" : "专业"}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {canvasMode === "creative"
                  ? "当前：创意模式（LibTV 风格）· 点击切换专业模式"
                  : "切换到创意模式（白色画布 · 媒体优先）"}
              </TooltipContent>
            </Tooltip>

            {/* Theme switcher */}
            <ThemeSwitcher />

            {/* Canvas background picker */}
            <CanvasBgPicker value={canvasBg} onChange={setCanvasBg} />
          </div>

          {/* Filmstrip panel */}
          {showFilmstrip && (
            <FilmstripPanel onClose={() => setShowFilmstrip(false)} />
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
            </div>
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

        {/* ── Asset panel ── */}
        {showAssets && (
          <div
            className="w-64 flex flex-col flex-shrink-0 animate-slide-down"
            style={{
              background: "color-mix(in oklch, var(--c-base) 95%, transparent)",
              backdropFilter: "blur(20px)",
              borderLeft: "1px solid var(--c-bd1)",
            }}
          >
            <AssetPanel projectId={projectId} onClose={() => setShowAssets(false)} />
          </div>
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
            transform: showStatsSidebar ? "translateX(0)" : "translateX(100%)",
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
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          type={contextMenu.type} nodeId={contextMenu.nodeId}
          onClose={() => setContextMenu(null)}
          onAddNode={handleAddNode}
          onDeleteNode={contextMenu.nodeId ? () => {
            const nid = contextMenu.nodeId!;
            deleteNode(nid);
            deleteNodeMutation.mutate({ id: nid, projectId });
            emitCollabEvent("node:delete", { id: nid });
          } : undefined}
          onDuplicateNode={contextMenu.nodeId ? () => duplicateNode(contextMenu.nodeId!) : undefined}
          onRunWorkflow={contextMenu.nodeId ? () => handleRunRequest(contextMenu.nodeId ?? null) : undefined}
        />
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
        const aiNodes = nodes.filter(n => RUNNABLE_TYPES.includes(n.data.nodeType as NodeType));
        const totalNodes = nodes.length;
        const startLabel = pendingRunNodeId
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
                    runWorkflow(pendingRunNodeId);
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
    </div>
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
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))" }}
        >
          <Film className="w-5 h-5 text-white" />
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
