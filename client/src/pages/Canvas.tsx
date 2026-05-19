import { useEffect, useCallback, useRef, useState, useMemo } from "react";
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
  Panel,
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
import { nanoid } from "nanoid";
import type { NodeType, CanvasNodePayload, CanvasEdgePayload, CollaboratorCursor } from "../../../shared/types";
import { getNodeConfig, NODE_TYPE_LIST, COLLABORATOR_COLORS } from "../lib/nodeConfig";
import { io, type Socket } from "socket.io-client";
import {
  Film,
  Save,
  Download,
  Users,
  Layers,
  ChevronLeft,
  Plus,
  Paperclip,
  Loader2,
  Wifi,
  WifiOff,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FileText,
  Image,
  Wand2,
  Video,
  Bot,
  StickyNote,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

const nodeTypes = { custom: CustomNode };

function CanvasInner({ projectId }: { projectId: number }) {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const reactFlow = useReactFlow();

  const {
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    deleteNode,
    duplicateNode,
    setProjectId,
    isDirty,
    markClean,
    markDirty,
    setCollaborator,
    removeCollaborator,
    collaborators,
  } = useCanvasStore();

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "canvas" | "node";
    nodeId?: string;
    canvasPos?: { x: number; y: number };
  } | null>(null);

  // Panels
  const [showAssets, setShowAssets] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);

  // Socket
  const socketRef = useRef<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);

  // Viewport
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });

  // Project rename state
  const [renamingProject, setRenamingProject] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  // Auto-save debounce
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load project data ──────────────────────────────────────────────────────
  const { data: project, isLoading: projectLoading } = trpc.projects.get.useQuery(
    { id: projectId },
    { enabled: !!projectId && isAuthenticated }
  );

  const { data: dbNodes } = trpc.nodes.list.useQuery(
    { projectId },
    { enabled: !!projectId && isAuthenticated }
  );

  const { data: dbEdges } = trpc.edges.list.useQuery(
    { projectId },
    { enabled: !!projectId && isAuthenticated }
  );

  // ── Mutations ──────────────────────────────────────────────────────────────
  const batchUpsertNodes = trpc.nodes.batchUpsert.useMutation();
  const upsertEdge = trpc.edges.upsert.useMutation();
  const deleteEdgeMutation = trpc.edges.delete.useMutation();
  const deleteNodeMutation = trpc.nodes.delete.useMutation();
  const updateProject = trpc.projects.update.useMutation();

  // ── Initialize from DB ─────────────────────────────────────────────────────
  useEffect(() => {
    setProjectId(projectId);
  }, [projectId, setProjectId]);

  useEffect(() => {
    if (!dbNodes) return;
    const flowNodes: CanvasNode[] = dbNodes.map((n) => ({
      id: n.id,
      type: "custom",
      position: { x: n.posX, y: n.posY },
      data: {
        nodeType: n.type as NodeType,
        title: n.title ?? getNodeConfig(n.type as NodeType).defaultTitle,
        payload: (n.data as Record<string, unknown>) ?? {},
        projectId,
      },
      style: { width: n.width, height: n.height },
      zIndex: n.zIndex,
    }));
    setNodes(flowNodes);
  }, [dbNodes]);

  useEffect(() => {
    if (!dbEdges) return;
    const flowEdges: CanvasEdge[] = dbEdges.map((e) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      sourceHandle: e.sourcePort ?? "output",
      targetHandle: e.targetPort ?? "input",
      label: e.label ?? undefined,
      style: { stroke: "oklch(0.45 0.05 260)", strokeWidth: 2 },
    }));
    setEdges(flowEdges);
  }, [dbEdges]);

  // Restore viewport
  useEffect(() => {
    if (project?.viewportState) {
      const vp = project.viewportState as { x: number; y: number; zoom: number };
      setTimeout(() => {
        reactFlow.setViewport(vp);
      }, 100);
    }
  }, [project]);

  // ── Auto-save ──────────────────────────────────────────────────────────────
  const saveCanvas = useCallback(async () => {
    if (!isDirty) return;
    try {
      // Save nodes
      if (nodes.length > 0) {
        const nodesToSave = nodes.map((n) => ({
          id: n.id,
          projectId,
          type: n.data.nodeType,
          title: n.data.title,
          data: n.data.payload as Record<string, unknown>,
          posX: n.position.x,
          posY: n.position.y,
          width: (n.style?.width as number) ?? 320,
          height: (n.style?.height as number) ?? 200,
          zIndex: n.zIndex ?? 0,
        }));
        await batchUpsertNodes.mutateAsync(nodesToSave);
      }

      // Save edges
      for (const edge of edges) {
        await upsertEdge.mutateAsync({
          id: edge.id,
          projectId,
          sourceNodeId: edge.source,
          targetNodeId: edge.target,
          sourcePort: edge.sourceHandle ?? "output",
          targetPort: edge.targetHandle ?? "input",
          label: typeof edge.label === "string" ? edge.label : undefined,
        });
      }

      // Save viewport
      const vp = reactFlow.getViewport();
      await updateProject.mutateAsync({
        id: projectId,
        viewportState: vp,
      });

      markClean();
    } catch (err) {
      console.error("Auto-save failed:", err);
    }
  }, [isDirty, nodes, edges, projectId, batchUpsertNodes, upsertEdge, updateProject, markClean, reactFlow]);

  useEffect(() => {
    if (!isDirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(saveCanvas, 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [isDirty, saveCanvas]);

  // ── Socket.io collaboration ────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const socket = io("/", {
      path: "/api/socket",
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      setSocketConnected(true);
      socket.emit("join-project", {
        projectId,
        userId: user.id,
        userName: user.name ?? "匿名",
        color: COLLABORATOR_COLORS[user.id % COLLABORATOR_COLORS.length],
      });
    });

    socket.on("disconnect", () => setSocketConnected(false));

    socket.on("collaboration-event", (event: { type: string; userId: number; userName: string; color: string; payload: unknown }) => {
      if (event.userId === user.id) return;

      switch (event.type) {
        case "cursor:move": {
          const p = event.payload as { x: number; y: number };
          setCollaborator({
            userId: event.userId,
            userName: event.userName,
            color: event.color,
            x: p.x,
            y: p.y,
          });
          break;
        }
        case "node:move": {
          const p = event.payload as { id: string; x: number; y: number };
          setNodes(
            nodes.map((n) =>
              n.id === p.id ? { ...n, position: { x: p.x, y: p.y } } : n
            )
          );
          break;
        }
        case "user:leave": {
          removeCollaborator(event.userId);
          break;
        }
      }
    });

    socketRef.current = socket;

    return () => {
      socket.emit("leave-project", { projectId, userId: user.id });
      socket.disconnect();
    };
  }, [isAuthenticated, user, projectId]);

  // Emit cursor movement
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!socketRef.current?.connected || !user) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const canvasX = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const canvasY = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      socketRef.current.emit("collaboration-event", {
        type: "cursor:move",
        projectId,
        userId: user.id,
        userName: user.name ?? "匿名",
        color: COLLABORATOR_COLORS[user.id % COLLABORATOR_COLORS.length],
        payload: { x: canvasX, y: canvasY },
      });
    },
    [user, projectId, viewport]
  );

  // ── Context menu ───────────────────────────────────────────────────────────
  const handleCanvasContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const canvasX = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const canvasY = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        type: "canvas",
        canvasPos: { x: canvasX, y: canvasY },
      });
    },
    [viewport]
  );

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: CanvasNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type: "node",
      nodeId: node.id,
    });
  }, []);

  const handleAddNode = useCallback(
    (type: NodeType) => {
      const pos = contextMenu?.canvasPos ?? { x: 200, y: 200 };
      addNode(type, pos);
    },
    [contextMenu, addNode]
  );

  // ── Export ─────────────────────────────────────────────────────────────────
  const handleExport = () => {
    const exportData = {
      version: "1.0",
      projectId,
      exportedAt: new Date().toISOString(),
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.nodeType,
        title: n.data.title,
        position: n.position,
        data: n.data.payload,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        label: e.label,
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `canvas-${projectId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("画布已导出为 JSON");
  };

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveCanvas();
        toast.success("已保存");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveCanvas]);

  const collaboratorList = Array.from(collaborators.values());

  if (projectLoading) {
    return (
      <div className="w-screen h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-background flex flex-col overflow-hidden">
      {/* ── Top Bar ── */}
      <header className="h-12 glass border-b border-border/50 flex items-center px-4 gap-3 flex-shrink-0 z-10">
        <button
          onClick={() => navigate("/")}
          className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Film className="w-3.5 h-3.5 text-white" />
          </div>
          {renamingProject ? (
            <div className="flex items-center gap-1">
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (renameValue.trim()) {
                      updateProject.mutate({ id: projectId, name: renameValue.trim() });
                    }
                    setRenamingProject(false);
                  }
                  if (e.key === "Escape") setRenamingProject(false);
                }}
                onBlur={() => {
                  if (renameValue.trim()) {
                    updateProject.mutate({ id: projectId, name: renameValue.trim() });
                  }
                  setRenamingProject(false);
                }}
                className="bg-transparent text-sm font-medium text-foreground outline-none border-b border-primary w-40"
                autoFocus
              />
              <button onClick={() => setRenamingProject(false)} className="p-0.5 hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 group/rename">
              <span className="text-sm font-medium truncate max-w-[180px]">
                {project?.name ?? "画布"}
              </span>
              <button
                onClick={() => {
                  setRenameValue(project?.name ?? "");
                  setRenamingProject(true);
                }}
                className="p-0.5 rounded opacity-0 group-hover/rename:opacity-100 hover:text-primary transition-all"
                title="重命名项目"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Dirty indicator */}
        {isDirty && (
          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            未保存
          </span>
        )}

        <div className="flex-1" />

        {/* Node type quick-add */}
        <div className="hidden md:flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/20 border border-border/30">
          {NODE_TYPE_LIST.slice(0, 6).map((config) => (
            <Tooltip key={config.type}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    const vp = reactFlow.getViewport();
                    const centerX = (window.innerWidth / 2 - vp.x) / vp.zoom;
                    const centerY = (window.innerHeight / 2 - vp.y) / vp.zoom;
                    addNode(config.type, { x: centerX + Math.random() * 100 - 50, y: centerY + Math.random() * 100 - 50 });
                  }}
                  className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/10 transition-colors"
                  style={{ color: config.color }}
                >
                  <span className="text-[10px] font-bold">{config.label[0]}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                添加{config.label}节点
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Collaborators */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowCollaborators(!showCollaborators)}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <div className={`w-2 h-2 rounded-full ${socketConnected ? "bg-green-400" : "bg-muted-foreground"}`} />
                <Users className="w-3.5 h-3.5" />
                {collaboratorList.length > 0 && (
                  <span className="text-xs">{collaboratorList.length}</span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {socketConnected ? "实时协作已连接" : "未连接"}
            </TooltipContent>
          </Tooltip>

          {/* Assets */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowAssets(!showAssets)}
                className={`p-1.5 rounded-lg hover:bg-white/5 transition-colors ${
                  showAssets ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">素材库</TooltipContent>
          </Tooltip>

          {/* Save */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { saveCanvas(); toast.success("已保存"); }}
                className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Save className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">保存 (⌘S)</TooltipContent>
          </Tooltip>

          {/* Export */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleExport}
                className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Download className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">导出 JSON</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* ── Main area ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Canvas */}
        <div
          className="flex-1 relative"
          onContextMenu={handleCanvasContextMenu}
          onMouseMove={handleMouseMove}
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
            className="bg-background"
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              style: { stroke: "oklch(0.45 0.05 260)", strokeWidth: 2 },
              animated: false,
            }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="oklch(0.30 0.02 260 / 0.5)"
            />
            <Controls
              position="bottom-left"
              showInteractive={false}
            />
            <MiniMap
              position="bottom-right"
              nodeColor={(n) => {
                const nodeType = (n.data as { nodeType: NodeType }).nodeType;
                return getNodeConfig(nodeType)?.color ?? "oklch(0.45 0.05 260)";
              }}
              maskColor="oklch(0.11 0.01 260 / 0.8)"
              style={{ background: "oklch(0.13 0.012 260)" }}
            />
          </ReactFlow>

          {/* Collaborator cursors */}
          <CollaboratorCursors cursors={collaboratorList} viewport={viewport} />
        </div>

        {/* Asset panel */}
        {showAssets && (
          <div className="w-64 glass border-l border-border/50 flex flex-col animate-slide-up">
            <AssetPanel projectId={projectId} onClose={() => setShowAssets(false)} />
          </div>
        )}

        {/* Collaborators panel */}
        {showCollaborators && collaboratorList.length > 0 && (
          <div className="absolute top-3 right-3 glass rounded-xl border border-border/60 p-3 min-w-[160px] animate-scale-in z-20">
            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">在线协作者</p>
            {collaboratorList.map((c) => (
              <div key={c.userId} className="flex items-center gap-2 py-1">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: c.color }}
                >
                  {c.userName[0]?.toUpperCase()}
                </div>
                <span className="text-xs text-foreground/80">{c.userName}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          type={contextMenu.type}
          nodeId={contextMenu.nodeId}
          onClose={() => setContextMenu(null)}
          onAddNode={handleAddNode}
          onDeleteNode={
            contextMenu.nodeId
              ? () => deleteNode(contextMenu.nodeId!)
              : undefined
          }
          onDuplicateNode={
            contextMenu.nodeId
              ? () => duplicateNode(contextMenu.nodeId!)
              : undefined
          }
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
    if (!loading && !isAuthenticated) {
      navigate("/");
    }
  }, [loading, isAuthenticated, navigate]);

  if (!projectId || isNaN(projectId)) {
    return (
      <div className="w-screen h-screen bg-background flex items-center justify-center text-muted-foreground">
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
