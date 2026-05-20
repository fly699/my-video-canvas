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

interface CanvasStore {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeIds: string[];
  collaborators: Map<number, CollaboratorCursor>;
  projectId: number | null;
  isDirty: boolean;

  // Actions
  setProjectId: (id: number) => void;
  setNodes: (nodes: CanvasNode[]) => void;
  setEdges: (edges: CanvasEdge[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => CanvasNode;
  updateNodeData: (id: string, payload: Partial<NodeData>) => void;
  updateNodeTitle: (id: string, title: string) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setCollaborator: (cursor: CollaboratorCursor) => void;
  removeCollaborator: (userId: number) => void;
  markClean: () => void;
  markDirty: () => void;
  resetCanvas: () => void;
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeIds: [],
  collaborators: new Map(),
  projectId: null,
  isDirty: false,

  setProjectId: (id) => set({ projectId: id }),

  setNodes: (nodes) => set({ nodes }),

  setEdges: (edges) => set({ edges }),

  onNodesChange: (changes) => {
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes) as CanvasNode[],
      isDirty: true,
    }));
  },

  onEdgesChange: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges) as CanvasEdge[],
      isDirty: true,
    }));
  },

  onConnect: (connection) => {
    set((state) => ({
      edges: addEdge(
        {
          ...connection,
          id: nanoid(),
          style: { stroke: "oklch(0.45 0.05 260)", strokeWidth: 2 },
          animated: false,
        },
        state.edges
      ) as CanvasEdge[],
      isDirty: true,
    }));
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
        height: config.defaultHeight,
      },
    };

    set((state) => ({
      nodes: [...state.nodes, newNode],
      isDirty: true,
    }));

    return newNode;
  },

  updateNodeData: (id, payload) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, payload: { ...n.data.payload, ...payload } } }
          : n
      ),
      isDirty: true,
    }));
  },

  updateNodeTitle: (id, title) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, title } } : n
      ),
      isDirty: true,
    }));
  },

  deleteNode: (id) => {
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
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
  resetCanvas: () => set({ nodes: [], edges: [], selectedNodeIds: [], collaborators: new Map(), isDirty: false }),
}));

function getDefaultPayload(type: NodeType): NodeData {
  switch (type) {
    case "script":
      return { content: "" };
    case "storyboard":
      return { description: "", promptText: "" };
    case "prompt":
      return { positivePrompt: "", negativePrompt: "" };
    case "asset":
      return { name: "素材", type: "image", url: "" };
    case "video_task":
      return {
        provider: "mock",
        status: "pending",
        prompt: "",
      };
    case "ai_chat":
      return { systemPrompt: "", messages: [] };
    case "note":
      return { content: "" };
    default:
      return {} as NodeData;
  }
}
