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
  LanChatRoomRow,
  LanChatMessageRow,
  InsertLanChatMessage,
  LanChatInviteRow,
  LanChatIpWhitelistRow,
  LanChatSettingsRow,
  InsertLanChatInvite,
  InsertLanChatIpWhitelist,
  ChatConversation,
  InsertChatConversation,
  ChatMember,
  ConversationMessage,
  InsertConversationMessage,
  ChatAttachment,
  InsertChatAttachment,
  ChatBan,
  InsertChatBan,
  ChatSettingsRow,
  DownloadGrant,
  EditSession,
  InsertEditSession,
  ComfyNodeTemplateRow,
  InsertComfyNodeTemplate,
  ComfyTemplateAnalysisRow,
  InsertComfyTemplateAnalysis,
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
    defaultModels: (data.defaultModels as Project["defaultModels"]) ?? null,
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

// Cover refresh: set thumbnail but keep updatedAt (mirrors setProjectThumbnail).
export function devSetProjectThumbnail(id: number, userId: number, thumbnail: string) {
  const p = projectsMap.get(id);
  if (!p || p.userId !== userId) return;
  projectsMap.set(id, { ...p, thumbnail });
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
  // Cascade-delete referencing edges (mirrors prod deleteNode — no orphan edges).
  Array.from(edgesMap.values())
    .filter((e) => e.projectId === projectId && (e.sourceNodeId === id || e.targetNodeId === id))
    .forEach((e) => edgesMap.delete(e.id));
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
export function devGetAssetsByUser(
  userId: number,
  filter: { projectId?: number; type?: string; source?: string; model?: string; q?: string } = {},
): Asset[] {
  return Array.from(assetsMap.values())
    .filter((a) => a.userId === userId && a.deletedAt == null
      && (filter.projectId === undefined || a.projectId === filter.projectId)
      && (!filter.type || a.type === filter.type)
      && (!filter.source || a.source === filter.source)
      && (!filter.model || a.model === filter.model)
      && (!filter.q || a.name.toLowerCase().includes(filter.q.toLowerCase())))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function devGetAssetsByProject(
  projectId: number,
  filter: { type?: string; source?: string; model?: string; q?: string } = {},
): Asset[] {
  return Array.from(assetsMap.values())
    .filter((a) => a.projectId === projectId && a.deletedAt == null
      && (!filter.type || a.type === filter.type)
      && (!filter.source || a.source === filter.source)
      && (!filter.model || a.model === filter.model)
      && (!filter.q || a.name.toLowerCase().includes(filter.q.toLowerCase())))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function devGetAllAssets(filter: {
  userId?: number; type?: string; source?: string; model?: string;
  projectId?: number; q?: string; includeDeleted?: boolean; limit?: number; offset?: number;
} = {}): Asset[] {
  const rows = Array.from(assetsMap.values())
    .filter((a) => (filter.includeDeleted || a.deletedAt == null)
      && (!filter.userId || a.userId === filter.userId)
      && (!filter.type || a.type === filter.type)
      && (!filter.source || a.source === filter.source)
      && (!filter.model || a.model === filter.model)
      && (filter.projectId === undefined || a.projectId === filter.projectId)
      && (!filter.q || a.name.includes(filter.q)))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const off = filter.offset ?? 0;
  return rows.slice(off, off + Math.min(filter.limit ?? 200, 500));
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
    source: data.source ?? "upload",
    provider: data.provider ?? null,
    model: data.model ?? null,
    nodeId: data.nodeId ?? null,
    deletedAt: null,
    createdAt: now(),
  };
  assetsMap.set(id, asset);
  return asset;
}

export function devDeleteAsset(id: number, userId: number) {
  const a = assetsMap.get(id);
  if (a && a.userId === userId) a.deletedAt = now(); // soft delete (keep row + file)
}

export function devDeleteAssetAdmin(ids: number[]) {
  for (const id of ids) {
    const a = assetsMap.get(id);
    if (a) a.deletedAt = now(); // admin soft delete (any user)
  }
}

export function devGetAssetStorageKeysByIds(ids: number[]): { id: number; storageKey: string | null }[] {
  return ids.map((id) => assetsMap.get(id)).filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => ({ id: a.id, storageKey: a.storageKey ?? null }));
}

export function devHardDeleteAssetsAdmin(ids: number[]) {
  for (const id of ids) assetsMap.delete(id); // admin hard delete (any user)
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
    // Mirrors the DB stored generated column (migration 0058): the in-flight natural
    // key, NULL once finished. Dev mode is single-process so the router's dedupe +
    // devFindInFlightVideoTask already guard duplicates; this just keeps the shape.
    inflightKey: (data.status ?? "pending") === "pending" || data.status === "processing" ? `${data.projectId}-${data.nodeId}` : null,
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

export function devFindInFlightVideoTask(projectId: number, nodeId: string): VideoTask | undefined {
  return Array.from(videoTasksMap.values())
    .filter((t) =>
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
    attachments: (data.attachments as ChatMessage["attachments"]) ?? null,
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

// ── 画布助手会话（dev 内存兜底，键 `${projectId}:${userId}`） ──
const canvasAgentSessionsMap = new Map<string, import("../../drizzle/schema").CanvasAgentTurn[]>();
export function devGetCanvasAgentSession(projectId: number, userId: number): import("../../drizzle/schema").CanvasAgentTurn[] {
  return canvasAgentSessionsMap.get(`${projectId}:${userId}`) ?? [];
}
export function devSetCanvasAgentSession(projectId: number, userId: number, turns: import("../../drizzle/schema").CanvasAgentTurn[]): void {
  canvasAgentSessionsMap.set(`${projectId}:${userId}`, turns);
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

export function devUpdateCollaboratorRole(id: number, projectId: number, role: "viewer" | "editor" | "admin"): boolean {
  const c = collaboratorsMap.get(id);
  if (!c || c.projectId !== projectId) return false; // projectId scope mirrors prod (IDOR guard)
  collaboratorsMap.set(id, { ...c, role, updatedAt: now() });
  return true;
}

export function devRemoveCollaborator(id: number, projectId: number): boolean {
  const c = collaboratorsMap.get(id);
  if (!c || c.projectId !== projectId) return false;
  collaboratorsMap.delete(id);
  return true;
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

export function devGetShareLinkById(id: number): ProjectShareLink | undefined {
  return shareLinksMap.get(id);
}

/** Atomic equivalent of the prod conditional UPDATE — single-thread so just check then increment. */
export function devConsumeShareLink(id: number): boolean {
  const l = shareLinksMap.get(id);
  if (!l) return false;
  if (l.revokedAt) return false;
  if (l.expiresAt.getTime() <= Date.now()) return false;
  if (l.usesCount >= l.maxUses) return false;
  shareLinksMap.set(id, { ...l, usesCount: l.usesCount + 1 });
  return true;
}

export function devRefundShareLink(id: number): boolean {
  const l = shareLinksMap.get(id);
  if (!l || l.usesCount <= 0) return false;
  shareLinksMap.set(id, { ...l, usesCount: l.usesCount - 1 });
  return true;
}

export function devRevokeShareLink(id: number, projectId: number): boolean {
  const l = shareLinksMap.get(id);
  if (!l || l.projectId !== projectId) return false; // projectId scope mirrors prod (IDOR guard)
  shareLinksMap.set(id, { ...l, revokedAt: now() });
  return true;
}

// ── LAN Chat (dev) ───────────────────────────────────────────────────────────
// Rooms scoped by networkGroupId — each unique clientIp gets its own
// auto-created "大厅" on first joinSession. No production seed needed
// in dev because devListLanChatRooms only returns same-network rooms.
const lanRoomsMap = new Map<number, LanChatRoomRow>();
const lanMessagesMap = new Map<number, LanChatMessageRow>();
let lanNextRoomId = 1;
let lanNextMessageId = 1;

export function devListLanChatRooms(networkGroupId: string): LanChatRoomRow[] {
  return Array.from(lanRoomsMap.values())
    .filter((r) => r.networkGroupId === networkGroupId)
    .sort((a, b) => a.id - b.id);
}

export function devCreateLanChatRoom(networkGroupId: string, name: string, passwordHash: string | null = null): LanChatRoomRow {
  const existing = Array.from(lanRoomsMap.values())
    .find((r) => r.networkGroupId === networkGroupId && r.name === name);
  if (existing) return existing;
  const row: LanChatRoomRow = { id: lanNextRoomId++, networkGroupId, name, passwordHash, createdAt: now() };
  lanRoomsMap.set(row.id, row);
  return row;
}

export function devGetLanChatRoomById(roomId: number): LanChatRoomRow | undefined {
  return lanRoomsMap.get(roomId);
}

export function devDeleteLanChatRoom(roomId: number): void {
  lanRoomsMap.delete(roomId);
}

export function devInsertLanChatMessage(data: InsertLanChatMessage): LanChatMessageRow {
  const row: LanChatMessageRow = {
    id: lanNextMessageId++,
    roomId: data.roomId,
    nickname: data.nickname,
    color: data.color,
    content: data.content,
    attachments: (data.attachments as LanChatMessageRow["attachments"]) ?? null,
    clientIp: data.clientIp,
    createdAt: now(),
  };
  lanMessagesMap.set(row.id, row);
  return row;
}

export function devGetLanChatMessages(roomId: number, opts: { beforeId?: number; limit: number }): LanChatMessageRow[] {
  return Array.from(lanMessagesMap.values())
    .filter((m) => m.roomId === roomId && (opts.beforeId == null || m.id < opts.beforeId))
    .sort((a, b) => b.id - a.id)
    .slice(0, opts.limit);
}

// Admin-scoped dev helpers (no networkGroupId filter — used by admin page).
export function devListAllLanChatRooms(): LanChatRoomRow[] {
  return Array.from(lanRoomsMap.values()).sort((a, b) => b.id - a.id);
}

export function devGetAllLanChatMessages(opts: {
  roomId?: number;
  search?: string;
  limit: number;
  offset: number;
}): { rows: LanChatMessageRow[]; total: number } {
  let all = Array.from(lanMessagesMap.values());
  if (opts.roomId != null) all = all.filter((m) => m.roomId === opts.roomId);
  if (opts.search) {
    const s = opts.search.toLowerCase();
    all = all.filter((m) => m.content.toLowerCase().includes(s));
  }
  const total = all.length;
  const rows = all
    .sort((a, b) => b.id - a.id)
    .slice(opts.offset, opts.offset + opts.limit);
  return { rows, total };
}

// ── LAN Chat — Phase 2B dev fallbacks ───────────────────────────────────────

const lanInvitesMap = new Map<number, LanChatInviteRow>();
let lanNextInviteId = 1;

export function devCreateLanChatInvite(data: InsertLanChatInvite): LanChatInviteRow {
  const row: LanChatInviteRow = {
    id: lanNextInviteId++,
    code: data.code,
    groupId: data.groupId,
    expiresAt: data.expiresAt instanceof Date ? data.expiresAt : new Date(String(data.expiresAt)),
    usedAt: null,
    usedByNickname: null,
    usedByIp: null,
    createdAt: now(),
  };
  lanInvitesMap.set(row.id, row);
  return row;
}

export function devListLanChatInvites(): LanChatInviteRow[] {
  return Array.from(lanInvitesMap.values()).sort((a, b) => b.id - a.id);
}

export function devRedeemLanChatInvite(code: string, by: { nickname: string; ip: string }): LanChatInviteRow | null {
  const row = Array.from(lanInvitesMap.values()).find((r) => r.code === code);
  if (!row) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  const updated = { ...row, usedAt: now(), usedByNickname: by.nickname, usedByIp: by.ip };
  lanInvitesMap.set(row.id, updated);
  return updated;
}

const lanIpWhitelistMap = new Map<number, LanChatIpWhitelistRow>();
let lanNextWhitelistId = 1;
let lanIpWhitelistEnabledDev = false;

export function devGetLanChatSettings(): LanChatSettingsRow {
  return { id: 1, ipWhitelistEnabled: lanIpWhitelistEnabledDev, updatedAt: now() };
}

export function devSetLanChatIpWhitelistEnabled(enabled: boolean): void {
  lanIpWhitelistEnabledDev = enabled;
}

export function devListLanChatIpWhitelist(): LanChatIpWhitelistRow[] {
  return Array.from(lanIpWhitelistMap.values()).sort((a, b) => b.id - a.id);
}

export function devAddLanChatIpWhitelist(data: InsertLanChatIpWhitelist): LanChatIpWhitelistRow {
  const existing = Array.from(lanIpWhitelistMap.values()).find((r) => r.ip === data.ip);
  if (existing) return existing;
  const row: LanChatIpWhitelistRow = {
    id: lanNextWhitelistId++,
    ip: data.ip,
    note: data.note ?? null,
    createdAt: now(),
  };
  lanIpWhitelistMap.set(row.id, row);
  return row;
}

export function devRemoveLanChatIpWhitelist(id: number): boolean {
  return lanIpWhitelistMap.delete(id);
}

export function devIsIpInLanChatWhitelist(ip: string): boolean {
  return Array.from(lanIpWhitelistMap.values()).some((r) => r.ip === ip);
}

// ── Account-based Chat (rewrite) dev fallbacks ──────────────────────────────────

const chatConvMap = new Map<number, ChatConversation>();
const chatMembersMap = new Map<number, ChatMember>();
const chatMsgMap = new Map<number, ConversationMessage>();
const chatAttachMap = new Map<number, ChatAttachment>();
const chatKeysMap = new Map<number, unknown>(); // userId -> publicKeyJwk
// `${conversationId}:${memberUserId}` -> { senderPubJwk, wrappedKey } (serverless group room keys)
const chatRoomKeysMap = new Map<string, { senderPubJwk: unknown; wrappedKey: { ciphertext: string; iv: string } }>();
const chatBansMap = new Map<number, ChatBan>();
let chatNextConvId = 1;
let chatNextMemberId = 1;
let chatNextMsgId = 1;
let chatNextAttachId = 1;
let chatNextBanId = 1;
let chatSettingsDev: ChatSettingsRow = {
  id: 1, serverlessAllowed: true, lobbyEnabled: true, maxFileMb: 5000, updatedAt: now(),
};

export function devGetOrCreateLobby(): ChatConversation {
  let lobby = Array.from(chatConvMap.values()).find((c) => c.type === "lobby");
  if (!lobby) {
    lobby = {
      id: chatNextConvId++, type: "lobby", mode: "server", title: "大厅",
      passwordHash: null, createdBy: null, dmKey: null, createdAt: now(), updatedAt: now(),
    };
    chatConvMap.set(lobby.id, lobby);
  }
  return lobby;
}

export function devCreateConversation(data: InsertChatConversation): ChatConversation {
  const row: ChatConversation = {
    id: chatNextConvId++,
    type: data.type,
    mode: data.mode ?? "server",
    title: data.title ?? null,
    passwordHash: data.passwordHash ?? null,
    createdBy: data.createdBy ?? null,
    dmKey: data.dmKey ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  chatConvMap.set(row.id, row);
  return row;
}

export function devGetConversationById(id: number): ChatConversation | undefined {
  return chatConvMap.get(id);
}

export function devGetConversationByDmKey(dmKey: string): ChatConversation | undefined {
  return Array.from(chatConvMap.values()).find((c) => c.dmKey === dmKey);
}

export function devUpdateConversation(id: number, patch: Partial<ChatConversation>): void {
  const c = chatConvMap.get(id);
  if (c) chatConvMap.set(id, { ...c, ...patch, updatedAt: now() });
}

export function devDeleteConversation(id: number): void {
  chatConvMap.delete(id);
  Array.from(chatMembersMap.entries()).forEach(([mid, m]) => { if (m.conversationId === id) chatMembersMap.delete(mid); });
  Array.from(chatMsgMap.entries()).forEach(([xid, x]) => { if (x.conversationId === id) chatMsgMap.delete(xid); });
  Array.from(chatAttachMap.entries()).forEach(([aid, a]) => { if (a.conversationId === id) chatAttachMap.delete(aid); });
}

export function devAddMember(conversationId: number, userId: number, role: "owner" | "member"): ChatMember {
  const existing = Array.from(chatMembersMap.values())
    .find((m) => m.conversationId === conversationId && m.userId === userId);
  if (existing) return existing;
  const row: ChatMember = {
    id: chatNextMemberId++, conversationId, userId, role, lastReadMessageId: 0, joinedAt: now(),
  };
  chatMembersMap.set(row.id, row);
  return row;
}

export function devRemoveMember(conversationId: number, userId: number): void {
  Array.from(chatMembersMap.entries()).forEach(([id, m]) => {
    if (m.conversationId === conversationId && m.userId === userId) chatMembersMap.delete(id);
  });
}

export function devListMembers(conversationId: number): ChatMember[] {
  return Array.from(chatMembersMap.values()).filter((m) => m.conversationId === conversationId);
}

export function devIsMember(conversationId: number, userId: number): boolean {
  // Lobby is implicitly joinable by everyone in dev.
  const conv = chatConvMap.get(conversationId);
  if (conv?.type === "lobby") return true;
  return Array.from(chatMembersMap.values())
    .some((m) => m.conversationId === conversationId && m.userId === userId);
}

export function devListConversationsForUser(userId: number): ChatConversation[] {
  const memberConvIds = new Set(
    Array.from(chatMembersMap.values()).filter((m) => m.userId === userId).map((m) => m.conversationId),
  );
  return Array.from(chatConvMap.values())
    .filter((c) => c.type === "lobby" || memberConvIds.has(c.id))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function devListJoinableGroups(userId: number): ChatConversation[] {
  const memberConvIds = new Set(
    Array.from(chatMembersMap.values()).filter((m) => m.userId === userId).map((m) => m.conversationId),
  );
  return Array.from(chatConvMap.values())
    // 与生产 listJoinableGroups 一致：排除系统房（system: 前缀 或 createdBy=null 的官方/系统房），
    // 不进发现列表。
    .filter((c) => c.type === "group" && !memberConvIds.has(c.id) && !(c.dmKey ?? "").startsWith("system:") && c.createdBy != null)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function devUpdateLastRead(conversationId: number, userId: number, messageId: number): void {
  Array.from(chatMembersMap.entries()).forEach(([id, m]) => {
    if (m.conversationId === conversationId && m.userId === userId)
      chatMembersMap.set(id, { ...m, lastReadMessageId: Math.max(m.lastReadMessageId, messageId) });
  });
}

export function devInsertChatMessage(data: InsertConversationMessage): ConversationMessage {
  const row: ConversationMessage = {
    id: chatNextMsgId++,
    conversationId: data.conversationId,
    senderId: data.senderId,
    senderName: data.senderName,
    content: data.content,
    attachments: (data.attachments as ConversationMessage["attachments"]) ?? null,
    createdAt: now(),
  };
  chatMsgMap.set(row.id, row);
  devUpdateConversation(data.conversationId, {});
  return row;
}

export function devGetChatMessagesPage(conversationId: number, opts: { beforeId?: number; limit: number }): ConversationMessage[] {
  return Array.from(chatMsgMap.values())
    .filter((m) => m.conversationId === conversationId && (opts.beforeId == null || m.id < opts.beforeId))
    .sort((a, b) => b.id - a.id)
    .slice(0, opts.limit);
}

export function devGetChatMessageById(id: number): ConversationMessage | undefined {
  return chatMsgMap.get(id);
}

export function devDeleteChatMessage(id: number): void {
  chatMsgMap.delete(id);
}

export function devInsertChatAttachment(data: InsertChatAttachment): ChatAttachment {
  const row: ChatAttachment = {
    id: chatNextAttachId++,
    conversationId: data.conversationId,
    messageId: data.messageId ?? null,
    uploaderId: data.uploaderId,
    storageKey: data.storageKey,
    url: data.url,
    name: data.name,
    mimeType: data.mimeType,
    size: data.size,
    kind: data.kind,
    createdAt: now(),
  };
  chatAttachMap.set(row.id, row);
  return row;
}

export function devLinkAttachments(messageId: number, attachmentIds: number[], conversationId: number): void {
  for (const aid of attachmentIds) {
    const a = chatAttachMap.get(aid);
    if (a && a.conversationId === conversationId) chatAttachMap.set(aid, { ...a, messageId }); // 只重链属于本会话的附件
  }
}

export function devListConversationAttachments(conversationId: number): ChatAttachment[] {
  return Array.from(chatAttachMap.values())
    .filter((a) => a.conversationId === conversationId)
    .sort((a, b) => b.id - a.id);
}

export function devUpsertUserPublicKey(userId: number, jwk: unknown): void {
  chatKeysMap.set(userId, jwk);
}

export function devGetUserPublicKeys(userIds: number[]): { userId: number; publicKeyJwk: unknown }[] {
  return userIds
    .filter((id) => chatKeysMap.has(id))
    .map((id) => ({ userId: id, publicKeyJwk: chatKeysMap.get(id) }));
}

export function devPutRoomKeyBundles(conversationId: number, senderPubJwk: unknown, bundles: { memberUserId: number; wrappedKey: { ciphertext: string; iv: string } }[]): void {
  for (const b of bundles) chatRoomKeysMap.set(`${conversationId}:${b.memberUserId}`, { senderPubJwk, wrappedKey: b.wrappedKey });
}

export function devGetRoomKeyBundle(conversationId: number, memberUserId: number): { senderPubJwk: unknown; wrappedKey: { ciphertext: string; iv: string } } | null {
  return chatRoomKeysMap.get(`${conversationId}:${memberUserId}`) ?? null;
}

export function devAddBan(data: InsertChatBan): ChatBan {
  const row: ChatBan = {
    id: chatNextBanId++,
    userId: data.userId,
    scope: data.scope,
    conversationId: data.conversationId ?? null,
    reason: data.reason ?? null,
    bannedBy: data.bannedBy,
    createdAt: now(),
  };
  chatBansMap.set(row.id, row);
  return row;
}

export function devRemoveBan(id: number): void {
  chatBansMap.delete(id);
}

export function devListBans(): ChatBan[] {
  return Array.from(chatBansMap.values()).sort((a, b) => b.id - a.id);
}

export function devIsBanned(userId: number, conversationId: number): boolean {
  return Array.from(chatBansMap.values()).some(
    (b) => b.userId === userId && (b.scope === "global" || b.conversationId === conversationId),
  );
}

export function devListAllConversations(opts: { type?: string; mode?: string; limit: number; offset: number }): { rows: ChatConversation[]; total: number } {
  let all = Array.from(chatConvMap.values());
  if (opts.type) all = all.filter((c) => c.type === opts.type);
  if (opts.mode) all = all.filter((c) => c.mode === opts.mode);
  const total = all.length;
  const rows = all.sort((a, b) => b.id - a.id).slice(opts.offset, opts.offset + opts.limit);
  return { rows, total };
}

export function devAdminSearchMessages(opts: { userId?: number; conversationId?: number; keyword?: string; limit: number; offset: number }): { rows: ConversationMessage[]; total: number } {
  let all = Array.from(chatMsgMap.values());
  if (opts.userId != null) all = all.filter((m) => m.senderId === opts.userId);
  if (opts.conversationId != null) all = all.filter((m) => m.conversationId === opts.conversationId);
  if (opts.keyword) {
    const s = opts.keyword.toLowerCase();
    all = all.filter((m) => m.content.toLowerCase().includes(s));
  }
  const total = all.length;
  const rows = all.sort((a, b) => b.id - a.id).slice(opts.offset, opts.offset + opts.limit);
  return { rows, total };
}

export function devListAllAttachments(opts: { conversationId?: number; limit: number; offset: number }): { rows: ChatAttachment[]; total: number } {
  let all = Array.from(chatAttachMap.values());
  if (opts.conversationId != null) all = all.filter((a) => a.conversationId === opts.conversationId);
  const total = all.length;
  const rows = all.sort((a, b) => b.id - a.id).slice(opts.offset, opts.offset + opts.limit);
  return { rows, total };
}

export function devGetChatSettings(): ChatSettingsRow {
  return chatSettingsDev;
}

export function devSetChatSettings(patch: Partial<Pick<ChatSettingsRow, "serverlessAllowed" | "lobbyEnabled" | "maxFileMb">>): ChatSettingsRow {
  chatSettingsDev = { ...chatSettingsDev, ...patch, updatedAt: now() };
  return chatSettingsDev;
}

// ── Download authorization (in-memory) ──────────────────────────────────────
const downloadGrantsMap = new Map<number, DownloadGrant>();
const downloadConsumptions: Array<{ grantId: number; storageKey: string }> = [];

export function devGetAssetByStorageKey(storageKey: string): { id: number; userId: number; projectId: number | null } | null {
  for (const a of Array.from(assetsMap.values())) {
    if (a.storageKey === storageKey && a.deletedAt == null) return { id: a.id, userId: a.userId, projectId: a.projectId };
  }
  return null;
}

export function devGetAssetMetaForGrant(assetId: number | null, storageKey: string | null): { name: string; url: string; type: string; projectId: number | null } | null {
  if (assetId != null) {
    const a = assetsMap.get(assetId);
    if (a) return { name: a.name, url: a.url, type: a.type, projectId: a.projectId };
  }
  if (storageKey) {
    for (const a of Array.from(assetsMap.values())) {
      if (a.storageKey === storageKey) return { name: a.name, url: a.url, type: a.type, projectId: a.projectId };
    }
    return { name: storageKey.split("/").pop() || storageKey, url: `/manus-storage/${storageKey}`, type: "other", projectId: null };
  }
  return null;
}

export function devCreateDownloadGrant(input: {
  userId: number; scope: "asset" | "project"; storageKey?: string | null; assetId?: number | null; projectId?: number | null;
  reason?: string | null; note?: string | null; origin: "request" | "admin"; status: "pending" | "active";
  createdBy: number; decidedBy?: number; decidedAt?: Date; expiresAt?: Date | null;
}): DownloadGrant {
  const id = newId();
  const g: DownloadGrant = {
    id, userId: input.userId, origin: input.origin, scope: input.scope,
    storageKey: input.storageKey ?? null, assetId: input.assetId ?? null, projectId: input.projectId ?? null,
    status: input.status, reason: input.reason ?? null, note: input.note ?? null,
    createdBy: input.createdBy, decidedBy: input.decidedBy ?? null, decidedAt: input.decidedAt ?? null,
    expiresAt: input.expiresAt ?? null, createdAt: now(),
  };
  downloadGrantsMap.set(id, g);
  return g;
}

export function devUpdateDownloadGrant(id: number, patch: Partial<DownloadGrant>): void {
  const g = downloadGrantsMap.get(id);
  if (g) downloadGrantsMap.set(id, { ...g, ...patch });
}

export function devListDownloadGrants(filter: { status?: string; userId?: number; limit?: number; offset?: number } = {}): DownloadGrant[] {
  let rows = Array.from(downloadGrantsMap.values());
  if (filter.status) rows = rows.filter((g) => g.status === filter.status);
  if (filter.userId) rows = rows.filter((g) => g.userId === filter.userId);
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const off = filter.offset ?? 0;
  return rows.slice(off, off + Math.min(filter.limit ?? 200, 500));
}

export function devFindUsableDownloadGrant(input: { userId: number; storageKey: string; assetId?: number | null; projectId?: number | null }): DownloadGrant | null {
  const nowT = Date.now();
  const consumed = new Set(downloadConsumptions.filter((c) => c.storageKey === input.storageKey).map((c) => c.grantId));
  for (const g of Array.from(downloadGrantsMap.values())) {
    if (g.userId !== input.userId || g.status !== "active") continue;
    if (g.expiresAt && g.expiresAt.getTime() < nowT) continue;
    if (consumed.has(g.id)) continue;
    const covers = g.scope === "asset"
      ? (g.storageKey === input.storageKey || (input.assetId != null && g.assetId === input.assetId))
      : (input.projectId != null && g.projectId === input.projectId);
    if (covers) return g;
  }
  return null;
}

export function devConsumeDownloadGrant(grantId: number, _userId: number, storageKey: string, _assetId: number | null): boolean {
  if (downloadConsumptions.some((c) => c.grantId === grantId && c.storageKey === storageKey)) return false;
  downloadConsumptions.push({ grantId, storageKey });
  return true;
}

// ── Video Editor sessions ─────────────────────────────────────────────────────
const editSessionsMap = new Map<number, EditSession>();

export function devListEditSessions(userId: number): EditSession[] {
  return Array.from(editSessionsMap.values())
    .filter((s) => s.userId === userId && s.deletedAt == null)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function devGetEditSession(id: number, userId: number): EditSession | undefined {
  const s = editSessionsMap.get(id);
  return s && s.userId === userId && s.deletedAt == null ? s : undefined;
}

export function devCreateEditSession(data: InsertEditSession): EditSession {
  const id = newId();
  const session: EditSession = {
    id,
    userId: data.userId,
    projectId: data.projectId ?? null,
    name: data.name ?? "未命名剪辑",
    doc: data.doc,
    thumbnailUrl: data.thumbnailUrl ?? null,
    deletedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  editSessionsMap.set(id, session);
  return session;
}

export function devUpdateEditSession(
  id: number,
  userId: number,
  patch: Partial<Pick<InsertEditSession, "name" | "doc" | "thumbnailUrl">>,
): void {
  const s = editSessionsMap.get(id);
  if (!s || s.userId !== userId) return;
  if (patch.name !== undefined) s.name = patch.name;
  if (patch.doc !== undefined) s.doc = patch.doc;
  if (patch.thumbnailUrl !== undefined) s.thumbnailUrl = patch.thumbnailUrl ?? null;
  s.updatedAt = now();
}

export function devDeleteEditSession(id: number, userId: number): void {
  const s = editSessionsMap.get(id);
  if (!s || s.userId !== userId) return;
  s.deletedAt = now();
}

// ── ComfyUI node template library (shared) ─────────────────────────────────────
const comfyTemplatesMap = new Map<number, ComfyNodeTemplateRow>();

export function devListComfyNodeTemplates(): ComfyNodeTemplateRow[] {
  return Array.from(comfyTemplatesMap.values())
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function devGetComfyNodeTemplate(id: number): ComfyNodeTemplateRow | undefined {
  return comfyTemplatesMap.get(id);
}

const comfyAnalysisMap = new Map<number, ComfyTemplateAnalysisRow>();

export function devListComfyTemplateAnalysis(): ComfyTemplateAnalysisRow[] {
  return Array.from(comfyAnalysisMap.values());
}
export function devGetComfyTemplateAnalysis(templateId: number): ComfyTemplateAnalysisRow | undefined {
  return comfyAnalysisMap.get(templateId);
}
export function devDeleteComfyTemplateAnalysis(templateId: number): void {
  comfyAnalysisMap.delete(templateId);
}

export function devUpsertComfyTemplateAnalysis(data: InsertComfyTemplateAnalysis): void {
  const prev = comfyAnalysisMap.get(data.templateId);
  comfyAnalysisMap.set(data.templateId, {
    id: prev?.id ?? newId(),
    templateId: data.templateId,
    functionSummary: data.functionSummary ?? null,
    capabilities: data.capabilities ?? null,
    outputType: data.outputType ?? null,
    hasVideoOutput: data.hasVideoOutput ?? null,
    modelNames: data.modelNames ?? null,
    maxFrames: data.maxFrames ?? null,
    fps: data.fps ?? null,
    analysisVersion: data.analysisVersion ?? 1,
    model: data.model ?? null,
    analyzedAt: now(),
  });
}

export function devCreateComfyNodeTemplate(data: InsertComfyNodeTemplate): ComfyNodeTemplateRow {
  const id = newId();
  const row: ComfyNodeTemplateRow = {
    id,
    userId: data.userId,
    creatorName: data.creatorName ?? null,
    label: data.label,
    nodeType: data.nodeType,
    payload: data.payload,
    note: data.note ?? null,
    thumbnail: data.thumbnail ?? null,
    useCloud: data.useCloud ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  comfyTemplatesMap.set(id, row);
  return row;
}

export function devUpdateComfyNodeTemplate(
  id: number,
  patch: Partial<Pick<InsertComfyNodeTemplate, "label" | "note" | "payload" | "thumbnail" | "useCloud">>,
): void {
  const r = comfyTemplatesMap.get(id);
  if (!r) return;
  if (patch.label !== undefined) r.label = patch.label;
  if (patch.note !== undefined) r.note = patch.note ?? null;
  if (patch.payload !== undefined) r.payload = patch.payload;
  if (patch.thumbnail !== undefined) r.thumbnail = patch.thumbnail ?? null;
  if (patch.useCloud !== undefined) r.useCloud = patch.useCloud ?? null;
  r.updatedAt = now();
}

export function devDeleteComfyNodeTemplate(id: number): void {
  comfyTemplatesMap.delete(id);
}
