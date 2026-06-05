import { create } from "zustand";
import { nanoid } from "nanoid";
import {
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "@xyflow/react";
import type { NodeType, NodeData, CollaboratorCursor } from "../../../shared/types";
import { getNodeConfig } from "../lib/nodeConfig";
import { resolveNodeOutputImageUrl, isRefImageTarget } from "../lib/refImagePropagation";

export interface CanvasNode extends Node {
  data: {
    nodeType: NodeType;
    title: string;
    payload: NodeData;
    projectId: number;
    onUpdate?: (payload: Partial<NodeData>) => void;
  };
}

export interface CanvasEdge extends Edge {}

// ── History snapshot (for undo/redo) ─────────────────────────────────────────
interface HistorySnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

// ── Named snapshots (version history, localStorage) ───────────────────────────
export interface NamedSnapshot {
  id: string;
  name: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

function getSnapshotKey(projectId: number | null) {
  return `ai-video-canvas:snapshots:${projectId ?? "default"}`;
}

export function loadNamedSnapshots(projectId: number | null): NamedSnapshot[] {
  try {
    const raw = localStorage.getItem(getSnapshotKey(projectId));
    return raw ? (JSON.parse(raw) as NamedSnapshot[]) : [];
  } catch {
    return [];
  }
}

function persistNamedSnapshots(projectId: number | null, snaps: NamedSnapshot[]) {
  localStorage.setItem(getSnapshotKey(projectId), JSON.stringify(snaps.slice(0, 20)));
}

const MAX_HISTORY = 50;

// Runtime/output payload fields stripped when cloning a node (duplicate / variants
// / import) so the copy doesn't claim it already generated or share a task id.
const CLONE_RUNTIME_FIELDS = [
  "imageUrl", "imageStorageKey", "imageHistory", "imageUrls", "selectedImageIndex",
  "resultVideoUrl", "errorMessage", "progress", "taskId", "externalTaskId",
  "status", "messages", "url", "storageKey", "outputUrl", "outputDuration",
];

// Generation node types that support A/B 变体 (fresh seed per clone).
export const VARIANT_TYPES: NodeType[] = [
  "image_gen", "video_task", "comfyui_image", "comfyui_video", "comfyui_workflow",
];

// Shape of an exported graph file (see Canvas handleExport) accepted by importGraph.
export interface ImportedGraph {
  nodes?: Array<{ id?: string; type?: string; title?: string; position?: { x: number; y: number }; data?: Record<string, unknown> }>;
  edges?: Array<{ id?: string; source?: string; target?: string; sourceHandle?: string | null; targetHandle?: string | null; label?: string }>;
}

interface CanvasStore {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeIds: string[];
  collaborators: Map<number, CollaboratorCursor>;
  projectId: number | null;
  isDirty: boolean;

  // IDs of nodes removed locally that may still have a DB row. The save loop
  // deletes these server-side (reconciliation) so deletions survive a reload —
  // previously only the context-menu delete hit the server, so removing a node
  // via the Delete key left an orphan row that "resurrected" on next open.
  deletedNodeIds: string[];

  // Undo/redo history
  past: HistorySnapshot[];
  future: HistorySnapshot[];

  // Actions
  setProjectId: (id: number) => void;
  /** Current logged-in user id — stamped as `createdBy` on nodes this client
   *  creates, so collaborators can be distinguished by a per-creator color dot. */
  currentUserId: number | null;
  setCurrentUserId: (id: number | null) => void;
  /** Cross-component "please run the workflow" request (the agent's auto-run sets
   *  it; Canvas watches the token and routes it through the normal run-confirm). */
  runRequest: { startNodeId: string | null; token: number } | null;
  requestRun: (startNodeId: string | null) => void;
  setNodes: (nodes: CanvasNode[]) => void;
  setEdges: (edges: CanvasEdge[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => CanvasNode;
  /** Add a sized `group` "scene" container box behind other nodes (zIndex -1).
   *  Used by the agent apply layer to wrap a scene's shots. */
  addGroupBox: (rect: { x: number; y: number; width: number; height: number }, title: string) => void;
  batchAddSceneNodes: (
    scenes: Array<{ description?: string; promptText?: string; negativePrompt?: string; cameraMovement?: string; duration?: number; lens?: string; colorGrade?: string; shotType?: string; lighting?: string }>,
    sourceNodeId: string,
    sourcePosition: { x: number; y: number },
    targetType?: "storyboard" | "comfyui_image"
  ) => void;
  // payload allows an extra `pinned?: boolean` field — a transient UI flag stored
  // on every node payload (no DB schema change) controlling whether the node's
  // input panel stays expanded regardless of `selected`. Toggled from the
  // right-click context menu.
  updateNodeData: (id: string, payload: Partial<NodeData> & { pinned?: boolean }, silent?: boolean) => void;
  batchUpdateNodeData: (updates: { id: string; payload: Partial<NodeData> }[]) => void;
  /** Batch-move many nodes in one history step (used by the agent's auto-layout). */
  batchUpdateNodePositions: (updates: { id: string; position: { x: number; y: number } }[]) => void;
  /** Run `fn` as a single undoable batch: snapshot history once up-front and
   *  suppress per-action history pushes during `fn` (used when the agent applies
   *  a multi-step plan so one Ctrl+Z reverts the whole batch). */
  runBatch: (fn: () => void) => void;
  /** internal: when true, mutating actions skip their own pushHistory. */
  _suppressHistory: boolean;
  updateNodeTitle: (id: string, title: string) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  /** Clone a generation node into `count` A/B variants (fresh seed each, same
   *  upstream inputs re-wired). Returns the number of variants created. */
  createVariants: (id: string, count: number) => number;
  /** Import an exported graph (canvas-x.json) into the current project, remapping
   *  all ids so it merges without colliding. Returns counts created. */
  importGraph: (graph: ImportedGraph) => { nodes: number; edges: number };
  updateEdgeLabel: (id: string, label: string) => void;

  // Named snapshots
  saveNamedSnapshot: (name: string) => void;
  restoreNamedSnapshot: (snap: NamedSnapshot) => void;
  deleteNamedSnapshot: (id: string) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setCollaborator: (cursor: CollaboratorCursor) => void;
  removeCollaborator: (userId: number) => void;
  markClean: () => void;
  markDirty: () => void;
  clearDeletedNodeIds: (ids: string[]) => void;
  resetCanvas: () => void;
  undo: () => void;
  redo: () => void;
}

/** Push current state to past stack and clear future */
function pushHistory(state: CanvasStore): Partial<CanvasStore> {
  const snapshot: HistorySnapshot = {
    nodes: state.nodes,
    edges: state.edges,
  };
  const past = [...state.past, snapshot].slice(-MAX_HISTORY);
  return { past, future: [] };
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeIds: [],
  collaborators: new Map(),
  projectId: null,
  currentUserId: null,
  isDirty: false,
  _suppressHistory: false,
  deletedNodeIds: [],
  past: [],
  future: [],

  setProjectId: (id) => set({ projectId: id }),
  setCurrentUserId: (id) => set({ currentUserId: id }),
  runRequest: null,
  requestRun: (startNodeId) => set((s) => ({ runRequest: { startNodeId, token: (s.runRequest?.token ?? 0) + 1 } })),

  // setNodes / setEdges are used for initial load — don't push to history
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  onNodesChange: (changes) => {
    // Only push history for structural changes (add/remove), not position drags
    const isStructural = changes.some(
      (c) => c.type === "add" || c.type === "remove"
    );
    // Track removals (e.g. Delete/Backspace key) so the save can delete them
    // server-side — applyNodeChanges only mutates local state.
    const removedIds = changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id);
    set((state) => ({
      ...(isStructural ? pushHistory(state) : {}),
      nodes: applyNodeChanges(changes, state.nodes) as CanvasNode[],
      deletedNodeIds: removedIds.length ? [...state.deletedNodeIds, ...removedIds] : state.deletedNodeIds,
      isDirty: true,
    }));
  },

  onEdgesChange: (changes) => {
    const isStructural = changes.some(
      (c) => c.type === "add" || c.type === "remove"
    );
    set((state) => ({
      ...(isStructural ? pushHistory(state) : {}),
      edges: applyEdgeChanges(changes, state.edges) as CanvasEdge[],
      isDirty: true,
    }));
  },

  onConnect: (connection) => {
    set((state) => {
      // Pre-populate so the video node is ready immediately if an image was generated before connecting
      let updatedNodes = state.nodes;
      if (connection.source && connection.target) {
        const sourceNode = state.nodes.find((n) => n.id === connection.source);
        const targetNode = state.nodes.find((n) => n.id === connection.target);
        // A `ref-image-in` target handle uniquely identifies a reference-image
        // wire regardless of which source dot was dragged from. Source/target
        // coverage (which source types expose an output image, which targets
        // accept a reference image) is centralized in refImagePropagation and
        // shared with each node's post-generation propagateRefImage call.
        if (
          connection.targetHandle === "ref-image-in" &&
          targetNode && isRefImageTarget(targetNode.data.nodeType)
        ) {
          const imageUrl = resolveNodeOutputImageUrl(sourceNode);
          if (imageUrl) {
            updatedNodes = state.nodes.map((n) =>
              n.id === connection.target
                ? { ...n, data: { ...n.data, payload: { ...n.data.payload, referenceImageUrl: imageUrl } } }
                : n
            ) as CanvasNode[];
          }
        }
      }
      return {
        ...(get()._suppressHistory ? {} : pushHistory(state)),
        nodes: updatedNodes,
        edges: addEdge(
          { ...connection, id: nanoid(), type: "custom", animated: false },
          state.edges
        ) as CanvasEdge[],
        isDirty: true,
      };
    });
  },

  addNode: (type, position) => {
    const config = getNodeConfig(type);
    const id = nanoid();
    const projectId = get().projectId;
    if (!projectId) throw new Error("Cannot add node before project is loaded");

    // Auto-number duplicate-type nodes so users can tell them apart:
    //   first one    → config.defaultTitle (unchanged, e.g. '提示词' or '分镜 #1')
    //   subsequent  → '{base} #N' where base = defaultTitle stripped of any
    //                 trailing '#N' suffix, and N = max(existing #) + 1.
    //                 Picks max(existing) instead of count so deleting middle
    //                 nodes doesn't produce duplicate numbers on re-add.
    const sameType = get().nodes.filter((n) => n.data.nodeType === type);
    const stripNum = /\s*#\d+$/;
    const base = config.defaultTitle.replace(stripNum, "");
    let title = config.defaultTitle;
    if (sameType.length > 0) {
      const maxNum = sameType.reduce((max, n) => {
        const m = n.data.title.match(/#(\d+)$/);
        // Untrailed titles count as #1, so the next one becomes #2 (not #1 again).
        return m ? Math.max(max, parseInt(m[1], 10)) : Math.max(max, 1);
      }, 0);
      title = `${base} #${maxNum + 1}`;
    }

    const uid = get().currentUserId;
    const newNode: CanvasNode = {
      id,
      type: "custom",
      position,
      data: {
        nodeType: type,
        title,
        // Stamp creator id into the payload (transient, no schema change — same
        // pattern as `pinned`) so each node shows its placer's collaborator color.
        payload: { ...getDefaultPayload(type), ...(uid != null ? { createdBy: uid } : {}) } as NodeData,
        projectId,
      },
      style: {
        width: config.defaultWidth,
        // height is intentionally omitted — let content drive the node height
      },
    };

    set((state) => ({
      ...(get()._suppressHistory ? {} : pushHistory(state)),
      nodes: [...state.nodes, newNode],
      isDirty: true,
    }));

    return newNode;
  },

  addGroupBox: (rect, title) => {
    const projectId = get().projectId;
    if (!projectId) return;
    const uid = get().currentUserId;
    const node: CanvasNode = {
      id: nanoid(),
      type: "custom",
      position: { x: rect.x, y: rect.y },
      // Render behind the shot nodes it wraps (shots default to zIndex 0).
      zIndex: -1,
      data: {
        nodeType: "group",
        title,
        payload: { ...getDefaultPayload("group"), ...(uid != null ? { createdBy: uid } : {}) } as NodeData,
        projectId,
      },
      style: { width: rect.width, height: rect.height },
    };
    set((state) => ({
      ...(get()._suppressHistory ? {} : pushHistory(state)),
      nodes: [...state.nodes, node],
      isDirty: true,
    }));
  },

  batchAddSceneNodes: (scenes, sourceNodeId, sourcePosition, targetType = "storyboard") => {
    const storeProjectId = get().projectId;
    if (!storeProjectId) return; // guard: project not loaded yet
    set((state) => {
      const projectId = state.nodes.find((n) => n.id === sourceNodeId)?.data.projectId ?? storeProjectId;
      const isComfy = targetType === "comfyui_image";
      const sceneUid = get().currentUserId ?? undefined;
      const config = getNodeConfig(isComfy ? "comfyui_image" : "storyboard");
      const nodeWidth = (config.defaultWidth as number) ?? 360;
      const newNodes: CanvasNode[] = scenes.map((scene, i) => ({
        id: nanoid(),
        type: "custom" as const,
        position: { x: sourcePosition.x + i * (nodeWidth + 40), y: sourcePosition.y + 500 },
        data: isComfy
          ? {
              nodeType: "comfyui_image" as const,
              title: `ComfyUI 图像 #${i + 1}`,
              payload: {
                // Scene image prompt → ComfyUI prompt; the user fills ckpt/server later.
                workflowTemplate: "txt2img" as const,
                prompt: scene.promptText || scene.description || "",
                negPrompt: scene.negativePrompt || undefined,
                createdBy: sceneUid,
              },
              projectId,
            }
          : {
              nodeType: "storyboard" as const,
              title: `分镜 #${i + 1}`,
              payload: {
                description: scene.description ?? "",
                promptText: scene.promptText ?? "",
                negativePrompt: scene.negativePrompt || undefined,
                cameraMovement: scene.cameraMovement,
                duration: scene.duration,
                lens: scene.lens || undefined,
                colorTone: scene.colorGrade || undefined,
                createdBy: sceneUid,
              },
              projectId,
            },
        style: { width: nodeWidth },
      }));
      const newEdges: CanvasEdge[] = newNodes.map((node) => ({
        id: nanoid(),
        source: sourceNodeId,
        target: node.id,
        sourceHandle: "output",
        targetHandle: "input",
        type: "custom",
        animated: false,
      }));
      return {
        ...pushHistory(state),
        nodes: [...state.nodes, ...newNodes],
        edges: [...state.edges, ...newEdges],
        isDirty: true,
      };
    });
  },

  updateNodeData: (id, payload, silent = false) => {
    set((state) => ({
      ...(silent ? {} : pushHistory(state)),
      nodes: state.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, payload: { ...n.data.payload, ...payload } as NodeData } }
          : n
      ),
      isDirty: true,
    }));
  },

  batchUpdateNodeData: (updates) => {
    if (updates.length === 0) return;
    const updateMap = new Map(updates.map((u) => [u.id, u.payload]));
    set((state) => ({
      ...pushHistory(state),
      nodes: state.nodes.map((n) => {
        const patch = updateMap.get(n.id);
        return patch ? { ...n, data: { ...n.data, payload: { ...n.data.payload, ...patch } as NodeData } } : n;
      }),
      isDirty: true,
    }));
  },

  batchUpdateNodePositions: (updates) => {
    if (updates.length === 0) return;
    const posMap = new Map(updates.map((u) => [u.id, u.position]));
    set((state) => ({
      ...pushHistory(state),
      nodes: state.nodes.map((n) => (posMap.has(n.id) ? { ...n, position: posMap.get(n.id)! } : n)),
      isDirty: true,
    }));
  },

  runBatch: (fn) => {
    // Snapshot once, then suppress per-action history so the whole batch is one undo.
    set((state) => ({ ...pushHistory(state), _suppressHistory: true }));
    try { fn(); } finally { set({ _suppressHistory: false }); }
  },

  updateNodeTitle: (id, title) => {
    set((state) => ({
      ...(get()._suppressHistory ? {} : pushHistory(state)),
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, title } } : n
      ),
      isDirty: true,
    }));
  },

  deleteNode: (id) => {
    set((state) => ({
      ...(get()._suppressHistory ? {} : pushHistory(state)),
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      deletedNodeIds: [...state.deletedNodeIds, id],
      isDirty: true,
    }));
  },

  updateEdgeLabel: (id, label) => {
    set((state) => ({
      ...pushHistory(state),
      edges: state.edges.map((e) =>
        e.id === id ? { ...e, label: label || undefined } : e
      ),
      isDirty: true,
    }));
  },

  duplicateNode: (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const newId = nanoid();
    // Strip runtime/output fields when cloning so the duplicate doesn't claim it
    // already finished generating, and doesn't reuse the original node's taskId
    // (which would make both the source and the duplicate poll the same task and
    // appear to "succeed" together — confusing and a vector for accidental re-submits).
    const clonedPayload = JSON.parse(JSON.stringify(node.data.payload)) as Record<string, unknown>;
    for (const k of CLONE_RUNTIME_FIELDS) delete clonedPayload[k];
    // The duplicate is authored by whoever clicked duplicate.
    const dupUid = get().currentUserId;
    if (dupUid != null) clonedPayload.createdBy = dupUid;
    const newNode: CanvasNode = {
      ...node,
      id: newId,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      data: { ...node.data, payload: clonedPayload as typeof node.data.payload },
      selected: false,
    };
    set((state) => ({
      ...(get()._suppressHistory ? {} : pushHistory(state)),
      nodes: [...state.nodes, newNode],
      isDirty: true,
    }));
  },

  createVariants: (id, count) => {
    const state0 = get();
    const node = state0.nodes.find((n) => n.id === id);
    if (!node || count < 1) return 0;
    const dupUid = state0.currentUserId;
    // Re-wire each variant from the same upstream inputs as the source so they
    // actually have what they need to generate (A/B comparison on equal inputs).
    const incoming = state0.edges.filter((e) => e.target === id);
    const newNodes: CanvasNode[] = [];
    const newEdges: CanvasEdge[] = [];
    for (let i = 1; i <= count; i++) {
      const newId = nanoid();
      const p = JSON.parse(JSON.stringify(node.data.payload)) as Record<string, unknown>;
      for (const k of CLONE_RUNTIME_FIELDS) delete p[k];
      if (dupUid != null) p.createdBy = dupUid;
      // Fresh random seed per variant so they diverge even on identical configs.
      p.seed = Math.floor(Math.random() * 2147483647);
      newNodes.push({
        ...node,
        id: newId,
        position: { x: node.position.x + 380, y: node.position.y + (i - 1) * 180 },
        data: { ...node.data, payload: p as typeof node.data.payload, title: `${node.data.title} · 变体${i}` },
        selected: false,
      });
      for (const e of incoming) newEdges.push({ ...e, id: nanoid(), target: newId });
    }
    set((s) => ({
      ...pushHistory(s),
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges],
      isDirty: true,
    }));
    return newNodes.length;
  },

  importGraph: (graph) => {
    const { projectId } = get();
    if (!projectId) return { nodes: 0, edges: 0 };
    const dupUid = get().currentUserId;
    const srcNodes = graph.nodes ?? [];
    const srcEdges = graph.edges ?? [];
    // Map each imported node's old id → a fresh id, so importing into a populated
    // canvas never collides with existing nodes (and can be imported repeatedly).
    const idMap = new Map<string, string>();
    const newNodes: CanvasNode[] = [];
    for (const sn of srcNodes) {
      const type = sn.type as NodeType | undefined;
      if (!type || !sn.id) continue;
      const cfg = getNodeConfig(type);
      if (!cfg) continue; // unknown node type — skip rather than corrupt the canvas
      const newId = nanoid();
      idMap.set(sn.id, newId);
      const payload = { ...(sn.data ?? {}) } as Record<string, unknown>;
      for (const k of CLONE_RUNTIME_FIELDS) delete payload[k];
      if (dupUid != null) payload.createdBy = dupUid;
      const pos = sn.position ?? { x: 0, y: 0 };
      newNodes.push({
        id: newId,
        type: "custom",
        position: { x: pos.x + 60, y: pos.y + 60 },
        data: { nodeType: type, title: sn.title ?? cfg.defaultTitle, projectId, payload: payload as CanvasNode["data"]["payload"] },
        selected: false,
      });
    }
    const newEdges: CanvasEdge[] = [];
    for (const se of srcEdges) {
      const source = se.source && idMap.get(se.source);
      const target = se.target && idMap.get(se.target);
      if (!source || !target) continue; // dangling — drop
      newEdges.push({
        id: nanoid(), source, target,
        sourceHandle: se.sourceHandle ?? undefined,
        targetHandle: se.targetHandle ?? undefined,
        label: typeof se.label === "string" ? se.label : undefined,
      } as CanvasEdge);
    }
    if (newNodes.length === 0) return { nodes: 0, edges: 0 };
    set((s) => ({
      ...pushHistory(s),
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges],
      isDirty: true,
    }));
    return { nodes: newNodes.length, edges: newEdges.length };
  },

  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),

  setCollaborator: (cursor) => {
    set((state) => {
      const next = new Map(state.collaborators);
      next.set(cursor.userId, cursor);
      return { collaborators: next };
    });
  },

  removeCollaborator: (userId) => {
    set((state) => {
      const next = new Map(state.collaborators);
      next.delete(userId);
      return { collaborators: next };
    });
  },

  saveNamedSnapshot: (name) => {
    const { nodes, edges, projectId } = get();
    const snap: NamedSnapshot = {
      id: nanoid(),
      name,
      createdAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodes,
      edges,
    };
    const existing = loadNamedSnapshots(projectId);
    persistNamedSnapshots(projectId, [snap, ...existing]);
  },

  restoreNamedSnapshot: (snap) => {
    set((state) => ({
      ...pushHistory(state),
      nodes: snap.nodes,
      edges: snap.edges,
      isDirty: true,
    }));
  },

  deleteNamedSnapshot: (snapId) => {
    const { projectId } = get();
    const existing = loadNamedSnapshots(projectId);
    persistNamedSnapshots(projectId, existing.filter((s) => s.id !== snapId));
  },

  markClean: () => set({ isDirty: false }),
  markDirty: () => set({ isDirty: true }),
  clearDeletedNodeIds: (ids) => set((state) => ({ deletedNodeIds: state.deletedNodeIds.filter((x) => !ids.includes(x)) })),
  resetCanvas: () =>
    set({ nodes: [], edges: [], selectedNodeIds: [], collaborators: new Map(), isDirty: false, deletedNodeIds: [], past: [], future: [] }),

  undo: () => {
    const { past, nodes, edges, future } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [{ nodes, edges }, ...future].slice(0, MAX_HISTORY),
      nodes: prev.nodes,
      edges: prev.edges,
      isDirty: true,
    });
  },

  redo: () => {
    const { past, nodes, edges, future } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      past: [...past, { nodes, edges }].slice(-MAX_HISTORY),
      future: future.slice(1),
      nodes: next.nodes,
      edges: next.edges,
      isDirty: true,
    });
  },
}));

function getDefaultPayload(type: NodeType): NodeData {
  switch (type) {
    case "script":
      return { content: "" };
    case "storyboard":
      return { description: "", promptText: "" };
    case "prompt":
      return { positivePrompt: "", negativePrompt: "" };
    case "image_gen":
      return { prompt: "", style: "", aspectRatio: "16:9" };
    case "asset":
      return { name: "素材", type: "image", url: "" };
    case "video_task":
      return {
        provider: "poyo_seedance",
        status: "pending",
        prompt: "",
      };
    case "ai_chat":
      return { systemPrompt: "", messages: [] };
    case "note":
      return { content: "" };
    case "audio":
      return { audioCategory: "music" };
    case "character":
      return { characterKind: "person" };
    case "clip":
      return { speed: 1.0, audioVolume: 1.0, status: "idle" };
    case "post_process":
      return { selectedEffects: [], effectIntensities: {}, generatedPrompt: "" };
    case "merge":
      return { transition: "none", transitionDuration: 0.5, bgMusicVolume: 0.3, status: "idle" };
    case "subtitle":
      return { entries: [], fontSize: 22, fontColor: "white", burnInEnabled: false, status: "idle" };
    case "overlay":
      return { mode: "watermark", status: "idle" };
    case "subtitle_motion":
      return { entries: [], motionStyle: "fade", fontSize: 28, fontColor: "white", status: "idle" };
    case "smart_cut":
      return { aggressiveness: "medium", status: "idle" };
    case "pose_control":
      return { prompt: "", guidanceScale: 3.5, status: "idle" };
    case "voice_clone":
      return { text: "", status: "idle" };
    case "lip_sync":
      return { status: "idle" };
    case "avatar":
      return { script: "", status: "idle" };
    case "group":
      return { label: "分组" };
    case "comfyui_image":
      return { workflowTemplate: "txt2img", prompt: "", ckpt: "", steps: 20, cfg: 7, seed: -1, width: 512, height: 512, status: "idle" };
    case "comfyui_video":
      return { workflowTemplate: "animatediff", prompt: "", ckpt: "", steps: 20, cfg: 7, seed: -1, frames: 16, fps: 8, status: "idle" };
    case "agent":
      return { messages: [], status: "idle" };
    default:
      return {} as NodeData;
  }
}
