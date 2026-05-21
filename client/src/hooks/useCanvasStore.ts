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

const MAX_HISTORY = 50;

interface CanvasStore {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeIds: string[];
  collaborators: Map<number, CollaboratorCursor>;
  projectId: number | null;
  isDirty: boolean;

  // Undo/redo history
  past: HistorySnapshot[];
  future: HistorySnapshot[];

  // Actions
  setProjectId: (id: number) => void;
  setNodes: (nodes: CanvasNode[]) => void;
  setEdges: (edges: CanvasEdge[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => CanvasNode;
  batchAddSceneNodes: (
    scenes: Array<{ description?: string; promptText?: string; cameraMovement?: string; duration?: number }>,
    sourceNodeId: string,
    sourcePosition: { x: number; y: number }
  ) => void;
  updateNodeData: (id: string, payload: Partial<NodeData>) => void;
  batchUpdateNodeData: (updates: { id: string; payload: Partial<NodeData> }[]) => void;
  updateNodeTitle: (id: string, title: string) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  updateEdgeLabel: (id: string, label: string) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setCollaborator: (cursor: CollaboratorCursor) => void;
  removeCollaborator: (userId: number) => void;
  markClean: () => void;
  markDirty: () => void;
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
  isDirty: false,
  past: [],
  future: [],

  setProjectId: (id) => set({ projectId: id }),

  // setNodes / setEdges are used for initial load — don't push to history
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  onNodesChange: (changes) => {
    // Only push history for structural changes (add/remove), not position drags
    const isStructural = changes.some(
      (c) => c.type === "add" || c.type === "remove"
    );
    set((state) => ({
      ...(isStructural ? pushHistory(state) : {}),
      nodes: applyNodeChanges(changes, state.nodes) as CanvasNode[],
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
        if (
          sourceNode?.data.nodeType === "image_gen" &&
          targetNode?.data.nodeType === "video_task" &&
          connection.sourceHandle === "image-out" &&
          connection.targetHandle === "ref-image-in"
        ) {
          const imageUrl = (sourceNode.data.payload as { imageUrl?: string }).imageUrl;
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
        ...pushHistory(state),
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
    const projectId = get().projectId ?? 0;

    const newNode: CanvasNode = {
      id,
      type: "custom",
      position,
      data: {
        nodeType: type,
        title: config.defaultTitle,
        payload: getDefaultPayload(type),
        projectId,
      },
      style: {
        width: config.defaultWidth,
        // height is intentionally omitted — let content drive the node height
      },
    };

    set((state) => ({
      ...pushHistory(state),
      nodes: [...state.nodes, newNode],
      isDirty: true,
    }));

    return newNode;
  },

  batchAddSceneNodes: (scenes, sourceNodeId, sourcePosition) => {
    set((state) => {
      const projectId = state.nodes.find((n) => n.id === sourceNodeId)?.data.projectId ?? 0;
      const config = getNodeConfig("storyboard");
      const nodeWidth = (config.defaultWidth as number) ?? 360;
      const newNodes: CanvasNode[] = scenes.map((scene, i) => ({
        id: nanoid(),
        type: "custom" as const,
        position: { x: sourcePosition.x + i * (nodeWidth + 40), y: sourcePosition.y + 500 },
        data: {
          nodeType: "storyboard" as const,
          title: config.defaultTitle,
          payload: {
            description: scene.description ?? "",
            promptText: scene.promptText ?? "",
            cameraMovement: scene.cameraMovement,
            duration: scene.duration,
          },
          projectId,
        },
        style: { width: nodeWidth },
      }));
      const newEdges: CanvasEdge[] = newNodes.map((node) => ({
        id: nanoid(),
        source: sourceNodeId,
        target: node.id,
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

  updateNodeData: (id, payload) => {
    set((state) => ({
      ...pushHistory(state),
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

  updateNodeTitle: (id, title) => {
    set((state) => ({
      ...pushHistory(state),
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, title } } : n
      ),
      isDirty: true,
    }));
  },

  deleteNode: (id) => {
    set((state) => ({
      ...pushHistory(state),
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
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
    const newNode: CanvasNode = {
      ...node,
      id: newId,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      data: { ...node.data },
      selected: false,
    };
    set((state) => ({
      ...pushHistory(state),
      nodes: [...state.nodes, newNode],
      isDirty: true,
    }));
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

  markClean: () => set({ isDirty: false }),
  markDirty: () => set({ isDirty: true }),
  resetCanvas: () =>
    set({ nodes: [], edges: [], selectedNodeIds: [], collaborators: new Map(), isDirty: false, past: [], future: [] }),

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
    default:
      return {} as NodeData;
  }
}
