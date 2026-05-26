/**
 * In-memory store used when DATABASE_URL is not configured (local dev/testing).
 * Only active when NODE_ENV=development AND DATABASE_URL is unset.
 */
import type {
  User,
  Project,
  CanvasNode,
  CanvasEdge,
  Asset,
  VideoTask,
  ChatMessage,
  InsertProject,
  InsertCanvasNode,
  InsertCanvasEdge,
  InsertAsset,
  InsertVideoTask,
  InsertChatMessage,
} from "../../drizzle/schema";

let nextId = 100;
const newId = () => nextId++;
const now = () => new Date();

// ── Storage maps ──────────────────────────────────────────────────────────────
const projectsMap = new Map<number, Project>();
const nodesMap = new Map<string, CanvasNode>();
const edgesMap = new Map<string, CanvasEdge>();
const assetsMap = new Map<number, Asset>();
const videoTasksMap = new Map<number, VideoTask>();
const chatMessagesArr: ChatMessage[] = [];

// ── Projects ──────────────────────────────────────────────────────────────────
export function devCreateProject(data: InsertProject): Project {
  const id = newId();
  const project: Project = {
    id,
    userId: data.userId!,
    name: data.name,
    description: data.description ?? null,
    thumbnail: data.thumbnail ?? null,
    viewportState: (data.viewportState as Project["viewportState"]) ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  projectsMap.set(id, project);
  return project;
}

export function devGetProjectsByUser(userId: number): Project[] {
  return Array.from(projectsMap.values())
    .filter((p) => p.userId === userId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function devGetProjectById(id: number, userId: number): Project | undefined {
  const p = projectsMap.get(id);
  return p && p.userId === userId ? p : undefined;
}

export function devUpdateProject(id: number, userId: number, data: Partial<InsertProject>) {
  const p = projectsMap.get(id);
  if (!p || p.userId !== userId) return;
  projectsMap.set(id, { ...p, ...data, id, userId, updatedAt: now() });
}

export function devDeleteProject(id: number, userId: number) {
  const p = projectsMap.get(id);
  if (p && p.userId === userId) projectsMap.delete(id);
}

// ── Canvas Nodes ──────────────────────────────────────────────────────────────
export function devGetNodesByProject(projectId: number): CanvasNode[] {
  return Array.from(nodesMap.values()).filter((n) => n.projectId === projectId);
}

export function devUpsertNode(data: InsertCanvasNode) {
  const existing = nodesMap.get(data.id!);
  nodesMap.set(data.id!, {
    id: data.id!,
    projectId: data.projectId!,
    type: data.type,
    title: data.title ?? null,
    data: (data.data as CanvasNode["data"]) ?? null,
    posX: data.posX ?? 0,
    posY: data.posY ?? 0,
    width: data.width ?? 320,
    height: data.height ?? 200,
    zIndex: data.zIndex ?? 0,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  });
}

export function devDeleteNode(id: string, projectId: number) {
  const n = nodesMap.get(id);
  if (n && n.projectId === projectId) nodesMap.delete(id);
}

// ── Canvas Edges ──────────────────────────────────────────────────────────────
export function devGetEdgesByProject(projectId: number): CanvasEdge[] {
  return Array.from(edgesMap.values()).filter((e) => e.projectId === projectId);
}

export function devUpsertEdge(data: InsertCanvasEdge) {
  edgesMap.set(data.id!, {
    id: data.id!,
    projectId: data.projectId!,
    sourceNodeId: data.sourceNodeId,
    targetNodeId: data.targetNodeId,
    sourcePort: data.sourcePort ?? "output",
    targetPort: data.targetPort ?? "input",
    label: data.label ?? null,
    createdAt: edgesMap.get(data.id!)?.createdAt ?? now(),
  });
}

export function devDeleteEdge(id: string, projectId: number) {
  const e = edgesMap.get(id);
  if (e && e.projectId === projectId) edgesMap.delete(id);
}

// ── Assets ────────────────────────────────────────────────────────────────────
export function devGetAssetsByUser(userId: number, projectId?: number): Asset[] {
  return Array.from(assetsMap.values())
    .filter((a) => a.userId === userId && (projectId === undefined || a.projectId === projectId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function devCreateAsset(data: InsertAsset): Asset {
  const id = newId();
  const asset: Asset = {
    id,
    userId: data.userId,
    projectId: data.projectId ?? null,
    name: data.name,
    type: data.type,
    mimeType: data.mimeType ?? null,
    size: data.size ?? null,
    storageKey: data.storageKey,
    url: data.url,
    thumbnailUrl: null,
    createdAt: now(),
  };
  assetsMap.set(id, asset);
  return asset;
}

export function devDeleteAsset(id: number, userId: number) {
  const a = assetsMap.get(id);
  if (a && a.userId === userId) assetsMap.delete(id);
}

// ── Video Tasks ───────────────────────────────────────────────────────────────
export function devCreateVideoTask(data: InsertVideoTask): VideoTask {
  const id = newId();
  const task: VideoTask = {
    id,
    userId: data.userId!,
    projectId: data.projectId!,
    nodeId: data.nodeId,
    provider: data.provider,
    externalTaskId: data.externalTaskId ?? null,
    status: data.status ?? "pending",
    prompt: data.prompt ?? null,
    negativePrompt: data.negativePrompt ?? null,
    referenceImageUrl: data.referenceImageUrl ?? null,
    resultVideoUrl: null,
    resultStorageKey: null,
    errorMessage: null,
    params: (data.params as VideoTask["params"]) ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  videoTasksMap.set(id, task);
  return task;
}

export function devGetVideoTask(id: number): VideoTask | undefined {
  return videoTasksMap.get(id);
}

export function devGetVideoTasksByProject(projectId: number): VideoTask[] {
  return Array.from(videoTasksMap.values())
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function devFindInFlightVideoTask(userId: number, projectId: number, nodeId: string): VideoTask | undefined {
  return Array.from(videoTasksMap.values())
    .filter((t) =>
      t.userId === userId &&
      t.projectId === projectId &&
      t.nodeId === nodeId &&
      (t.status === "pending" || t.status === "processing")
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

export function devUpdateVideoTask(id: number, data: Partial<InsertVideoTask>) {
  const t = videoTasksMap.get(id);
  if (!t) return;
  videoTasksMap.set(id, { ...t, ...data, id, updatedAt: now() } as VideoTask);
}

export function devDeleteVideoTask(id: number) {
  videoTasksMap.delete(id);
}

export function devGetPendingVideoTasks(): VideoTask[] {
  return Array.from(videoTasksMap.values()).filter(
    (t) => t.status === "pending" || t.status === "processing"
  );
}

export function devClaimVideoTaskForSubmit(id: number): boolean {
  const t = videoTasksMap.get(id);
  if (!t || t.status !== "pending") return false;
  videoTasksMap.set(id, { ...t, status: "processing", updatedAt: now() });
  return true;
}

// ── Chat Messages ─────────────────────────────────────────────────────────────
export function devGetChatMessages(nodeId: string, projectId: number): ChatMessage[] {
  return chatMessagesArr
    .filter((m) => m.nodeId === nodeId && m.projectId === projectId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function devAddChatMessage(data: InsertChatMessage): ChatMessage {
  const msg: ChatMessage = {
    id: newId(),
    nodeId: data.nodeId,
    projectId: data.projectId!,
    role: data.role,
    content: data.content,
    createdAt: now(),
  };
  chatMessagesArr.push(msg);
  return msg;
}

export function devClearChatMessages(nodeId: string, projectId: number) {
  const toRemove = chatMessagesArr
    .map((m, i) => (m.nodeId === nodeId && m.projectId === projectId ? i : -1))
    .filter((i) => i !== -1)
    .reverse();
  toRemove.forEach((i) => chatMessagesArr.splice(i, 1));
}

// ── User ──────────────────────────────────────────────────────────────────────
export function devGetUserByOpenId(_openId: string): User | undefined {
  return undefined;
}
