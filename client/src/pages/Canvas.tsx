import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
  SelectionMode,
  PanOnScrollMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCanvasStore, type CanvasNode, type CanvasEdge } from "../hooks/useCanvasStore";
import { CustomNode } from "../components/canvas/CustomNode";
import { CustomEdge } from "../components/canvas/CustomEdge";
import { ContextMenu } from "../components/canvas/ContextMenu";
import { CollaboratorCursors } from "../components/canvas/CollaboratorCursors";
import { AssetPanel } from "../components/canvas/AssetPanel";
import { PresentationMode } from "../components/canvas/PresentationMode";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useIsMobile } from "@/hooks/useMobile";
import { toast } from "sonner";
import type { NodeType, CollaboratorCursor } from "../../../shared/types";
import { getNodeConfig, NODE_TYPE_LIST, COLLABORATOR_COLORS } from "../lib/nodeConfig";
import { io, type Socket } from "socket.io-client";
import {
  Film,
  Save,
  Download,
  Users,
  ChevronLeft,
  Plus,
  Paperclip,
  Loader2,
  Pencil,
  Check,
  X,
  FileText,
  Image,
  Wand2,
  Sparkles,
  Video,
  Bot,
  StickyNote,
  LayoutGrid,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Command,
  Play,
  LogOut,
  Undo2,
  Redo2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const nodeTypes = { custom: CustomNode };
const edgeTypes = { custom: CustomEdge };

// ── Icon map ──────────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  FileText, Image, Wand2, Sparkles, Paperclip, Video, Bot, StickyNote,
};

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
              : "oklch(0.55 0.008 260)",
          }}
          onMouseEnter={(e) => {
            if (!active) {
              (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)";
              (e.currentTarget as HTMLElement).style.color = "oklch(0.85 0.005 260)";
            }
          }}
          onMouseLeave={(e) => {
            if (!active) {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "oklch(0.55 0.008 260)";
            }
          }}
        >
          <Icon className="w-4 h-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        <span>{label}</span>
        {kbd && (
          <kbd className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-white/10 font-mono">
            {kbd}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────
function ToolDivider() {
  return <div className="w-5 h-px bg-white/8 mx-auto my-1" />;
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
        color: active ? "oklch(0.68 0.22 285)" : (color ?? "oklch(0.58 0.008 260)"),
        transition: "all 120ms ease",
        flexShrink: 0,
      }}
    >
      <Icon className="w-4 h-4" style={color && !active ? { color } : undefined} />
    </button>
  );
}

function MobileToolDivider() {
  return <div style={{ width: 1, height: 20, background: "oklch(0.20 0.008 260)", flexShrink: 0 }} />;
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
  } = useCanvasStore();

  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; type: "canvas" | "node"; nodeId?: string; canvasPos?: { x: number; y: number };
  } | null>(null);

  const [showAssets, setShowAssets] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);
  const [showNodePicker, setShowNodePicker] = useState(false);
  const [showPresentation, setShowPresentation] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
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

  const batchUpsertNodes = trpc.nodes.batchUpsert.useMutation();
  const upsertEdge = trpc.edges.upsert.useMutation();
  const deleteNodeMutation = trpc.nodes.delete.useMutation();
  const deleteEdgeMutation = trpc.edges.delete.useMutation();
  const updateProject = trpc.projects.update.useMutation();

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
    if (!dbEdges) return;
    const flowEdges: CanvasEdge[] = dbEdges.map((e) => ({
      id: e.id, type: "custom",
      source: e.sourceNodeId, target: e.targetNodeId,
      sourceHandle: e.sourcePort ?? "output", targetHandle: e.targetPort ?? "input",
      label: e.label ?? undefined,
    }));
    setEdges(flowEdges);
  }, [dbEdges]);

  useEffect(() => {
    if (project?.viewportState) {
      const vp = project.viewportState as { x: number; y: number; zoom: number };
      setTimeout(() => reactFlow.setViewport(vp), 100);
    }
  }, [project]);

  // ── Auto-save ───────────────────────────────────────────────────────────────
  const saveCanvas = useCallback(async () => {
    if (!isDirty) return;
    try {
      if (nodes.length > 0) {
        await batchUpsertNodes.mutateAsync(nodes.map((n) => ({
          id: n.id, projectId, type: n.data.nodeType, title: n.data.title,
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
        setNodes(nodesRef.current.map((n) => n.id === p.id ? { ...n, position: { x: p.x, y: p.y } } : n));
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
    addNode(type, pos);
    setShowNodePicker(false);
  }, [contextMenu, addNode]);

  const addNodeAtCenter = useCallback((type: NodeType) => {
    const vp = reactFlow.getViewport();
    const cx = (window.innerWidth / 2 - vp.x) / vp.zoom;
    const cy = (window.innerHeight / 2 - vp.y) / vp.zoom;
    addNode(type, { x: cx + Math.random() * 80 - 40, y: cy + Math.random() * 80 - 40 });
    setShowNodePicker(false);
  }, [addNode, reactFlow]);

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

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip undo/redo when focus is inside an input or textarea
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveCanvas(); toast.success("已保存"); }
      if (e.key === "Escape") { setContextMenu(null); setShowNodePicker(false); }

      // Duplicate selected node: Cmd+D / Ctrl+D
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        const selected = useCanvasStore.getState().nodes.filter(n => n.selected);
        selected.forEach(n => duplicateNode(n.id));
        if (selected.length > 0) toast.success(`已复制 ${selected.length} 个节点`, { duration: 1200 });
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
  }, [saveCanvas, undo, redo]);

  const collaboratorList = Array.from(collaborators.values());

  // ── Error / not found ────────────────────────────────────────────────────────
  if (projectError) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center gap-4" style={{ background: "oklch(0.07 0.005 260)" }}>
        <p className="text-sm" style={{ color: "oklch(0.60 0.008 260)" }}>项目不存在或无权访问</p>
        <button onClick={() => navigate("/")} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "oklch(0.16 0.008 260)", color: "oklch(0.75 0.005 260)" }}>
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
        style={{ background: "oklch(0.07 0.005 260)" }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))" }}
        >
          <Film className="w-5 h-5 text-white" />
        </div>
        <div className="flex items-center gap-2 text-sm" style={{ color: "oklch(0.45 0.008 260)" }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden" style={{ background: "oklch(0.07 0.005 260)" }}>

      {/* ══ Top Bar ══════════════════════════════════════════════════════════ */}
      <header
        className="h-11 flex items-center px-3 gap-2 flex-shrink-0 z-20"
        style={{
          background: "oklch(0.09 0.006 260 / 0.95)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid oklch(0.18 0.008 260)",
        }}
      >
        {/* Back */}
        <button
          onClick={() => navigate("/")}
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
          style={{ color: "oklch(0.50 0.008 260)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.85 0.005 260)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.50 0.008 260)"; }}
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
                  color: "oklch(0.90 0.005 260)",
                  borderBottomWidth: 1,
                  borderBottomStyle: "solid",
                  borderBottomColor: "oklch(0.68 0.22 285)",
                }}
                autoFocus
              />
              <button onClick={() => setRenamingProject(false)} style={{ color: "oklch(0.50 0.008 260)" }}>
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div
              className="group/title flex items-center gap-1 cursor-pointer"
              onClick={() => { setRenameValue(project?.name ?? ""); setRenamingProject(true); }}
            >
              <span className="text-sm font-medium truncate max-w-[160px]" style={{ color: "oklch(0.88 0.005 260)" }}>
                {project?.name ?? "画布"}
              </span>
              <Pencil
                className="w-3 h-3 opacity-0 group-hover/title:opacity-100 transition-opacity"
                style={{ color: "oklch(0.50 0.008 260)" }}
              />
            </div>
          )}
        </div>

        {/* Dirty dot */}
        {isDirty && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "oklch(0.55 0.008 260)" }}>
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
              color: "oklch(0.55 0.008 260)",
            }}
            onMouseEnter={(e) => { if (!showCollaborators) { (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; } }}
            onMouseLeave={(e) => { if (!showCollaborators) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.55 0.008 260)"; } }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: socketConnected ? "oklch(0.72 0.18 155)" : "oklch(0.45 0.008 260)" }}
            />
            <Users className="w-3.5 h-3.5" />
            {collaboratorList.length > 0 && <span>{collaboratorList.length}</span>}
          </button>

          {/* Presentation mode */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowPresentation(true)}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ color: "oklch(0.55 0.008 260)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.55 0.008 260)"; }}
              >
                <Play className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">演示模式</TooltipContent>
          </Tooltip>

          {/* Assets */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowAssets(!showAssets)}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{
                  background: showAssets ? "oklch(0.68 0.22 285 / 0.12)" : "transparent",
                  border: showAssets ? "1px solid oklch(0.68 0.22 285 / 0.3)" : "1px solid transparent",
                  color: showAssets ? "oklch(0.68 0.22 285)" : "oklch(0.55 0.008 260)",
                }}
                onMouseEnter={(e) => { if (!showAssets) { (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; } }}
                onMouseLeave={(e) => { if (!showAssets) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.55 0.008 260)"; } }}
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">素材库</TooltipContent>
          </Tooltip>

          {/* Undo */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { undo(); toast.info("已撤销", { duration: 1200 }); }}
                disabled={past.length === 0}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ color: past.length === 0 ? "oklch(0.30 0.006 260)" : "oklch(0.55 0.008 260)", cursor: past.length === 0 ? "not-allowed" : "pointer" }}
                onMouseEnter={(e) => { if (past.length > 0) { (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; } }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = past.length === 0 ? "oklch(0.30 0.006 260)" : "oklch(0.55 0.008 260)"; }}
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              撤销 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-white/10 font-mono">⌘Z</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Redo */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { redo(); toast.info("已重做", { duration: 1200 }); }}
                disabled={future.length === 0}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ color: future.length === 0 ? "oklch(0.30 0.006 260)" : "oklch(0.55 0.008 260)", cursor: future.length === 0 ? "not-allowed" : "pointer" }}
                onMouseEnter={(e) => { if (future.length > 0) { (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; } }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = future.length === 0 ? "oklch(0.30 0.006 260)" : "oklch(0.55 0.008 260)"; }}
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              重做 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-white/10 font-mono">⌘⇧Z</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Save */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { saveCanvas(); toast.success("已保存"); }}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ color: "oklch(0.55 0.008 260)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.55 0.008 260)"; }}
              >
                <Save className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              保存 <kbd className="ml-1 px-1 py-0.5 rounded text-[10px] bg-white/10 font-mono">⌘S</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Export */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleExport}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ color: "oklch(0.55 0.008 260)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.55 0.008 260)"; }}
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">导出 JSON</TooltipContent>
          </Tooltip>
          {/* Divider */}
          <div className="w-px h-4 mx-1" style={{ background: "oklch(0.22 0.008 260)" }} />
          {/* Logout */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={async () => {
                  await logout();
                  navigate("/");
                }}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ color: "oklch(0.50 0.008 260)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "oklch(0.55 0.18 20 / 0.12)";
                  (e.currentTarget as HTMLElement).style.color = "oklch(0.65 0.18 20)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "oklch(0.50 0.008 260)";
                }}
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
              background: "oklch(0.11 0.007 260 / 0.97)",
              border: "1px solid oklch(0.22 0.008 260)",
              boxShadow: "0 16px 60px oklch(0 0 0 / 0.70), 0 4px 16px oklch(0 0 0 / 0.40), 0 0 0 1px oklch(0.22 0.008 260 / 0.5)",
              backdropFilter: "blur(24px)",
              minWidth: 480,
            }}
          >
            <div className="px-4 py-3" style={{ borderBottom: "1px solid oklch(0.18 0.008 260)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "oklch(0.40 0.006 260)" }}>
                添加节点
              </p>
            </div>
            <div className="p-2 grid grid-cols-4 gap-1">
              {NODE_TYPE_LIST.map((config) => {
                const Icon = ICON_MAP[config.icon] ?? FileText;
                return (
                  <button
                    key={config.type}
                    onClick={() => addNodeAtCenter(config.type)}
                    className="flex flex-col items-center gap-2 px-3 py-3 rounded-xl transition-all text-center"
                    style={{ color: "oklch(0.70 0.008 260)" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.90 0.005 260)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.70 0.008 260)"; }}
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: `${config.color}18`, border: `1px solid ${config.color}35` }}
                    >
                      <Icon className="w-4.5 h-4.5" style={{ color: config.color, width: 18, height: 18 }} />
                    </div>
                    <div>
                      <p className="text-[11px] font-medium leading-none">{config.label}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Canvas ── */}
        <div
          className="flex-1 relative"
          onContextMenu={handleCanvasContextMenu}
          onMouseMove={handleMouseMove}
          onClick={() => { setShowNodePicker(false); }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeContextMenu={handleNodeContextMenu as Parameters<typeof ReactFlow>[0]["onNodeContextMenu"]}
            onNodesDelete={(deleted) => deleted.forEach((n) => deleteNodeMutation.mutate({ id: n.id, projectId }))}
            onEdgesDelete={(deleted) => deleted.forEach((e) => deleteEdgeMutation.mutate({ id: e.id, projectId }))}
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
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={28}
              size={1}
              color="oklch(0.22 0.008 260)"
            />
            <MiniMap
              position="bottom-right"
              nodeColor={(n) => getNodeConfig((n.data as { nodeType: NodeType }).nodeType)?.color ?? "oklch(0.30 0.010 260)"}
              maskColor="oklch(0.09 0.006 260 / 0.85)"
              style={{ background: "oklch(0.11 0.007 260)", border: "1px solid oklch(0.20 0.008 260)", borderRadius: 12, marginBottom: 64 }}
            />
          </ReactFlow>

          {/* ── Bottom floating toolbar ── */}
          <div
            className="absolute bottom-5 left-1/2 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: "translateX(-50%)",
              background: "oklch(0.10 0.007 260 / 0.95)",
              backdropFilter: "blur(24px)",
              border: "1px solid oklch(0.20 0.008 260)",
              boxShadow: "0 8px 40px oklch(0 0 0 / 0.60), 0 2px 8px oklch(0 0 0 / 0.40), 0 0 0 1px oklch(0.20 0.008 260 / 0.5)",
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
            <div style={{ width: 1, height: 18, background: "oklch(0.22 0.008 260)", flexShrink: 0 }} />

            {/* Node type quick-add */}
            {NODE_TYPE_LIST.map((config) => {
              const Icon = ICON_MAP[config.icon] ?? FileText;
              return (
                <Tooltip key={config.type}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => addNodeAtCenter(config.type)}
                      className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                      style={{ color: "oklch(0.50 0.008 260)" }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = `${config.color}18`;
                        (e.currentTarget as HTMLElement).style.color = config.color;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                        (e.currentTarget as HTMLElement).style.color = "oklch(0.50 0.008 260)";
                      }}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">{config.label}</TooltipContent>
                </Tooltip>
              );
            })}

            {/* Divider */}
            <div style={{ width: 1, height: 18, background: "oklch(0.22 0.008 260)", flexShrink: 0 }} />

            {/* Zoom controls */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => reactFlow.zoomOut({ duration: 200 })}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                  style={{ color: "oklch(0.50 0.008 260)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.18 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.50 0.008 260)"; }}
                >
                  <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 300 }}>−</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">缩小</TooltipContent>
            </Tooltip>

            <button
              onClick={() => reactFlow.zoomTo(1, { duration: 300 })}
              className="h-7 px-2 rounded-lg text-[11px] font-mono transition-all tabular-nums"
              style={{ color: "oklch(0.50 0.008 260)", minWidth: 44, textAlign: "center" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.18 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.50 0.008 260)"; }}
              title="点击重置为 100%"
            >
              {Math.round(viewport.zoom * 100)}%
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => reactFlow.zoomIn({ duration: 200 })}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                  style={{ color: "oklch(0.50 0.008 260)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.18 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.50 0.008 260)"; }}
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
                  style={{ color: "oklch(0.50 0.008 260)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.18 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.50 0.008 260)"; }}
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">适应视图</TooltipContent>
            </Tooltip>

            {/* Divider */}
            <div style={{ width: 1, height: 18, background: "oklch(0.22 0.008 260)", flexShrink: 0 }} />

            {/* Shortcut help button */}
            <div className="relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setShowShortcuts((v) => !v)}
                    className="w-8 h-8 rounded-xl flex items-center justify-center transition-all text-xs font-bold"
                    style={{
                      color: showShortcuts ? "oklch(0.80 0.18 285)" : "oklch(0.50 0.008 260)",
                      background: showShortcuts ? "oklch(0.68 0.22 285 / 0.15)" : "transparent",
                    }}
                    onMouseEnter={(e) => { if (!showShortcuts) { (e.currentTarget as HTMLElement).style.background = "oklch(0.18 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.80 0.005 260)"; } }}
                    onMouseLeave={(e) => { if (!showShortcuts) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.50 0.008 260)"; } }}
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
                    background: "oklch(0.10 0.007 260 / 0.97)",
                    backdropFilter: "blur(24px)",
                    border: "1px solid oklch(0.20 0.008 260)",
                    boxShadow: "0 16px 48px oklch(0 0 0 / 0.70), 0 4px 12px oklch(0 0 0 / 0.40)",
                  }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "oklch(0.42 0.006 260)" }}>快捷键速查</p>
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
                    { group: "其他", items: [
                      { key: "Cmd/Ctrl + S", desc: "保存画布" },
                      { key: "?", desc: "开关快捷键面板" },
                    ]},
                  ].map(({ group, items }) => (
                    <div key={group} className="mb-3 last:mb-0">
                      <p className="text-[9px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "oklch(0.35 0.006 260)" }}>{group}</p>
                      <div className="flex flex-col gap-1">
                        {items.map(({ key, desc }) => (
                          <div key={key} className="flex items-center justify-between">
                            <span style={{ fontSize: 11, color: "oklch(0.65 0.005 260)" }}>{desc}</span>
                            <span
                              className="font-mono text-[10px] px-1.5 py-0.5 rounded-md"
                              style={{
                                background: "oklch(0.16 0.007 260)",
                                border: "1px solid oklch(0.24 0.008 260)",
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
          </div>

          {/* Collaborator cursors */}
          <CollaboratorCursors cursors={collaboratorList} viewport={viewport} />

          {/* Collaborators panel */}
          {showCollaborators && (
            <div
              className="absolute top-3 right-3 rounded-xl p-3 min-w-[180px] z-20 animate-scale-in"
              style={{
                background: "oklch(0.12 0.007 260 / 0.95)",
                backdropFilter: "blur(20px)",
                border: "1px solid oklch(0.20 0.008 260)",
                boxShadow: "0 8px 32px oklch(0 0 0 / 0.5)",
              }}
            >
              <p className="text-[10px] font-medium uppercase tracking-wider mb-2.5" style={{ color: "oklch(0.42 0.006 260)" }}>
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
                  <p className="text-xs font-medium" style={{ color: "oklch(0.80 0.005 260)" }}>{user?.name ?? "我"}</p>
                  <p className="text-[10px]" style={{ color: "oklch(0.42 0.006 260)" }}>本人</p>
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
                    <p className="text-xs font-medium" style={{ color: "oklch(0.80 0.005 260)" }}>{c.userName}</p>
                    <p className="text-[10px]" style={{ color: "oklch(0.42 0.006 260)" }}>协作中</p>
                  </div>
                </div>
              ))}
              {collaboratorList.length === 0 && (
                <p className="text-xs mt-1" style={{ color: "oklch(0.42 0.006 260)" }}>暂无其他协作者</p>
              )}
            </div>
          )}
        </div>

        {/* ── Asset panel ── */}
        {showAssets && (
          <div
            className="w-64 flex flex-col flex-shrink-0 animate-slide-down"
            style={{
              background: "oklch(0.09 0.006 260 / 0.95)",
              backdropFilter: "blur(20px)",
              borderLeft: "1px solid oklch(0.18 0.008 260)",
            }}
          >
            <AssetPanel projectId={projectId} onClose={() => setShowAssets(false)} />
          </div>
        )}
      </div>

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
          } : undefined}
          onDuplicateNode={contextMenu.nodeId ? () => duplicateNode(contextMenu.nodeId!) : undefined}
        />
      )}



      {/* ── Presentation mode ── */}
      {showPresentation && (
        <PresentationMode nodes={nodes} onClose={() => setShowPresentation(false)} />
      )}
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
        style={{ background: "oklch(0.07 0.005 260)" }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))" }}
        >
          <Film className="w-5 h-5 text-white" />
        </div>
        <div className="flex items-center gap-2 text-sm" style={{ color: "oklch(0.45 0.008 260)" }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          验证身份中...
        </div>
      </div>
    );
  }

  if (!projectId || isNaN(projectId)) {
    return (
      <div className="w-screen h-screen flex items-center justify-center" style={{ background: "oklch(0.07 0.005 260)", color: "oklch(0.45 0.008 260)" }}>
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
