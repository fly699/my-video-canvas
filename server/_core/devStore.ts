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
  ProjectCollaborator,
  ProjectShareLink,
  InsertProject,
  InsertCanvasNode,
  InsertCanvasEdge,
  InsertAsset,
  InsertVideoTask,
  InsertChatMessage,
  InsertProjectCollaborator,
  InsertProjectShareLink,
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
const collaboratorsMap = new Map<number, ProjectCollaborator>();
const shareLinksMap = new Map<number, ProjectShareLink>();

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
    publicReadAccess: data.publicReadAccess ?? false,
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

// ── Project Collaborators ─────────────────────────────────────────────────────
export function devGetProjectByIdRaw(id: number): Project | undefined {
  return projectsMap.get(id);
}

export function devSetProjectPublicAccess(id: number, publicReadAccess: boolean) {
  const p = projectsMap.get(id);
  if (!p) return;
  projectsMap.set(id, { ...p, publicReadAccess, updatedAt: now() });
}

export function devListCollaborators(projectId: number): ProjectCollaborator[] {
  return Array.from(collaboratorsMap.values())
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function devFindCollaborator(projectId: number, userId: number): ProjectCollaborator | undefined {
  return Array.from(collaboratorsMap.values()).find(
    (c) => c.projectId === projectId && c.userId === userId && c.status === "active",
  );
}

export function devFindCollaboratorByEmail(projectId: number, email: string): ProjectCollaborator | undefined {
  return Array.from(collaboratorsMap.values()).find(
    (c) => c.projectId === projectId && c.email?.toLowerCase() === email.toLowerCase(),
  );
}

export function devUpsertCollaborator(data: InsertProjectCollaborator): ProjectCollaborator {
  // Update existing match on (projectId, userId) or (projectId, email)
  const existing = Array.from(collaboratorsMap.values()).find((c) =>
    c.projectId === data.projectId &&
    ((data.userId != null && c.userId === data.userId) ||
     (data.email != null && c.email?.toLowerCase() === data.email.toLowerCase())),
  );
  if (existing) {
    const updated: ProjectCollaborator = {
      ...existing,
      role: data.role,
      userId: data.userId ?? existing.userId,
      email: data.email ?? existing.email,
      status: data.status ?? existing.status,
      invitedBy: data.invitedBy,
      updatedAt: now(),
    };
    collaboratorsMap.set(existing.id, updated);
    return updated;
  }
  const id = newId();
  const created: ProjectCollaborator = {
    id,
    projectId: data.projectId,
    userId: data.userId ?? null,
    email: data.email ?? null,
    role: data.role,
    invitedBy: data.invitedBy,
    status: data.status ?? "active",
    createdAt: now(),
    updatedAt: now(),
  };
  collaboratorsMap.set(id, created);
  return created;
}

export function devUpdateCollaboratorRole(id: number, role: "viewer" | "editor" | "admin") {
  const c = collaboratorsMap.get(id);
  if (!c) return;
  collaboratorsMap.set(id, { ...c, role, updatedAt: now() });
}

export function devRemoveCollaborator(id: number) {
  collaboratorsMap.delete(id);
}

export function devClaimPendingCollaboratorsByEmail(email: string, userId: number) {
  Array.from(collaboratorsMap.values()).forEach((c) => {
    if (c.email?.toLowerCase() === email.toLowerCase() && c.userId == null) {
      collaboratorsMap.set(c.id, { ...c, userId, status: "active", updatedAt: now() });
    }
  });
}

export function devGetProjectsByCollaborator(userId: number): Project[] {
  const ids = new Set(
    Array.from(collaboratorsMap.values())
      .filter((c) => c.userId === userId && c.status === "active")
      .map((c) => c.projectId),
  );
  return Array.from(projectsMap.values())
    .filter((p) => ids.has(p.id) && p.userId !== userId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

// ── Project Share Links ───────────────────────────────────────────────────────
export function devCreateShareLink(data: InsertProjectShareLink): ProjectShareLink {
  const id = newId();
  const link: ProjectShareLink = {
    id,
    token: data.token,
    projectId: data.projectId,
    role: data.role,
    maxUses: data.maxUses ?? 1,
    usesCount: data.usesCount ?? 0,
    expiresAt: data.expiresAt,
    createdBy: data.createdBy,
    revokedAt: data.revokedAt ?? null,
    createdAt: now(),
  };
  shareLinksMap.set(id, link);
  return link;
}

export function devListShareLinks(projectId: number): ProjectShareLink[] {
  return Array.from(shareLinksMap.values())
    .filter((l) => l.projectId === projectId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function devGetShareLinkByToken(token: string): ProjectShareLink | undefined {
  return Array.from(shareLinksMap.values()).find((l) => l.token === token);
}

export function devIncrementShareLinkUses(id: number) {
  const l = shareLinksMap.get(id);
  if (!l) return;
  shareLinksMap.set(id, { ...l, usesCount: l.usesCount + 1 });
}

export function devRevokeShareLink(id: number) {
  const l = shareLinksMap.get(id);
  if (!l) return;
  shareLinksMap.set(id, { ...l, revokedAt: now() });
}
