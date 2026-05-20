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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCanvasStore, type CanvasNode, type CanvasEdge } from "../hooks/useCanvasStore";
import { CustomNode } from "../components/canvas/CustomNode";
import { ContextMenu } from "../components/canvas/ContextMenu";
import { CollaboratorCursors } from "../components/canvas/CollaboratorCursors";
import { AssetPanel } from "../components/canvas/AssetPanel";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
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
  Video,
  Bot,
  StickyNote,
  LayoutGrid,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Command,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const nodeTypes = { custom: CustomNode };

// ── Icon map ──────────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  FileText, Image, Wand2, Paperclip, Video, Bot, StickyNote,
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

// ── Canvas inner ──────────────────────────────────────────────────────────────
function CanvasInner({ projectId }: { projectId: number }) {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const reactFlow = useReactFlow();

  const {
    nodes, edges, setNodes, setEdges,
    onNodesChange, onEdgesChange, onConnect,
    addNode, deleteNode, duplicateNode,
    setProjectId, isDirty, markClean, markDirty,
    setCollaborator, removeCollaborator, collaborators,
  } = useCanvasStore();

  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; type: "canvas" | "node"; nodeId?: string; canvasPos?: { x: number; y: number };
  } | null>(null);

  const [showAssets, setShowAssets] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);
  const [showNodePicker, setShowNodePicker] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [renamingProject, setRenamingProject] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data loading ────────────────────────────────────────────────────────────
  const { data: project, isLoading: projectLoading } = trpc.projects.get.useQuery(
    { id: projectId }, { enabled: !!projectId && isAuthenticated }
  );
  const { data: dbNodes } = trpc.nodes.list.useQuery(
    { projectId }, { enabled: !!projectId && isAuthenticated }
  );
  const { data: dbEdges } = trpc.edges.list.useQuery(
    { projectId }, { enabled: !!projectId && isAuthenticated }
  );

  const batchUpsertNodes = trpc.nodes.batchUpsert.useMutation();
  const upsertEdge = trpc.edges.upsert.useMutation();
  const updateProject = trpc.projects.update.useMutation();

  useEffect(() => { setProjectId(projectId); }, [projectId, setProjectId]);

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
      id: e.id, source: e.sourceNodeId, target: e.targetNodeId,
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
        setNodes(nodes.map((n) => n.id === p.id ? { ...n, position: { x: p.x, y: p.y } } : n));
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
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveCanvas(); toast.success("已保存"); }
      if (e.key === "Escape") { setContextMenu(null); setShowNodePicker(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveCanvas]);

  const collaboratorList = Array.from(collaborators.values());

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
        </div>
      </header>

      {/* ══ Main ═════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* ── Left tool sidebar ── */}
        <aside
          className="w-12 flex flex-col items-center py-3 gap-1 flex-shrink-0 z-10"
          style={{
            background: "oklch(0.09 0.006 260 / 0.95)",
            backdropFilter: "blur(20px)",
            borderRight: "1px solid oklch(0.18 0.008 260)",
          }}
        >
          {/* Add node button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowNodePicker(!showNodePicker)}
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                style={{
                  background: showNodePicker
                    ? "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))"
                    : "oklch(0.68 0.22 285 / 0.12)",
                  border: "1px solid oklch(0.68 0.22 285 / 0.35)",
                  color: "oklch(0.85 0.15 285)",
                }}
              >
                <Plus className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">添加节点</TooltipContent>
          </Tooltip>

          <ToolDivider />

          {/* Node type shortcuts */}
          {NODE_TYPE_LIST.map((config) => {
            const Icon = ICON_MAP[config.icon] ?? FileText;
            return (
              <ToolBtn
                key={config.type}
                icon={Icon}
                label={`添加${config.label}节点`}
                accent={config.color}
                onClick={() => addNodeAtCenter(config.type)}
              />
            );
          })}

          <ToolDivider />

          {/* Fit view */}
          <ToolBtn
            icon={Maximize2}
            label="适应视图"
            onClick={() => reactFlow.fitView({ padding: 0.15, duration: 400 })}
          />
        </aside>

        {/* Node picker popup */}
        {showNodePicker && (
          <div
            className="absolute left-14 top-3 z-30 rounded-xl overflow-hidden animate-scale-in"
            style={{
              background: "oklch(0.12 0.007 260)",
              border: "1px solid oklch(0.22 0.008 260)",
              boxShadow: "0 8px 40px oklch(0 0 0 / 0.6), 0 0 0 1px oklch(0.22 0.008 260 / 0.5)",
              minWidth: 200,
            }}
          >
            <div className="px-3 py-2.5" style={{ borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: "oklch(0.18 0.008 260)" }}>
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "oklch(0.45 0.008 260)" }}>
                添加节点
              </p>
            </div>
            <div className="p-1.5">
              {NODE_TYPE_LIST.map((config) => {
                const Icon = ICON_MAP[config.icon] ?? FileText;
                return (
                  <button
                    key={config.type}
                    onClick={() => addNodeAtCenter(config.type)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all text-left"
                    style={{ color: "oklch(0.70 0.008 260)" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.90 0.005 260)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "oklch(0.70 0.008 260)"; }}
                  >
                    <div
                      className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                      style={{ background: `${config.color}20`, border: `1px solid ${config.color}40` }}
                    >
                      <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
                    </div>
                    <div>
                      <p className="text-xs font-medium leading-none mb-0.5">{config.label}</p>
                      <p className="text-[10px]" style={{ color: "oklch(0.42 0.006 260)" }}>{config.defaultTitle}</p>
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
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeContextMenu={handleNodeContextMenu as Parameters<typeof ReactFlow>[0]["onNodeContextMenu"]}
            onMoveEnd={(_, vp) => { setViewport(vp); markDirty(); }}
            selectionMode={SelectionMode.Partial}
            selectionOnDrag
            panOnDrag={[1, 2]}
            zoomOnScroll
            zoomOnPinch
            fitView={!project?.viewportState}
            fitViewOptions={{ padding: 0.2 }}
            deleteKeyCode="Delete"
            multiSelectionKeyCode="Shift"
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ animated: false }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={28}
              size={1}
              color="oklch(0.22 0.008 260)"
            />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap
              position="bottom-right"
              nodeColor={(n) => getNodeConfig((n.data as { nodeType: NodeType }).nodeType)?.color ?? "oklch(0.30 0.010 260)"}
              maskColor="oklch(0.09 0.006 260 / 0.85)"
              style={{ background: "oklch(0.11 0.007 260)", border: "1px solid oklch(0.20 0.008 260)", borderRadius: 12 }}
            />
          </ReactFlow>

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
          onDeleteNode={contextMenu.nodeId ? () => deleteNode(contextMenu.nodeId!) : undefined}
          onDuplicateNode={contextMenu.nodeId ? () => duplicateNode(contextMenu.nodeId!) : undefined}
        />
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

  if (!projectId || isNaN(projectId)) {
    return (
      <div className="w-screen h-screen flex items-center justify-center" style={{ background: "oklch(0.07 0.005 260)", color: "oklch(0.45 0.008 260)" }}>
        无效的项目 ID
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <CanvasInner projectId={projectId} />
    </ReactFlowProvider>
  );
}
