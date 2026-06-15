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
import type { NodeType, NodeData, CollaboratorCursor, GroupNodeData } from "../../../shared/types";
import { resolveActiveNodeModel } from "../contexts/NodeDefaultModelsContext";
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

/** Map an aspect ratio ("16:9" / "9:16" / "1:1" …) to /64-aligned ComfyUI latent
 *  dimensions with the short edge ≈ 512 (SD1.5-safe, SDXL-ok). Returns {} when the
 *  ratio can't be parsed, so callers can spread it safely. */
function aspectToComfyWH(aspect?: string): { width?: number; height?: number } {
  const m = /^(\d+):(\d+)$/.exec((aspect ?? "").trim());
  if (!m) return {};
  const rw = Number(m[1]), rh = Number(m[2]);
  if (!(rw > 0) || !(rh > 0)) return {};
  const r64 = (n: number) => Math.max(64, Math.round(n / 64) * 64);
  return rw >= rh
    ? { width: r64(512 * rw / rh), height: 512 }
    : { width: 512, height: r64(512 * rh / rw) };
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
  runRequest: { startNodeId: string | null; onlyIds?: string[]; token: number } | null;
  requestRun: (startNodeId: string | null, onlyIds?: string[]) => void;
  /** 瞬时跨节点 UI 信号：请求某节点打开内嵌面板（如智能体引导卡「打开镜头表」）。 */
  panelRequest: { nodeId: string; panel: string; token: number } | null;
  requestPanel: (nodeId: string, panel: string) => void;
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
    scenes: Array<{ description?: string; promptText?: string; negativePrompt?: string; cameraMovement?: string; duration?: number; lens?: string; colorGrade?: string; shotType?: string; lighting?: string; dialogue?: string; sfx?: string; transition?: string; beatRef?: string }>,
    sourceNodeId: string,
    sourcePosition: { x: number; y: number },
    targetType?: "storyboard" | "comfyui_image",
    aspectRatio?: string
  ) => void;
  // payload allows an extra `pinned?: boolean` field — a transient UI flag stored
  // on every node payload (no DB schema change) controlling whether the node's
  // input panel stays expanded regardless of `selected`. Toggled from the
  // right-click context menu.
  updateNodeData: (id: string, payload: Partial<NodeData> & { pinned?: boolean }, silent?: boolean) => void;
  batchUpdateNodeData: (updates: { id: string; payload: Partial<NodeData> }[]) => void;
  /** Batch-move many nodes in one history step (used by the agent's auto-layout). */
  batchUpdateNodePositions: (updates: { id: string; position: { x: number; y: number } }[]) => void;
  /** 静默批量移动（不入历史），用于群组容器拖动时让成员实时跟随；与普通拖动一致（拖动不入历史）。 */
  setNodePositionsSilent: (updates: { id: string; position: { x: number; y: number } }[]) => void;
  /** 把选中的多个节点用一个 `group` 容器框住（记录 childIds），返回新建的 group 节点 id；不足 2 个返回 null。 */
  groupSelected: (childIds: string[], title?: string) => string | null;
  /** 解组：仅删除 group 容器节点，成员保留。 */
  ungroup: (groupId: string) => void;
  /** 把某节点归入指定群组（同时从其它群组移除）；groupId 为 null 表示从所有群组移除。静默不入历史（拖动结束时调用）。 */
  assignNodeToGroup: (nodeId: string, groupId: string | null) => void;
  /** 删除群组容器及其全部成员节点（含相关边），返回被删除的所有节点 id（含容器，供服务端删除/协作广播）。 */
  deleteGroupWithMembers: (groupId: string) => string[];
  /** 重新计算群组容器边界以包裹其当前成员（一键自适应）。 */
  fitGroupToMembers: (groupId: string) => void;
  /** 折叠/展开群组：折叠时把容器高度缩成标题小条并记下原高度，展开时恢复。 */
  toggleGroupCollapsed: (groupId: string) => void;
  /** 整体复制群组：连同成员节点 + 成员间内部连线一起克隆（新 id、整体偏移），返回新群组 id。 */
  duplicateGroup: (groupId: string) => string | null;
  /** Run `fn` as a single undoable batch: snapshot history once up-front and
   *  suppress per-action history pushes during `fn` (used when the agent applies
   *  a multi-step plan so one Ctrl+Z reverts the whole batch). */
  runBatch: (fn: () => void) => void;
  /** internal: when true, mutating actions skip their own pushHistory. */
  _suppressHistory: boolean;
  updateNodeTitle: (id: string, title: string) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  /** 复制一组节点为子图：克隆这些节点 + 它们之间的内部连线（跨边界的连线丢弃），
   *  偏移落位并选中克隆体，返回新节点 id 列表。用于「框选 → Ctrl+C/Ctrl+V 复制镜头链」。 */
  cloneSubgraph: (ids: string[], offset?: { x: number; y: number }) => string[];
  /** 一键整理：按连线方向把自由节点（不在任何群组里的）做从左到右的分层布局，
   *  锚定在原包围盒左上角、保留层内大致上下顺序。返回被重排的节点数。 */
  autoLayout: () => number;
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
  requestRun: (startNodeId, onlyIds) => set((s) => ({ runRequest: { startNodeId, onlyIds, token: (s.runRequest?.token ?? 0) + 1 } })),
  panelRequest: null,
  requestPanel: (nodeId, panel) => set((s) => ({ panelRequest: { nodeId, panel, token: (s.panelRequest?.token ?? 0) + 1 } })),

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
      // 防重复连线：本画布中同一对节点之间只需要一条连线（多源汇入用「来自不同源的多条边」，
      // 从不需要同一对节点多条）。ReactFlow 的 addEdge 只按「源+目标+两端句柄」去重，落点没
      // 精确命中句柄时 targetHandle 不同会绕过去重，产生重叠的重复边（表现为「连一根线却出现
      // 多个序号、实际多条线」）。这里按「源+目标」彻底去重。
      if (connection.source && connection.target &&
          state.edges.some((e) => e.source === connection.source && e.target === connection.target)) {
        return {};
      }
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
        // Content-driven nodes omit height (content sizes them). Fixed-height
        // nodes (config.defaultHeight, e.g. the agent) MUST carry an explicit
        // height — otherwise auto-save stores 0 and they reload at 0px (invisible).
        ...(config.defaultHeight !== undefined ? { height: config.defaultHeight } : {}),
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

  batchAddSceneNodes: (scenes, sourceNodeId, sourcePosition, targetType = "storyboard", aspectRatio) => {
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
                // 画面比例 → ComfyUI 生成尺寸（/64 对齐，短边≈512）。否则 ComfyUI 图像默认
                // 512×512（1:1），无视项目比例。仅在能解析比例时设。
                ...aspectToComfyWH(aspectRatio),
              },
              projectId,
            }
          : {
              nodeType: "storyboard" as const,
              title: `分镜 #${i + 1}`,
              payload: {
                sceneNumber: i + 1,
                description: scene.description ?? "",
                promptText: scene.promptText ?? "",
                negativePrompt: scene.negativePrompt || undefined,
                cameraMovement: scene.cameraMovement,
                duration: scene.duration,
                lens: scene.lens || undefined,
                colorTone: scene.colorGrade || undefined,
                // 行业 Shot List 字段（镜头表）：景别/灯光/对白/音效/转场/拍点
                shotType: scene.shotType || undefined,
                lighting: scene.lighting || undefined,
                dialogue: scene.dialogue || undefined,
                sfx: scene.sfx || undefined,
                transition: scene.transition || undefined,
                beatRef: scene.beatRef || undefined,
                createdBy: sceneUid,
                // 画面比例透传：分镜生图按模型族读不同字段（kie→aspectRatio /
                // Poyo→poyoAspectRatio / V2·HF→reveAspectRatio），三者都写。
                ...(aspectRatio ? { aspectRatio, poyoAspectRatio: aspectRatio, reveAspectRatio: aspectRatio } : {}),
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

  setNodePositionsSilent: (updates) => {
    if (updates.length === 0) return;
    const posMap = new Map(updates.map((u) => [u.id, u.position]));
    set((state) => ({
      nodes: state.nodes.map((n) => (posMap.has(n.id) ? { ...n, position: posMap.get(n.id)! } : n)),
      isDirty: true,
    }));
  },

  groupSelected: (childIds, title) => {
    const projectId = get().projectId;
    if (!projectId) return null;
    const members = get().nodes.filter((n) => childIds.includes(n.id) && n.data.nodeType !== "group");
    if (members.length < 2) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of members) {
      const cfg = getNodeConfig(n.data.nodeType);
      const w = (typeof n.style?.width === "number" ? n.style.width : cfg.defaultWidth) || 280;
      const h = (typeof n.style?.height === "number" ? n.style.height : (cfg.defaultHeight ?? 200)) || 200;
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + w);
      maxY = Math.max(maxY, n.position.y + h);
    }
    const PAD = 36, HEADER = 44;
    const rect = { x: minX - PAD, y: minY - PAD - HEADER, width: (maxX - minX) + PAD * 2, height: (maxY - minY) + PAD * 2 + HEADER };
    const uid = get().currentUserId;
    const id = nanoid();
    const node: CanvasNode = {
      id,
      type: "custom",
      position: { x: rect.x, y: rect.y },
      zIndex: -1,
      data: {
        nodeType: "group",
        title: title ?? "群组",
        payload: { ...getDefaultPayload("group"), childIds: members.map((m) => m.id), ...(uid != null ? { createdBy: uid } : {}) } as NodeData,
        projectId,
      },
      style: { width: rect.width, height: rect.height },
    };
    set((state) => ({
      ...(get()._suppressHistory ? {} : pushHistory(state)),
      nodes: [...state.nodes, node],
      isDirty: true,
    }));
    return id;
  },

  ungroup: (groupId) => {
    set((state) => ({
      ...(get()._suppressHistory ? {} : pushHistory(state)),
      nodes: state.nodes.filter((n) => n.id !== groupId),
      deletedNodeIds: [...state.deletedNodeIds, groupId],
      isDirty: true,
    }));
  },

  assignNodeToGroup: (nodeId, groupId) => {
    // 仅当归属确有变化时才写入，避免每次拖动结束都触发无谓的 set。
    const cur = get().nodes;
    const ownerNow = cur.find((n) => n.data.nodeType === "group" && ((n.data.payload as GroupNodeData).childIds ?? []).includes(nodeId));
    if ((ownerNow?.id ?? null) === groupId) return;
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.data.nodeType !== "group") return n;
        const gp = n.data.payload as GroupNodeData;
        const childIds = gp.childIds ?? [];
        const has = childIds.includes(nodeId);
        if (n.id === groupId) {
          if (has) return n;
          return { ...n, data: { ...n.data, payload: { ...gp, childIds: [...childIds, nodeId] } } };
        }
        if (!has) return n;
        return { ...n, data: { ...n.data, payload: { ...gp, childIds: childIds.filter((c) => c !== nodeId) } } };
      }),
      isDirty: true,
    }));
  },

  deleteGroupWithMembers: (groupId) => {
    const grp = get().nodes.find((n) => n.id === groupId && n.data.nodeType === "group");
    if (!grp) return [];
    const childIds = (grp.data.payload as GroupNodeData).childIds ?? [];
    const removeIds = [groupId, ...childIds];
    const removeSet = new Set<string>(removeIds);
    set((state) => ({
      ...(get()._suppressHistory ? {} : pushHistory(state)),
      nodes: state.nodes.filter((n) => !removeSet.has(n.id)),
      edges: state.edges.filter((e) => !removeSet.has(e.source) && !removeSet.has(e.target)),
      deletedNodeIds: [...state.deletedNodeIds, ...removeIds],
      isDirty: true,
    }));
    return removeIds;
  },

  fitGroupToMembers: (groupId) => {
    const all = get().nodes;
    const grp = all.find((n) => n.id === groupId && n.data.nodeType === "group");
    if (!grp) return;
    const childIds = (grp.data.payload as GroupNodeData).childIds ?? [];
    const members = all.filter((n) => childIds.includes(n.id) && n.data.nodeType !== "group");
    if (members.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of members) {
      const cfg = getNodeConfig(n.data.nodeType);
      const w = (typeof n.style?.width === "number" ? n.style.width : cfg.defaultWidth) || 280;
      const h = (typeof n.style?.height === "number" ? n.style.height : (cfg.defaultHeight ?? 200)) || 200;
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + w);
      maxY = Math.max(maxY, n.position.y + h);
    }
    const PAD = 36, HEADER = 44;
    const rect = { x: minX - PAD, y: minY - PAD - HEADER, width: (maxX - minX) + PAD * 2, height: (maxY - minY) + PAD * 2 + HEADER };
    set((state) => ({
      ...(get()._suppressHistory ? {} : pushHistory(state)),
      nodes: state.nodes.map((n) => (n.id === groupId
        ? { ...n, position: { x: rect.x, y: rect.y }, style: { ...n.style, width: rect.width, height: rect.height } }
        : n)),
      isDirty: true,
    }));
  },

  toggleGroupCollapsed: (groupId) => {
    const COLLAPSED_H = 46; // 折叠后只剩标题栏的小条高度
    set((state) => ({
      ...(get()._suppressHistory ? {} : pushHistory(state)),
      nodes: state.nodes.map((n) => {
        if (n.id !== groupId || n.data.nodeType !== "group") return n;
        const gp = n.data.payload as GroupNodeData;
        const collapsing = !(gp.collapsed ?? false);
        const curH = typeof n.style?.height === "number" ? n.style.height : 200;
        if (collapsing) {
          return { ...n, style: { ...n.style, height: COLLAPSED_H }, data: { ...n.data, payload: { ...gp, collapsed: true, expandedHeight: curH } } };
        }
        const restore = gp.expandedHeight ?? 200;
        return { ...n, style: { ...n.style, height: restore }, data: { ...n.data, payload: { ...gp, collapsed: false } } };
      }),
      isDirty: true,
    }));
  },

  duplicateGroup: (groupId) => {
    const all = get().nodes;
    const grp = all.find((n) => n.id === groupId && n.data.nodeType === "group");
    if (!grp) return null;
    const childIds = (grp.data.payload as GroupNodeData).childIds ?? [];
    const members = all.filter((n) => childIds.includes(n.id));
    const OFFSET = 48;
    const uid = get().currentUserId;
    // 旧 id → 新 id 映射（含容器与成员），用于重映射 childIds 与内部连线。
    const idMap = new Map<string, string>();
    const newGroupId = nanoid();
    idMap.set(groupId, newGroupId);
    for (const m of members) idMap.set(m.id, nanoid());
    // 克隆成员：剥离运行态/产物字段（与单节点复制一致），整体偏移。
    const memberClones: CanvasNode[] = members.map((m) => {
      const p = JSON.parse(JSON.stringify(m.data.payload)) as Record<string, unknown>;
      for (const k of CLONE_RUNTIME_FIELDS) delete p[k];
      if (uid != null) p.createdBy = uid;
      return {
        ...m,
        id: idMap.get(m.id)!,
        position: { x: m.position.x + OFFSET, y: m.position.y + OFFSET },
        selected: false,
        data: { ...m.data, payload: p as typeof m.data.payload },
      };
    });
    const newGp: GroupNodeData = { ...(grp.data.payload as GroupNodeData), childIds: members.map((m) => idMap.get(m.id)!) };
    const groupClone: CanvasNode = {
      ...grp,
      id: newGroupId,
      position: { x: grp.position.x + OFFSET, y: grp.position.y + OFFSET },
      selected: true,
      data: { ...grp.data, payload: newGp as NodeData },
    };
    // 克隆成员间的内部连线（两端都在成员集合内），保留工作流结构。
    const memberIdSet = new Set(members.map((m) => m.id));
    const internalEdges: CanvasEdge[] = get().edges
      .filter((e) => memberIdSet.has(e.source) && memberIdSet.has(e.target))
      .map((e) => ({ ...e, id: nanoid(), source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
    set((state) => ({
      ...(get()._suppressHistory ? {} : pushHistory(state)),
      nodes: [...state.nodes.map((n) => ({ ...n, selected: false })), groupClone, ...memberClones],
      edges: [...state.edges, ...internalEdges],
      isDirty: true,
    }));
    return newGroupId;
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

  cloneSubgraph: (ids, offset = { x: 60, y: 60 }) => {
    const state0 = get();
    const idSet = new Set(ids);
    const sources = state0.nodes.filter((n) => idSet.has(n.id));
    if (sources.length === 0) return [];
    const dupUid = state0.currentUserId;
    const idMap = new Map<string, string>();
    // 1) 克隆节点（新 id、洗掉运行态字段、作者归当前用户、偏移落位、选中）
    const newNodes: CanvasNode[] = sources.map((node) => {
      const newId = nanoid();
      idMap.set(node.id, newId);
      const p = JSON.parse(JSON.stringify(node.data.payload)) as Record<string, unknown>;
      for (const k of CLONE_RUNTIME_FIELDS) delete p[k];
      if (dupUid != null) p.createdBy = dupUid;
      return {
        ...node, id: newId,
        position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
        data: { ...node.data, payload: p as typeof node.data.payload },
        selected: true,
      };
    });
    // 2) group 容器的 childIds 重映射到一并复制的新成员（未复制的成员丢弃引用）
    for (const nn of newNodes) {
      if (nn.data.nodeType === "group") {
        const gp = nn.data.payload as GroupNodeData;
        const childIds = (gp.childIds ?? []).map((c) => idMap.get(c)).filter((c): c is string => !!c);
        nn.data = { ...nn.data, payload: { ...gp, childIds } as typeof nn.data.payload };
      }
    }
    // 3) 仅重建「两端都在复制集内」的内部连线（跨边界的连线丢弃，得到自洽子图）
    const newEdges: CanvasEdge[] = [];
    for (const e of state0.edges) {
      if (idSet.has(e.source) && idSet.has(e.target)) {
        newEdges.push({ ...e, id: nanoid(), source: idMap.get(e.source)!, target: idMap.get(e.target)! });
      }
    }
    set((s) => ({
      ...(get()._suppressHistory ? {} : pushHistory(s)),
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...newNodes],
      edges: [...s.edges, ...newEdges],
      isDirty: true,
    }));
    return newNodes.map((n) => n.id);
  },

  autoLayout: () => {
    const { nodes, edges } = get();
    // 跳过群组容器与「群组成员」——挪动成员会破坏群组框选，只排自由节点。
    const grouped = new Set<string>();
    for (const n of nodes) if (n.data.nodeType === "group") for (const c of (n.data.payload as GroupNodeData).childIds ?? []) grouped.add(c);
    const free = nodes.filter((n) => n.data.nodeType !== "group" && !grouped.has(n.id));
    if (free.length < 2) return 0;
    const idSet = new Set(free.map((n) => n.id));
    const preds = new Map<string, string[]>();
    for (const n of free) preds.set(n.id, []);
    for (const e of edges) if (idSet.has(e.source) && idSet.has(e.target)) preds.get(e.target)!.push(e.source);
    // 最长路径分层：layer = max(前驱 layer)+1，无前驱=0（含环保护）。
    const layer = new Map<string, number>();
    const visiting = new Set<string>();
    const calc = (id: string): number => {
      const cached = layer.get(id);
      if (cached != null) return cached;
      if (visiting.has(id)) return 0;
      visiting.add(id);
      const ps = preds.get(id) ?? [];
      const l = ps.length === 0 ? 0 : Math.max(...ps.map(calc)) + 1;
      visiting.delete(id);
      layer.set(id, l);
      return l;
    };
    for (const n of free) calc(n.id);
    const minX = Math.min(...free.map((n) => n.position.x));
    const minY = Math.min(...free.map((n) => n.position.y));
    const COL = 360, ROW = 220;
    const byLayer = new Map<number, CanvasNode[]>();
    for (const n of free) {
      const l = layer.get(n.id) ?? 0;
      const arr = byLayer.get(l) ?? [];
      arr.push(n); byLayer.set(l, arr);
    }
    const pos = new Map<string, { x: number; y: number }>();
    byLayer.forEach((group, l) => {
      group.sort((a, b) => a.position.y - b.position.y); // 保留层内大致上下顺序，减少交叉
      group.forEach((n, i) => pos.set(n.id, { x: minX + l * COL, y: minY + i * ROW }));
    });
    set((s) => ({
      ...pushHistory(s),
      nodes: s.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)),
      isDirty: true,
    }));
    return free.length;
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
        // 非 ComfyUI 视频默认：项目级配置 > 出厂（kie Grok Imagine 图生 i2v）。
        provider: resolveActiveNodeModel("video_task", "video"),
        status: "pending",
        prompt: "",
      } as NodeData;
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
