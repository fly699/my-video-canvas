import { eq, and, desc, sql, inArray, isNull, like, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  projects,
  canvasNodes,
  canvasEdges,
  assets,
  videoTasks,
  chatMessages,
  whitelistSettings,
  whitelistEntries,
  storageSettings,
  auditLogs,
  poyoBalanceSnapshots,
  projectCollaborators,
  projectShareLinks,
  InsertProject,
  InsertCanvasNode,
  InsertCanvasEdge,
  InsertAsset,
  InsertVideoTask,
  InsertChatMessage,
  InsertAuditLog,
  InsertProjectCollaborator,
  InsertProjectShareLink,
  lanChatRooms,
  lanChatMessages,
  lanChatInvites,
  lanChatIpWhitelist,
  lanChatSettings,
  type LanChatRoomRow,
  type LanChatMessageRow,
  type LanChatInviteRow,
  type LanChatIpWhitelistRow,
  type LanChatSettingsRow,
  type InsertLanChatRoom,
  type InsertLanChatMessage,
  type InsertLanChatInvite,
  type InsertLanChatIpWhitelist,
  chatConversations,
  chatMembers,
  conversationMessages,
  chatAttachments,
  chatUserKeys,
  chatBans,
  chatSettings,
  type ChatConversation,
  type InsertChatConversation,
  type ChatMember,
  type ConversationMessage,
  type InsertConversationMessage,
  type ChatAttachment,
  type InsertChatAttachment,
  type ChatBan,
  type InsertChatBan,
  type ChatSettingsRow,
  downloadGrants,
  downloadConsumptions,
  type DownloadGrant,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import * as dev from "./_core/devStore";

// Dev-mode whitelist state
const devWhitelistSettings = { id: 1, enabled: false, comfyuiBypass: false, updatedAt: new Date() };
const devStorageSettings = { id: 1, persistAudio: true, persistVideo: true, persistImage: true, presignTtlSec: 3600, poyoUploadFallback: false, minioOnly: true, preferUpstreamRefSource: false, downloadAuthEnabled: false, updatedAt: new Date() };
const devWhitelistEntries: Array<{ id: number; type: "ip" | "user"; value: string; note: string | null; createdBy: number | null; createdAt: Date }> = [];
let devNextWhitelistId = 1;

const DEV_MODE = process.env.NODE_ENV === "development" && !process.env.DATABASE_URL && !process.env.OAUTH_SERVER_URL;

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod", "passwordHash"] as const;
  textFields.forEach((field) => {
    const value = user[field];
    if (value === undefined) return;
    // Lowercase AND trim email at write time so eq() lookups match regardless
    // of MySQL collation. Trim guards against IdP-provided emails with stray
    // whitespace (some providers append a newline) leaving claim-pending rows
    // orphaned when invites store the trimmed form (Zod's z.string().email()
    // is strict but our path here is upsertUser from OAuth-provided values).
    const normalized = field === "email" && typeof value === "string"
      ? value.trim().toLowerCase()
      : value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  });

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else {
    // Promote to admin if openId or email matches the configured owner.
    // Email-match applies to any login method (including email-password) — the
    // previous OAuth-only restriction has been lifted per project requirements.
    const isOwnerById = ENV.ownerOpenId && user.openId === ENV.ownerOpenId;
    const isOwnerByEmail =
      ENV.ownerEmail &&
      user.email?.toLowerCase() === ENV.ownerEmail.toLowerCase();
    if (isOwnerById || isOwnerByEmail) {
      values.role = "admin";
      updateSet.role = "admin";
    }
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    if (DEV_MODE) {
      // Dev: synthesize the two well-known dev users.
      if (id === 1) return { id: 1, name: "Dev User", email: "dev@localhost", role: "user" } as unknown as Awaited<ReturnType<typeof getUserByOpenId>>;
      if (id === 2) return { id: 2, name: "Dev User 2", email: "dev2@localhost", role: "user" } as unknown as Awaited<ReturnType<typeof getUserByOpenId>>;
    }
    return undefined;
  }
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function getProjectsByUser(userId: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetProjectsByUser(userId) : [];
  return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
}

export async function getProjectById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetProjectById(id, userId) : undefined;
  const result = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);
  return result[0];
}

export async function createProject(data: InsertProject) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devCreateProject(data); throw new Error("DB unavailable"); }
  const [header] = await db.insert(projects).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(projects).where(eq(projects.id, insertId));
  return rows[0] ?? null;
}

export async function updateProject(id: number, userId: number, data: Partial<InsertProject>) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devUpdateProject(id, userId, data); return; } throw new Error("DB unavailable"); }
  await db.update(projects).set(data).where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

// Set a project's auto cover WITHOUT bumping updatedAt — refreshing a cover is
// not an edit, so it must not reorder the list or change the "最后打开" time.
// Explicitly assigning updatedAt to its own value suppresses MySQL's
// ON UPDATE CURRENT_TIMESTAMP.
export async function setProjectThumbnail(id: number, userId: number, thumbnail: string) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devSetProjectThumbnail(id, userId, thumbnail); return; } throw new Error("DB unavailable"); }
  await db.update(projects)
    .set({ thumbnail, updatedAt: sql`${projects.updatedAt}` })
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

export async function deleteProject(id: number, userId: number) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devDeleteProject(id, userId); return; } throw new Error("DB unavailable"); }
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

// ── Project Access ──────────────────────────────────────────────────────────
// Returns the raw project regardless of ownership. Use for access-check helpers
// that need to inspect publicReadAccess, owner, etc.
export async function getProjectByIdRaw(id: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetProjectByIdRaw(id) : undefined;
  const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return result[0];
}

export type EffectiveRole = "owner" | "admin" | "editor" | "viewer";

export interface ProjectAccess {
  project: NonNullable<Awaited<ReturnType<typeof getProjectByIdRaw>>>;
  role: EffectiveRole;
  source: "owner" | "collaborator" | "public";
}

/** Resolve the user's effective role on a project, or null if no access. */
export async function getProjectAccess(projectId: number, userId: number): Promise<ProjectAccess | null> {
  const project = await getProjectByIdRaw(projectId);
  if (!project) return null;
  if (project.userId === userId) return { project, role: "owner", source: "owner" };

  // Collaborator?
  const member = await findCollaboratorByUserId(projectId, userId);
  if (member) return { project, role: member.role, source: "collaborator" };

  // Public read?
  if (project.publicReadAccess) return { project, role: "viewer", source: "public" };

  return null;
}

export async function setProjectPublicAccess(id: number, publicReadAccess: boolean) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devSetProjectPublicAccess(id, publicReadAccess); return; } throw new Error("DB unavailable"); }
  await db.update(projects).set({ publicReadAccess }).where(eq(projects.id, id));
}

/** Projects where user is a collaborator (not owner). */
export async function getProjectsSharedWithUser(userId: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetProjectsByCollaborator(userId) : [];
  const rows = await db
    .select({ project: projects })
    .from(projectCollaborators)
    .innerJoin(projects, eq(projects.id, projectCollaborators.projectId))
    .where(and(
      eq(projectCollaborators.userId, userId),
      eq(projectCollaborators.status, "active"),
    ))
    .orderBy(desc(projects.updatedAt));
  return rows.map((r) => r.project).filter((p) => p.userId !== userId);
}

// ── Project Collaborators ───────────────────────────────────────────────────
export async function listCollaborators(projectId: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListCollaborators(projectId) : [];
  return db.select().from(projectCollaborators).where(eq(projectCollaborators.projectId, projectId));
}

export async function findCollaboratorByUserId(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devFindCollaborator(projectId, userId) : undefined;
  const rows = await db
    .select()
    .from(projectCollaborators)
    .where(and(
      eq(projectCollaborators.projectId, projectId),
      eq(projectCollaborators.userId, userId),
      eq(projectCollaborators.status, "active"),
    ))
    .limit(1);
  return rows[0];
}

export async function findCollaboratorByEmail(projectId: number, email: string) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devFindCollaboratorByEmail(projectId, email) : undefined;
  const rows = await db
    .select()
    .from(projectCollaborators)
    .where(and(
      eq(projectCollaborators.projectId, projectId),
      eq(projectCollaborators.email, email),
    ))
    .limit(1);
  return rows[0];
}

export async function upsertCollaborator(data: InsertProjectCollaborator) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devUpsertCollaborator(data); throw new Error("DB unavailable"); }
  // Try userId first, fall back to email
  const existing = data.userId
    ? await findCollaboratorByUserId(data.projectId, data.userId)
    : data.email
    ? await findCollaboratorByEmail(data.projectId, data.email)
    : undefined;
  if (existing) {
    await db
      .update(projectCollaborators)
      .set({
        role: data.role,
        userId: data.userId ?? existing.userId,
        email: data.email ?? existing.email,
        status: data.status ?? existing.status,
      })
      .where(eq(projectCollaborators.id, existing.id));
    const rows = await db.select().from(projectCollaborators).where(eq(projectCollaborators.id, existing.id));
    return rows[0];
  }
  const [header] = await db.insert(projectCollaborators).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(projectCollaborators).where(eq(projectCollaborators.id, insertId));
  return rows[0];
}

export async function updateCollaboratorRole(id: number, role: "viewer" | "editor" | "admin") {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devUpdateCollaboratorRole(id, role); return; } throw new Error("DB unavailable"); }
  await db.update(projectCollaborators).set({ role }).where(eq(projectCollaborators.id, id));
}

export async function removeCollaborator(id: number) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devRemoveCollaborator(id); return; } throw new Error("DB unavailable"); }
  await db.delete(projectCollaborators).where(eq(projectCollaborators.id, id));
}

/** Claim pending email invites for a user that just registered/logged in.
 *  Called on every authenticated request, so the common case (zero pending
 *  rows) takes a cheap indexed SELECT and skips the UPDATE entirely —
 *  avoiding per-request write locks / binlog noise on the hot auth path. */
export async function claimPendingInvitations(email: string, userId: number) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devClaimPendingCollaboratorsByEmail(email, userId); return; } return; }
  // Fast path: avoid an UPDATE write transaction when there's nothing to claim.
  const candidate = await db
    .select({ id: projectCollaborators.id })
    .from(projectCollaborators)
    .where(and(
      eq(projectCollaborators.email, email),
      isNull(projectCollaborators.userId),
    ))
    .limit(1);
  if (candidate.length === 0) return;
  await db
    .update(projectCollaborators)
    .set({ userId, status: "active" })
    .where(and(
      eq(projectCollaborators.email, email),
      isNull(projectCollaborators.userId),
    ));
}

// ── Project Share Links ─────────────────────────────────────────────────────
export async function createShareLink(data: InsertProjectShareLink) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devCreateShareLink(data); throw new Error("DB unavailable"); }
  const [header] = await db.insert(projectShareLinks).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(projectShareLinks).where(eq(projectShareLinks.id, insertId));
  return rows[0];
}

export async function listShareLinks(projectId: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListShareLinks(projectId) : [];
  return db.select().from(projectShareLinks).where(eq(projectShareLinks.projectId, projectId)).orderBy(desc(projectShareLinks.createdAt));
}

export async function getShareLinkByToken(token: string) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetShareLinkByToken(token) : undefined;
  const rows = await db.select().from(projectShareLinks).where(eq(projectShareLinks.token, token)).limit(1);
  return rows[0];
}

/** Lookup by primary key — used by the short-link route which encodes
 *  {id}.{tokenPrefix} into the URL. Callers must still verify the prefix
 *  against the returned row's full token before accepting the invite. */
export async function getShareLinkById(id: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetShareLinkById(id) : undefined;
  const rows = await db.select().from(projectShareLinks).where(eq(projectShareLinks.id, id)).limit(1);
  return rows[0];
}

/**
 * Atomically consume one slot on a share link. Returns true only if the row
 * was updated (i.e. the caller "won" the race against concurrent acceptances).
 * Guards against TOCTOU on usesCount/expiresAt/revokedAt in one DB roundtrip.
 */
export async function consumeShareLink(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    if (DEV_MODE) return dev.devConsumeShareLink(id);
    throw new Error("DB unavailable");
  }
  // Use DB-side NOW() rather than the app-server clock to avoid clock-skew
  // false positives/negatives between the API server and MySQL host.
  const result = await db
    .update(projectShareLinks)
    .set({ usesCount: sql`${projectShareLinks.usesCount} + 1` })
    .where(and(
      eq(projectShareLinks.id, id),
      isNull(projectShareLinks.revokedAt),
      sql`${projectShareLinks.expiresAt} > NOW()`,
      sql`${projectShareLinks.usesCount} < ${projectShareLinks.maxUses}`,
    ));
  // drizzle/mysql2 returns [ResultSetHeader, FieldPacket[]] from an UPDATE.
  // If the driver tuple shape ever drifts (drizzle minor bump, planetscale,
  // etc.) we'd silently get 0 here and reject every valid invite. Throw
  // loudly instead so the regression is obvious in production logs.
  if (!Array.isArray(result) || typeof result[0] !== "object" || result[0] === null) {
    throw new Error("consumeShareLink: unexpected drizzle UPDATE result shape");
  }
  const header = result[0] as { affectedRows?: number };
  if (typeof header.affectedRows !== "number") {
    throw new Error("consumeShareLink: drizzle result missing affectedRows");
  }
  return header.affectedRows > 0;
}

export async function revokeShareLink(id: number) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devRevokeShareLink(id); return; } throw new Error("DB unavailable"); }
  await db.update(projectShareLinks).set({ revokedAt: new Date() }).where(eq(projectShareLinks.id, id));
}

/** Find a user by email (case-insensitive). Returns undefined if not found. */
export async function findUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined; // dev mode: only DEV_USER exists
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0];
}

// ── Canvas Nodes ──────────────────────────────────────────────────────────────

export async function getNodesByProject(projectId: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetNodesByProject(projectId) : [];
  return db.select().from(canvasNodes).where(eq(canvasNodes.projectId, projectId));
}

export async function upsertNode(data: InsertCanvasNode) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devUpsertNode(data); return; } throw new Error("DB unavailable"); }
  await db.insert(canvasNodes).values(data).onDuplicateKeyUpdate({
    set: {
      type: data.type,
      title: data.title,
      data: data.data,
      posX: data.posX,
      posY: data.posY,
      width: data.width,
      height: data.height,
      zIndex: data.zIndex,
    },
  });
}

export async function deleteNode(id: string, projectId: number): Promise<number> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devDeleteNode(id, projectId); return 1; } throw new Error("DB unavailable"); }
  const [header] = await db.delete(canvasNodes).where(and(eq(canvasNodes.id, id), eq(canvasNodes.projectId, projectId)));
  return (header as unknown as { affectedRows?: number })?.affectedRows ?? 0;
}

export async function batchUpsertNodes(nodes: InsertCanvasNode[]) {
  if (!nodes.length) return;
  const db = await getDb();
  if (!db) {
    if (DEV_MODE) { for (const node of nodes) dev.devUpsertNode(node); return; }
    throw new Error("DB unavailable");
  }
  await db.transaction(async (tx) => {
    for (const node of nodes) {
      await tx.insert(canvasNodes).values(node).onDuplicateKeyUpdate({
        set: {
          type: node.type,
          title: node.title,
          data: node.data,
          posX: node.posX,
          posY: node.posY,
          width: node.width,
          height: node.height,
          zIndex: node.zIndex,
        },
      });
    }
  });
}

// ── Canvas Edges ──────────────────────────────────────────────────────────────

export async function getEdgesByProject(projectId: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetEdgesByProject(projectId) : [];
  return db.select().from(canvasEdges).where(eq(canvasEdges.projectId, projectId));
}

export async function upsertEdge(data: InsertCanvasEdge) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devUpsertEdge(data); return; } throw new Error("DB unavailable"); }
  await db.insert(canvasEdges).values(data).onDuplicateKeyUpdate({
    set: {
      sourceNodeId: data.sourceNodeId,
      targetNodeId: data.targetNodeId,
      sourcePort: data.sourcePort,
      targetPort: data.targetPort,
      label: data.label,
    },
  });
}

export async function deleteEdge(id: string, projectId: number) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devDeleteEdge(id, projectId); return; } throw new Error("DB unavailable"); }
  await db.delete(canvasEdges).where(and(eq(canvasEdges.id, id), eq(canvasEdges.projectId, projectId)));
}

// ── Assets ────────────────────────────────────────────────────────────────────

export interface AssetFilter {
  projectId?: number;
  type?: "image" | "video" | "audio" | "other";
  source?: "upload" | "generated" | "external";
  model?: string;
  q?: string;            // name contains (用户仓库搜索)
}
/** Escape MySQL LIKE metacharacters so a user query is matched literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
export async function getAssetsByUser(userId: number, filter: AssetFilter = {}) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetAssetsByUser(userId, filter) : [];
  // Always exclude soft-deleted rows.
  const conds = [eq(assets.userId, userId), isNull(assets.deletedAt)];
  if (filter.projectId !== undefined) conds.push(eq(assets.projectId, filter.projectId));
  if (filter.type) conds.push(eq(assets.type, filter.type));
  if (filter.source) conds.push(eq(assets.source, filter.source));
  if (filter.model) conds.push(eq(assets.model, filter.model));
  if (filter.q) conds.push(like(assets.name, `%${escapeLike(filter.q)}%`));
  return db.select().from(assets).where(and(...conds)).orderBy(desc(assets.createdAt));
}

/**
 * Lightweight library summary for the Home entry card: total count + a few recent
 * image URLs for the cover collage. Avoids shipping the whole asset table just to
 * render a number and 4 thumbnails.
 */
export async function getAssetSummary(userId: number, coverLimit = 4): Promise<{ count: number; covers: string[] }> {
  const db = await getDb();
  if (!db) {
    if (DEV_MODE) {
      const all = dev.devGetAssetsByUser(userId);
      return { count: all.length, covers: all.filter((a) => a.type === "image" && a.url).slice(0, coverLimit).map((a) => a.url) };
    }
    return { count: 0, covers: [] };
  }
  const conds = [eq(assets.userId, userId), isNull(assets.deletedAt)];
  const [countRow] = await db.select({ c: count() }).from(assets).where(and(...conds));
  const imgs = await db.select({ url: assets.url }).from(assets)
    .where(and(...conds, eq(assets.type, "image")))
    .orderBy(desc(assets.createdAt)).limit(coverLimit);
  return { count: Number(countRow?.c ?? 0), covers: imgs.map((r) => r.url) };
}

/** Sanitize a fragment for use in a filename/label tag (项目名 / 模型名). */
function tagify(s?: string | null): string {
  if (!s) return "";
  return s.replace(/\.[A-Za-z0-9]{1,12}$/, "")        // drop extension (.safetensors…)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/\s+/g, "_")
    .replace(/_+/g, "_").replace(/^[_.]+|[_.]+$/g, "").slice(0, 48);
}

/**
 * Index a produced media item into the unified library. Best-effort: any failure
 * is logged and swallowed so recording never breaks a (paid) generation. Dedupes
 * by (userId, storageKey) so the video poll + background poller don't double-write.
 */
export async function recordGeneratedAsset(a: {
  userId: number;
  projectId?: number | null;
  nodeId?: string | null;
  type: "image" | "video" | "audio" | "other";
  source?: "upload" | "generated" | "external";
  provider?: string | null;
  model?: string | null;
  url: string;
  storageKey?: string | null;
  name: string;
  mimeType?: string | null;
  size?: number | null;
}): Promise<void> {
  try {
    if (!a.url) return;
    const storageKey = a.storageKey
      ?? (a.url.startsWith("/manus-storage/") ? a.url.slice("/manus-storage/".length) : a.url);
    // Tag the display/download name with 项目名_模型 (sanitized) so files are identifiable.
    let displayName = a.name;
    try {
      const proj = a.projectId != null ? await getProjectByIdRaw(a.projectId) : undefined;
      const parts = [proj?.name, a.model].map(tagify).filter(Boolean);
      if (parts.length > 0) displayName = parts.join("_");
    } catch { /* keep a.name */ }
    const db = await getDb();
    if (db) {
      const existing = await db.select({ id: assets.id }).from(assets)
        .where(and(eq(assets.userId, a.userId), eq(assets.storageKey, storageKey), isNull(assets.deletedAt)))
        .limit(1);
      if (existing.length > 0) return;
    } else if (DEV_MODE) {
      const ex = dev.devGetAssetsByUser(a.userId).find((x) => x.storageKey === storageKey);
      if (ex) return;
    }
    await createAsset({
      userId: a.userId,
      projectId: a.projectId ?? null,
      name: displayName,
      type: a.type,
      mimeType: a.mimeType ?? null,
      size: a.size ?? null,
      storageKey,
      url: a.url,
      source: a.source ?? "generated",
      provider: a.provider ?? null,
      model: a.model ?? null,
      nodeId: a.nodeId ?? null,
    } as InsertAsset);
  } catch (err) {
    console.error("[recordGeneratedAsset] non-fatal:", err);
  }
}

/** All canvas nodes (raw) — used by the one-off asset backfill script. */
export async function getAllCanvasNodesRaw(): Promise<Array<{ id: string; projectId: number; data: unknown }>> {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: canvasNodes.id, projectId: canvasNodes.projectId, data: canvasNodes.data }).from(canvasNodes);
}

export interface AdminAssetFilter {
  userId?: number;
  type?: "image" | "video" | "audio" | "other";
  source?: "upload" | "generated" | "external";
  model?: string;
  projectId?: number;
  q?: string;            // name contains
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}
/** Admin cross-user retrieval: every user's library, with filters + pagination. */
export async function getAllAssets(filter: AdminAssetFilter = {}) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetAllAssets(filter) : [];
  const conds = [];
  if (!filter.includeDeleted) conds.push(isNull(assets.deletedAt));
  if (filter.userId) conds.push(eq(assets.userId, filter.userId));
  if (filter.type) conds.push(eq(assets.type, filter.type));
  if (filter.source) conds.push(eq(assets.source, filter.source));
  if (filter.model) conds.push(eq(assets.model, filter.model));
  if (filter.projectId) conds.push(eq(assets.projectId, filter.projectId));
  if (filter.q) conds.push(like(assets.name, `%${escapeLike(filter.q)}%`));
  return db.select().from(assets)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(assets.createdAt))
    .limit(Math.min(filter.limit ?? 200, 500))
    .offset(filter.offset ?? 0);
}

export async function createAsset(data: InsertAsset) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devCreateAsset(data); throw new Error("DB unavailable"); }
  const [header] = await db.insert(assets).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(assets).where(eq(assets.id, insertId));
  return rows[0] ?? null;
}

export async function getAssetById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(assets).where(and(eq(assets.id, id), eq(assets.userId, userId)));
  return rows[0] ?? null;
}

export async function deleteAsset(id: number, userId: number) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devDeleteAsset(id, userId); return; } throw new Error("DB unavailable"); }
  // Soft delete: hide from the user but KEEP the MinIO object and the row (the
  // file must persist; only its visibility/ownership is cleared).
  await db.update(assets).set({ deletedAt: new Date() }).where(and(eq(assets.id, id), eq(assets.userId, userId)));
}

// Admin soft-delete (no user scope) — used by the cross-user admin library.
// Same soft-delete semantics: the row + MinIO object are kept.
export async function deleteAssetAdmin(ids: number[]) {
  if (ids.length === 0) return;
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devDeleteAssetAdmin(ids); return; } throw new Error("DB unavailable"); }
  await db.update(assets).set({ deletedAt: new Date() }).where(inArray(assets.id, ids));
}

// ── Download authorization ─────────────────────────────────────────────────
// Find an asset row by its storageKey (any owner) — lets the download gateway
// resolve a file's assetId/projectId/owner from just the storage key.
export async function getAssetByStorageKey(storageKey: string): Promise<{ id: number; userId: number; projectId: number | null } | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devGetAssetByStorageKey(storageKey); return null; }
  const rows = await db.select({ id: assets.id, userId: assets.userId, projectId: assets.projectId })
    .from(assets).where(and(eq(assets.storageKey, storageKey), isNull(assets.deletedAt))).limit(1);
  return rows[0] ?? null;
}

// Resolve a file's display metadata (name/url/type/project) for the admin
// download-review UI — by assetId first, else by storageKey. Cross-user (admin).
export async function getAssetMetaForGrant(assetId: number | null, storageKey: string | null): Promise<{ name: string; url: string; type: string; projectId: number | null } | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devGetAssetMetaForGrant(assetId, storageKey); return null; }
  if (assetId != null) {
    const rows = await db.select({ name: assets.name, url: assets.url, type: assets.type, projectId: assets.projectId }).from(assets).where(eq(assets.id, assetId)).limit(1);
    if (rows[0]) return rows[0];
  }
  if (storageKey) {
    const rows = await db.select({ name: assets.name, url: assets.url, type: assets.type, projectId: assets.projectId }).from(assets).where(eq(assets.storageKey, storageKey)).limit(1);
    if (rows[0]) return rows[0];
    // Not in the asset table (e.g. a raw generated file) — synthesize from the key.
    return { name: storageKey.split("/").pop() || storageKey, url: `/manus-storage/${storageKey}`, type: "other", projectId: null };
  }
  return null;
}

export async function createDownloadRequest(input: {
  userId: number; scope: "asset" | "project"; storageKey?: string | null; assetId?: number | null; projectId?: number | null; reason?: string | null;
}): Promise<DownloadGrant | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devCreateDownloadGrant({ ...input, origin: "request", status: "pending", createdBy: input.userId }); throw new Error("DB unavailable"); }
  const [res] = await db.insert(downloadGrants).values({
    userId: input.userId, origin: "request", scope: input.scope,
    storageKey: input.storageKey ?? null, assetId: input.assetId ?? null, projectId: input.projectId ?? null,
    status: "pending", reason: input.reason ?? null, createdBy: input.userId,
  });
  const id = (res as { insertId?: number }).insertId;
  if (!id) return null;
  const rows = await db.select().from(downloadGrants).where(eq(downloadGrants.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function adminCreateGrant(input: {
  userId: number; scope: "asset" | "project"; storageKey?: string | null; assetId?: number | null; projectId?: number | null; note?: string | null; expiresAt?: Date | null; createdBy: number;
}): Promise<DownloadGrant | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devCreateDownloadGrant({ ...input, origin: "admin", status: "active", decidedBy: input.createdBy, decidedAt: new Date() }); throw new Error("DB unavailable"); }
  const [res] = await db.insert(downloadGrants).values({
    userId: input.userId, origin: "admin", scope: input.scope,
    storageKey: input.storageKey ?? null, assetId: input.assetId ?? null, projectId: input.projectId ?? null,
    status: "active", note: input.note ?? null, createdBy: input.createdBy, decidedBy: input.createdBy, decidedAt: new Date(), expiresAt: input.expiresAt ?? null,
  });
  const id = (res as { insertId?: number }).insertId;
  if (!id) return null;
  const rows = await db.select().from(downloadGrants).where(eq(downloadGrants.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function decideDownloadGrant(grantId: number, adminId: number, approve: boolean, note?: string | null, expiresAt?: Date | null): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devUpdateDownloadGrant(grantId, { status: approve ? "active" : "denied", decidedBy: adminId, decidedAt: new Date(), note: note ?? null, expiresAt: approve ? (expiresAt ?? null) : null }); return; } throw new Error("DB unavailable"); }
  await db.update(downloadGrants).set({ status: approve ? "active" : "denied", decidedBy: adminId, decidedAt: new Date(), note: note ?? null, ...(approve ? { expiresAt: expiresAt ?? null } : {}) })
    .where(and(eq(downloadGrants.id, grantId), eq(downloadGrants.status, "pending")));
}

export async function revokeDownloadGrant(grantId: number, adminId: number): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devUpdateDownloadGrant(grantId, { status: "revoked", decidedBy: adminId, decidedAt: new Date() }); return; } throw new Error("DB unavailable"); }
  await db.update(downloadGrants).set({ status: "revoked", decidedBy: adminId, decidedAt: new Date() }).where(eq(downloadGrants.id, grantId));
}

export async function listDownloadGrants(filter: { status?: "pending" | "active" | "revoked" | "denied"; userId?: number; limit?: number; offset?: number } = {}): Promise<DownloadGrant[]> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devListDownloadGrants(filter); return []; }
  const conds = [];
  if (filter.status) conds.push(eq(downloadGrants.status, filter.status));
  if (filter.userId) conds.push(eq(downloadGrants.userId, filter.userId));
  let q = db.select().from(downloadGrants).$dynamic();
  if (conds.length) q = q.where(and(...conds));
  return q.orderBy(desc(downloadGrants.createdAt)).limit(Math.min(filter.limit ?? 200, 500)).offset(filter.offset ?? 0);
}

/** A grant the user can use to download `storageKey` right now: status=active,
 *  not expired, covers the file (asset by key/id, or project by projectId), and
 *  not yet consumed for this storageKey. Returns the first such grant. */
export async function findUsableDownloadGrant(input: { userId: number; storageKey: string; assetId?: number | null; projectId?: number | null }): Promise<DownloadGrant | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devFindUsableDownloadGrant(input); return null; }
  const now = new Date();
  const candidates = await db.select().from(downloadGrants)
    .where(and(eq(downloadGrants.userId, input.userId), eq(downloadGrants.status, "active")));
  const consumed = await db.select({ grantId: downloadConsumptions.grantId })
    .from(downloadConsumptions).where(eq(downloadConsumptions.storageKey, input.storageKey));
  const consumedSet = new Set(consumed.map((c) => c.grantId));
  for (const g of candidates) {
    if (g.expiresAt && g.expiresAt.getTime() < now.getTime()) continue;
    if (consumedSet.has(g.id)) continue;
    const covers = g.scope === "asset"
      ? (g.storageKey === input.storageKey || (input.assetId != null && g.assetId === input.assetId))
      : (input.projectId != null && g.projectId === input.projectId);
    if (covers) return g;
  }
  return null;
}

/** Atomically consume a grant for a file. Returns true the first time, false if
 *  already consumed (DB unique (grantId, storageKey) makes this race-safe). */
export async function consumeDownloadGrant(grantId: number, userId: number, storageKey: string, assetId?: number | null): Promise<boolean> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devConsumeDownloadGrant(grantId, userId, storageKey, assetId ?? null); throw new Error("DB unavailable"); }
  try {
    await db.insert(downloadConsumptions).values({ grantId, userId, storageKey, assetId: assetId ?? null });
    return true;
  } catch {
    return false; // unique violation → already consumed
  }
}

// ── Video Tasks ───────────────────────────────────────────────────────────────

export async function createVideoTask(data: InsertVideoTask) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devCreateVideoTask(data); throw new Error("DB unavailable"); }
  const [header] = await db.insert(videoTasks).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(videoTasks).where(eq(videoTasks.id, insertId));
  return rows[0] ?? null;
}

export async function getVideoTask(id: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetVideoTask(id) : undefined;
  const result = await db.select().from(videoTasks).where(eq(videoTasks.id, id)).limit(1);
  return result[0];
}

export async function getVideoTasksByProject(projectId: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetVideoTasksByProject(projectId) : [];
  return db.select().from(videoTasks).where(eq(videoTasks.projectId, projectId)).orderBy(desc(videoTasks.createdAt));
}

/**
 * Find an in-flight (pending or processing) video task for a given (userId, projectId, nodeId).
 * Used as a server-side idempotency check so a bypassed client can't double-charge by
 * submitting two `videoTasks.create` calls for the same node while one is still running.
 */
export async function findInFlightVideoTask(projectId: number, nodeId: string) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devFindInFlightVideoTask(projectId, nodeId) : undefined;
  // Project-scoped (not user-scoped): any editor's in-flight task on this
  // node blocks new submissions, so the project owner can't double-charge
  // on top of a collaborator's pending task and vice versa.
  const rows = await db
    .select()
    .from(videoTasks)
    .where(
      and(
        eq(videoTasks.projectId, projectId),
        eq(videoTasks.nodeId, nodeId),
        sql`${videoTasks.status} in ('pending', 'processing')`
      )
    )
    .orderBy(desc(videoTasks.createdAt))
    .limit(1);
  return rows[0];
}

export async function updateVideoTask(id: number, data: Partial<InsertVideoTask>) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devUpdateVideoTask(id, data); return; } throw new Error("DB unavailable"); }
  await db.update(videoTasks).set(data).where(eq(videoTasks.id, id));
}

/**
 * Atomically transition a task from `pending` → `processing`, returning true
 * iff this caller successfully claimed the task. Used as a mutex around
 * upstream provider submission to prevent duplicate paid submissions:
 *
 * - The router's `videoTasks.create` and the background poller both submit
 *   `pending` tasks. Without locking, a transient DB-write failure after a
 *   successful upstream submit (e.g. brief connection blip while saving the
 *   external task id) would leave the task in `pending`, causing the next
 *   poller cycle 10s later to call `submitPoyoVideo` again — burning credits
 *   on a duplicate job, repeatedly, every 10s until the row finally updates.
 *
 * - With the claim: only one caller can transition pending→processing. The
 *   loser sees `false` and skips, even if the row hasn't yet had its
 *   externalTaskId saved by the winner.
 *
 * Implementation: conditional UPDATE WHERE status='pending'. MySQL returns
 * affectedRows=1 if the row matched, 0 otherwise. drizzle/mysql2 exposes
 * affectedRows on the result header.
 */
export async function claimVideoTaskForSubmit(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    if (DEV_MODE) return dev.devClaimVideoTaskForSubmit(id);
    throw new Error("DB unavailable");
  }
  const result = await db
    .update(videoTasks)
    .set({ status: "processing" })
    .where(and(eq(videoTasks.id, id), eq(videoTasks.status, "pending")));
  // mysql2 wraps the result; affectedRows lives on either the array head or the OkPacket
  const header = Array.isArray(result) ? result[0] : result;
  const affected = (header as { affectedRows?: number })?.affectedRows ?? 0;
  return affected === 1;
}

export async function deleteVideoTask(id: number) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devDeleteVideoTask(id); return; } throw new Error("DB unavailable"); }
  await db.delete(videoTasks).where(eq(videoTasks.id, id));
}

export async function getPendingVideoTasks() {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetPendingVideoTasks() : [];
  return db
    .select()
    .from(videoTasks)
    .where(inArray(videoTasks.status, ["pending", "processing"]))
    .limit(200);
}

// ── Chat Messages ─────────────────────────────────────────────────────────────

export async function getChatMessages(nodeId: string, projectId: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetChatMessages(nodeId, projectId) : [];
  return db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.nodeId, nodeId), eq(chatMessages.projectId, projectId)))
    .orderBy(chatMessages.createdAt);
}

export async function addChatMessage(data: InsertChatMessage) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devAddChatMessage(data); throw new Error("DB unavailable"); }
  const [result] = await db.insert(chatMessages).values(data);
  return result;
}

export async function addChatMessagePair(
  nodeId: string,
  projectId: number,
  userContent: string,
  assistantContent: string,
  userAttachments?: unknown,
) {
  const db = await getDb();
  if (!db) {
    if (DEV_MODE) {
      await dev.devAddChatMessage({ nodeId, projectId, role: "user", content: userContent, attachments: userAttachments ?? null });
      await dev.devAddChatMessage({ nodeId, projectId, role: "assistant", content: assistantContent });
      return;
    }
    throw new Error("DB unavailable");
  }
  await db.transaction(async (tx) => {
    await tx.insert(chatMessages).values({ nodeId, projectId, role: "user", content: userContent, attachments: userAttachments ?? null });
    await tx.insert(chatMessages).values({ nodeId, projectId, role: "assistant", content: assistantContent });
  });
}

export async function clearChatMessages(nodeId: string, projectId: number) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devClearChatMessages(nodeId, projectId); return; } throw new Error("DB unavailable"); }
  await db
    .delete(chatMessages)
    .where(and(eq(chatMessages.nodeId, nodeId), eq(chatMessages.projectId, projectId)));
}

// ── Whitelist ─────────────────────────────────────────────────────────────────

export async function getWhitelistSettings() {
  const db = await getDb();
  if (!db) return devWhitelistSettings;
  const rows = await db.select().from(whitelistSettings).limit(1);
  return rows[0] ?? null;
}

export async function setWhitelistEnabled(enabled: boolean): Promise<void> {
  const db = await getDb();
  if (!db) { devWhitelistSettings.enabled = enabled; return; }
  // Upsert row id=1 atomically — avoids TOCTOU race and ensures WHERE clause is always scoped.
  await db.insert(whitelistSettings).values({ id: 1, enabled })
    .onDuplicateKeyUpdate({ set: { enabled } });
}

export async function setWhitelistComfyuiBypass(comfyuiBypass: boolean): Promise<void> {
  const db = await getDb();
  if (!db) { devWhitelistSettings.comfyuiBypass = comfyuiBypass; return; }
  await db.insert(whitelistSettings).values({ id: 1, comfyuiBypass })
    .onDuplicateKeyUpdate({ set: { comfyuiBypass } });
}

export async function getWhitelistEntries() {
  const db = await getDb();
  if (!db) return [...devWhitelistEntries];
  return db.select().from(whitelistEntries).orderBy(whitelistEntries.createdAt);
}

// ── Storage persistence settings ────────────────────────────────────────────

export async function getStorageSettings(): Promise<{ persistAudio: boolean; persistVideo: boolean; persistImage: boolean; presignTtlSec: number; poyoUploadFallback: boolean; minioOnly: boolean; preferUpstreamRefSource: boolean; downloadAuthEnabled: boolean }> {
  const db = await getDb();
  if (!db) return {
    persistAudio: devStorageSettings.persistAudio,
    persistVideo: devStorageSettings.persistVideo,
    persistImage: devStorageSettings.persistImage,
    presignTtlSec: devStorageSettings.presignTtlSec,
    poyoUploadFallback: devStorageSettings.poyoUploadFallback,
    minioOnly: devStorageSettings.minioOnly,
    preferUpstreamRefSource: devStorageSettings.preferUpstreamRefSource,
    downloadAuthEnabled: devStorageSettings.downloadAuthEnabled,
  };
  const rows = await db.select().from(storageSettings).limit(1);
  const row = rows[0];
  return {
    persistAudio: row?.persistAudio ?? true,
    persistVideo: row?.persistVideo ?? true,
    persistImage: row?.persistImage ?? true,
    presignTtlSec: row?.presignTtlSec ?? 3600,
    poyoUploadFallback: row?.poyoUploadFallback ?? false,
    minioOnly: row?.minioOnly ?? true,
    preferUpstreamRefSource: row?.preferUpstreamRefSource ?? false,
    downloadAuthEnabled: row?.downloadAuthEnabled ?? false,
  };
}

export async function setStorageSettings(patch: { persistAudio?: boolean; persistVideo?: boolean; persistImage?: boolean; presignTtlSec?: number; poyoUploadFallback?: boolean; minioOnly?: boolean; preferUpstreamRefSource?: boolean; downloadAuthEnabled?: boolean }): Promise<void> {
  const db = await getDb();
  if (!db) {
    if (patch.persistAudio !== undefined) devStorageSettings.persistAudio = patch.persistAudio;
    if (patch.persistVideo !== undefined) devStorageSettings.persistVideo = patch.persistVideo;
    if (patch.persistImage !== undefined) devStorageSettings.persistImage = patch.persistImage;
    if (patch.presignTtlSec !== undefined) devStorageSettings.presignTtlSec = patch.presignTtlSec;
    if (patch.poyoUploadFallback !== undefined) devStorageSettings.poyoUploadFallback = patch.poyoUploadFallback;
    if (patch.minioOnly !== undefined) devStorageSettings.minioOnly = patch.minioOnly;
    if (patch.preferUpstreamRefSource !== undefined) devStorageSettings.preferUpstreamRefSource = patch.preferUpstreamRefSource;
    if (patch.downloadAuthEnabled !== undefined) devStorageSettings.downloadAuthEnabled = patch.downloadAuthEnabled;
    return;
  }
  const set: Record<string, boolean | number> = {};
  if (patch.persistAudio !== undefined) set.persistAudio = patch.persistAudio;
  if (patch.persistVideo !== undefined) set.persistVideo = patch.persistVideo;
  if (patch.persistImage !== undefined) set.persistImage = patch.persistImage;
  if (patch.presignTtlSec !== undefined) set.presignTtlSec = patch.presignTtlSec;
  if (patch.poyoUploadFallback !== undefined) set.poyoUploadFallback = patch.poyoUploadFallback;
  if (patch.minioOnly !== undefined) set.minioOnly = patch.minioOnly;
  if (patch.preferUpstreamRefSource !== undefined) set.preferUpstreamRefSource = patch.preferUpstreamRefSource;
  if (patch.downloadAuthEnabled !== undefined) set.downloadAuthEnabled = patch.downloadAuthEnabled;
  if (Object.keys(set).length === 0) return;
  // Upsert, not a bare UPDATE: the singleton settings row (id=1) is never
  // seeded by any migration on the journal's path (0013 creates the table
  // empty; 0015_consolidate_baseline only adds columns — the seed INSERT lives
  // in the orphan 0015_storage_settings.sql that never runs). A plain
  // `UPDATE ... WHERE id=1` therefore matches 0 rows and silently no-ops, so
  // every toggle / TTL change appears to do nothing. INSERT ... ON DUPLICATE
  // KEY UPDATE creates the row on first write and updates it thereafter.
  await db.insert(storageSettings).values({ id: 1, ...set }).onDuplicateKeyUpdate({ set });
}

export async function addWhitelistEntry(
  type: "ip" | "user",
  value: string,
  note: string | null,
  createdBy: number | null,
): Promise<void> {
  const db = await getDb();
  if (!db) {
    const id = devNextWhitelistId++;
    devWhitelistEntries.push({ id, type, value, note, createdBy, createdAt: new Date() });
    return;
  }
  // On duplicate (type, value) — preserve the existing entry unchanged (no-op update)
  await db.insert(whitelistEntries).values({ type, value, note, createdBy })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
}

export async function removeWhitelistEntry(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    const idx = devWhitelistEntries.findIndex(e => e.id === id);
    if (idx !== -1) { devWhitelistEntries.splice(idx, 1); return true; }
    return false;
  }
  const [result] = await db.delete(whitelistEntries).where(eq(whitelistEntries.id, id));
  return (result as { affectedRows?: number }).affectedRows !== 0;
}

export async function isWhitelisted(type: "ip" | "user", value: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return devWhitelistEntries.some(e => e.type === type && e.value === value);
  const rows = await db.select().from(whitelistEntries)
    .where(and(eq(whitelistEntries.type, type), eq(whitelistEntries.value, value)))
    .limit(1);
  return rows.length > 0;
}

// ── LAN Chat ─────────────────────────────────────────────────────────────────

export async function listLanChatRooms(networkGroupId: string): Promise<LanChatRoomRow[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListLanChatRooms(networkGroupId) : [];
  return db.select().from(lanChatRooms)
    .where(eq(lanChatRooms.networkGroupId, networkGroupId))
    .orderBy(lanChatRooms.id);
}

export async function createLanChatRoom(
  networkGroupId: string,
  name: string,
  passwordHash?: string | null,
): Promise<LanChatRoomRow | null> {
  const db = await getDb();
  if (!db) {
    if (DEV_MODE) return dev.devCreateLanChatRoom(networkGroupId, name, passwordHash ?? null);
    throw new Error("DB unavailable");
  }
  // INSERT IGNORE so callers can use createRoom as an "ensure exists" path.
  // Composite (networkGroupId, name) uniqueness key is enforced by the DB.
  // NOTE: re-creating a room with the same name does NOT overwrite the
  // existing passwordHash — protects against an attacker re-creating
  // a known-name private room to bypass its password.
  await db.insert(lanChatRooms).values({ networkGroupId, name, passwordHash: passwordHash ?? null })
    .onDuplicateKeyUpdate({ set: { name: sql`name` } });
  const rows = await db.select().from(lanChatRooms)
    .where(and(eq(lanChatRooms.networkGroupId, networkGroupId), eq(lanChatRooms.name, name)))
    .limit(1);
  return rows[0] ?? null;
}

/** Fetch a single room (used by enterRoom to read passwordHash). */
export async function getLanChatRoomById(roomId: number): Promise<LanChatRoomRow | null> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetLanChatRoomById(roomId) ?? null : null;
  const rows = await db.select().from(lanChatRooms).where(eq(lanChatRooms.id, roomId)).limit(1);
  return rows[0] ?? null;
}

/** Delete a room and its messages. */
export async function deleteLanChatRoom(roomId: number): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devDeleteLanChatRoom(roomId); return; } throw new Error("DB unavailable"); }
  await db.delete(lanChatMessages).where(eq(lanChatMessages.roomId, roomId));
  await db.delete(lanChatRooms).where(eq(lanChatRooms.id, roomId));
}

export async function insertLanChatMessage(data: InsertLanChatMessage): Promise<LanChatMessageRow | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devInsertLanChatMessage(data); throw new Error("DB unavailable"); }
  const [header] = await db.insert(lanChatMessages).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(lanChatMessages).where(eq(lanChatMessages.id, insertId)).limit(1);
  return rows[0] ?? null;
}

/** Fetch the most recent N messages in a room, or messages strictly older
 *  than `beforeId` when paginating up. Returns newest-first; the client
 *  reverses for display. */
export async function getLanChatMessages(roomId: number, opts: { beforeId?: number; limit: number }): Promise<LanChatMessageRow[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetLanChatMessages(roomId, opts) : [];
  const where = opts.beforeId
    ? and(eq(lanChatMessages.roomId, roomId), sql`${lanChatMessages.id} < ${opts.beforeId}`)
    : eq(lanChatMessages.roomId, roomId);
  return db.select().from(lanChatMessages)
    .where(where)
    .orderBy(desc(lanChatMessages.id))
    .limit(opts.limit);
}

// ── LAN Chat — admin audit helpers ───────────────────────────────────────────
// Cross-network reads (no networkGroupId filter) for the admin page only.
// These bypass the per-network isolation that the user-facing router enforces,
// so they MUST stay behind adminProcedure.

export async function listAllLanChatRooms(): Promise<LanChatRoomRow[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListAllLanChatRooms() : [];
  return db.select().from(lanChatRooms).orderBy(desc(lanChatRooms.id));
}

export async function getAllLanChatMessages(opts: {
  roomId?: number;
  search?: string;
  limit: number;
  offset: number;
}): Promise<{ rows: LanChatMessageRow[]; total: number }> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetAllLanChatMessages(opts) : { rows: [], total: 0 };
  const conds: ReturnType<typeof eq>[] = [];
  if (opts.roomId != null) conds.push(eq(lanChatMessages.roomId, opts.roomId));
  if (opts.search) conds.push(sql`${lanChatMessages.content} LIKE ${"%" + opts.search + "%"}`);
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  const [rows, countRows] = await Promise.all([
    db.select().from(lanChatMessages)
      .where(where)
      .orderBy(desc(lanChatMessages.id))
      .limit(opts.limit)
      .offset(opts.offset),
    db.select({ count: sql<number>`COUNT(*)` }).from(lanChatMessages).where(where),
  ]);
  return { rows, total: Number(countRows[0]?.count ?? 0) };
}

// ── LAN Chat — invites ──────────────────────────────────────────────────────

export async function createLanChatInvite(data: InsertLanChatInvite): Promise<LanChatInviteRow | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devCreateLanChatInvite(data); throw new Error("DB unavailable"); }
  await db.insert(lanChatInvites).values(data);
  const rows = await db.select().from(lanChatInvites).where(eq(lanChatInvites.code, data.code)).limit(1);
  return rows[0] ?? null;
}

export async function listLanChatInvites(): Promise<LanChatInviteRow[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListLanChatInvites() : [];
  return db.select().from(lanChatInvites).orderBy(desc(lanChatInvites.id));
}

/** Atomic single-use redeem. Returns the row iff the UPDATE actually
 *  flipped `usedAt` from NULL → NOW(). Concurrent redemptions on the
 *  same code: only the first one's UPDATE matches, the rest get null. */
export async function redeemLanChatInvite(
  code: string,
  by: { nickname: string; ip: string },
): Promise<LanChatInviteRow | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devRedeemLanChatInvite(code, by); throw new Error("DB unavailable"); }
  const result = await db
    .update(lanChatInvites)
    .set({ usedAt: new Date(), usedByNickname: by.nickname, usedByIp: by.ip })
    .where(and(
      eq(lanChatInvites.code, code),
      isNull(lanChatInvites.usedAt),
      sql`${lanChatInvites.expiresAt} > NOW()`,
    ));
  const header = Array.isArray(result) ? result[0] : result;
  const affected = (header as { affectedRows?: number })?.affectedRows ?? 0;
  if (affected === 0) return null;
  const rows = await db.select().from(lanChatInvites).where(eq(lanChatInvites.code, code)).limit(1);
  return rows[0] ?? null;
}

// ── LAN Chat — IP whitelist + settings ──────────────────────────────────────

export async function getLanChatSettings(): Promise<LanChatSettingsRow> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetLanChatSettings() : { id: 1, ipWhitelistEnabled: false, updatedAt: new Date() };
  const rows = await db.select().from(lanChatSettings).where(eq(lanChatSettings.id, 1)).limit(1);
  return rows[0] ?? { id: 1, ipWhitelistEnabled: false, updatedAt: new Date() };
}

export async function setLanChatIpWhitelistEnabled(enabled: boolean): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devSetLanChatIpWhitelistEnabled(enabled); return; }
  await db.insert(lanChatSettings).values({ id: 1, ipWhitelistEnabled: enabled })
    .onDuplicateKeyUpdate({ set: { ipWhitelistEnabled: enabled } });
}

export async function listLanChatIpWhitelist(): Promise<LanChatIpWhitelistRow[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListLanChatIpWhitelist() : [];
  return db.select().from(lanChatIpWhitelist).orderBy(desc(lanChatIpWhitelist.id));
}

export async function addLanChatIpWhitelist(data: InsertLanChatIpWhitelist): Promise<LanChatIpWhitelistRow | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devAddLanChatIpWhitelist(data); throw new Error("DB unavailable"); }
  await db.insert(lanChatIpWhitelist).values(data).onDuplicateKeyUpdate({ set: { ip: sql`ip` } });
  const rows = await db.select().from(lanChatIpWhitelist).where(eq(lanChatIpWhitelist.ip, data.ip)).limit(1);
  return rows[0] ?? null;
}

export async function removeLanChatIpWhitelist(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devRemoveLanChatIpWhitelist(id) : false;
  const [result] = await db.delete(lanChatIpWhitelist).where(eq(lanChatIpWhitelist.id, id));
  return (result as { affectedRows?: number }).affectedRows !== 0;
}

export async function isIpInLanChatWhitelist(ip: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devIsIpInLanChatWhitelist(ip) : false;
  const rows = await db.select().from(lanChatIpWhitelist).where(eq(lanChatIpWhitelist.ip, ip)).limit(1);
  return rows.length > 0;
}

// ── Audit Logs ────────────────────────────────────────────────────────────────

// Dev-mode in-memory audit log (typed with id so UI keys work correctly)
type DevAuditLog = typeof auditLogs.$inferSelect;
const devAuditLogs: DevAuditLog[] = [];
let devAuditLogId = 1;

export async function insertAuditLog(data: InsertAuditLog): Promise<void> {
  const db = await getDb();
  if (!db) {
    devAuditLogs.unshift({ ...data, id: devAuditLogId++, createdAt: new Date() } as DevAuditLog);
    if (devAuditLogs.length > 500) devAuditLogs.pop();
    return;
  }
  await db.insert(auditLogs).values(data);
}

export async function getAuditLogs(opts: {
  limit?: number;
  offset?: number;
  action?: string;
}): Promise<{ rows: typeof auditLogs.$inferSelect[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const db = await getDb();

  if (!db) {
    const filtered = opts.action
      ? devAuditLogs.filter((l) => l.action === opts.action)
      : devAuditLogs;
    return {
      rows: filtered.slice(offset, offset + limit) as typeof auditLogs.$inferSelect[],
      total: filtered.length,
    };
  }

  const where = opts.action ? eq(auditLogs.action, opts.action) : undefined;

  const [rows, countRows] = await Promise.all([
    db.select().from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`COUNT(*)` }).from(auditLogs).where(where),
  ]);

  return { rows, total: Number(countRows[0]?.count ?? 0) };
}

export async function clearAuditLogs(): Promise<void> {
  const db = await getDb();
  if (!db) { devAuditLogs.splice(0); return; }
  await db.delete(auditLogs);
}

// ── Poyo balance snapshots ──────────────────────────────────────────────────

type DevPoyoSnapshot = typeof poyoBalanceSnapshots.$inferSelect;
const devPoyoSnapshots: DevPoyoSnapshot[] = []; // newest first
let devPoyoSnapshotId = 1;

/**
 * Insert a balance snapshot, but only if the most recent one is older than
 * `windowMs` — Poyo balance is polled frequently (every ~5 min by every client)
 * so this throttle prevents the table from ballooning. Returns whether a row
 * was actually written.
 */
export async function insertPoyoBalanceSnapshotThrottled(
  data: { creditsAmount: number; email?: string | null },
  windowMs = 5 * 60_000,
): Promise<boolean> {
  const now = Date.now();
  const db = await getDb();
  if (!db) {
    const last = devPoyoSnapshots[0];
    if (last && now - last.createdAt.getTime() < windowMs) return false;
    devPoyoSnapshots.unshift({
      id: devPoyoSnapshotId++,
      creditsAmount: data.creditsAmount,
      email: data.email ?? null,
      createdAt: new Date(),
    } as DevPoyoSnapshot);
    if (devPoyoSnapshots.length > 500) devPoyoSnapshots.pop();
    return true;
  }
  const lastRows = await db.select({ createdAt: poyoBalanceSnapshots.createdAt })
    .from(poyoBalanceSnapshots)
    .orderBy(desc(poyoBalanceSnapshots.createdAt))
    .limit(1);
  const last = lastRows[0];
  if (last && now - last.createdAt.getTime() < windowMs) return false;
  await db.insert(poyoBalanceSnapshots).values({ creditsAmount: data.creditsAmount, email: data.email ?? null });
  return true;
}

export async function getRecentPoyoBalanceSnapshots(
  limit = 50,
): Promise<Array<{ creditsAmount: number; email: string | null; at: Date }>> {
  const db = await getDb();
  if (!db) {
    return devPoyoSnapshots.slice(0, limit).map((r) => ({ creditsAmount: r.creditsAmount, email: r.email, at: r.createdAt }));
  }
  const rows = await db.select().from(poyoBalanceSnapshots)
    .orderBy(desc(poyoBalanceSnapshots.createdAt))
    .limit(limit);
  return rows.map((r) => ({ creditsAmount: r.creditsAmount, email: r.email, at: r.createdAt }));
}

// ── Account-based Chat (rewrite) ────────────────────────────────────────────────

export async function getOrCreateLobby(): Promise<ChatConversation> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devGetOrCreateLobby(); throw new Error("DB unavailable"); }
  const existing = await db.select().from(chatConversations).where(eq(chatConversations.type, "lobby")).limit(1);
  if (existing[0]) return existing[0];
  const [header] = await db.insert(chatConversations).values({ type: "lobby", mode: "server", title: "大厅" });
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(chatConversations).where(eq(chatConversations.id, insertId)).limit(1);
  return rows[0]!;
}

export async function createConversation(data: InsertChatConversation): Promise<ChatConversation> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devCreateConversation(data); throw new Error("DB unavailable"); }
  const [header] = await db.insert(chatConversations).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(chatConversations).where(eq(chatConversations.id, insertId)).limit(1);
  return rows[0]!;
}

export async function getConversationById(id: number): Promise<ChatConversation | undefined> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetConversationById(id) : undefined;
  const rows = await db.select().from(chatConversations).where(eq(chatConversations.id, id)).limit(1);
  return rows[0];
}

export async function getConversationByDmKey(dmKey: string): Promise<ChatConversation | undefined> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetConversationByDmKey(dmKey) : undefined;
  const rows = await db.select().from(chatConversations).where(eq(chatConversations.dmKey, dmKey)).limit(1);
  return rows[0];
}

export async function updateConversation(id: number, patch: Partial<InsertChatConversation>): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devUpdateConversation(id, patch as Partial<ChatConversation>); return; }
  await db.update(chatConversations).set(patch).where(eq(chatConversations.id, id));
}

export async function deleteConversation(id: number): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devDeleteConversation(id); return; }
  await db.delete(conversationMessages).where(eq(conversationMessages.conversationId, id));
  await db.delete(chatAttachments).where(eq(chatAttachments.conversationId, id));
  await db.delete(chatMembers).where(eq(chatMembers.conversationId, id));
  await db.delete(chatConversations).where(eq(chatConversations.id, id));
}

export async function addChatMember(conversationId: number, userId: number, role: "owner" | "member"): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devAddMember(conversationId, userId, role); return; }
  // Idempotent insert: ignore if (conversationId,userId) already exists.
  await db.insert(chatMembers).values({ conversationId, userId, role })
    .onDuplicateKeyUpdate({ set: { role } });
}

export async function removeChatMember(conversationId: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devRemoveMember(conversationId, userId); return; }
  await db.delete(chatMembers).where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.userId, userId)));
}

export async function listChatMembers(conversationId: number): Promise<ChatMember[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListMembers(conversationId) : [];
  return db.select().from(chatMembers).where(eq(chatMembers.conversationId, conversationId));
}

export async function isChatMember(conversationId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devIsMember(conversationId, userId) : false;
  const conv = await getConversationById(conversationId);
  if (conv?.type === "lobby") return true;
  const rows = await db.select().from(chatMembers)
    .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.userId, userId))).limit(1);
  return !!rows[0];
}

export async function listConversationsForUser(userId: number): Promise<ChatConversation[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListConversationsForUser(userId) : [];
  const memberRows = await db.select({ conversationId: chatMembers.conversationId }).from(chatMembers).where(eq(chatMembers.userId, userId));
  const ids = memberRows.map((r) => r.conversationId);
  const lobby = await db.select().from(chatConversations).where(eq(chatConversations.type, "lobby"));
  const memberConvs = ids.length ? await db.select().from(chatConversations).where(inArray(chatConversations.id, ids)) : [];
  const merged = new Map<number, ChatConversation>();
  for (const c of [...lobby, ...memberConvs]) merged.set(c.id, c);
  return Array.from(merged.values()).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/** Group rooms the user is NOT yet a member of — used for room discovery/join. */
export async function listJoinableGroups(userId: number): Promise<ChatConversation[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListJoinableGroups(userId) : [];
  const memberRows = await db.select({ conversationId: chatMembers.conversationId }).from(chatMembers).where(eq(chatMembers.userId, userId));
  const ids = new Set(memberRows.map((r) => r.conversationId));
  const groups = await db.select().from(chatConversations).where(eq(chatConversations.type, "group"));
  return groups.filter((g) => !ids.has(g.id)).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export async function updateLastRead(conversationId: number, userId: number, messageId: number): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devUpdateLastRead(conversationId, userId, messageId); return; }
  await db.update(chatMembers).set({ lastReadMessageId: messageId })
    .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.userId, userId), sql`${chatMembers.lastReadMessageId} < ${messageId}`));
}

export async function insertConversationMessage(data: InsertConversationMessage): Promise<ConversationMessage | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devInsertChatMessage(data); throw new Error("DB unavailable"); }
  const [header] = await db.insert(conversationMessages).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  await db.update(chatConversations).set({ updatedAt: new Date() }).where(eq(chatConversations.id, data.conversationId));
  const rows = await db.select().from(conversationMessages).where(eq(conversationMessages.id, insertId)).limit(1);
  return rows[0] ?? null;
}

export async function getConversationMessages(conversationId: number, opts: { beforeId?: number; limit: number }): Promise<ConversationMessage[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetChatMessagesPage(conversationId, opts) : [];
  const conds = [eq(conversationMessages.conversationId, conversationId)];
  if (opts.beforeId != null) conds.push(sql`${conversationMessages.id} < ${opts.beforeId}`);
  return db.select().from(conversationMessages).where(and(...conds)).orderBy(desc(conversationMessages.id)).limit(opts.limit);
}

export async function getConversationMessageById(id: number): Promise<ConversationMessage | undefined> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetChatMessageById(id) : undefined;
  const rows = await db.select().from(conversationMessages).where(eq(conversationMessages.id, id)).limit(1);
  return rows[0];
}

export async function deleteConversationMessage(id: number): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devDeleteChatMessage(id); return; }
  await db.delete(conversationMessages).where(eq(conversationMessages.id, id));
}

export async function insertChatAttachment(data: InsertChatAttachment): Promise<ChatAttachment | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devInsertChatAttachment(data); throw new Error("DB unavailable"); }
  const [header] = await db.insert(chatAttachments).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(chatAttachments).where(eq(chatAttachments.id, insertId)).limit(1);
  return rows[0] ?? null;
}

export async function linkAttachmentsToMessage(messageId: number, attachmentIds: number[]): Promise<void> {
  if (!attachmentIds.length) return;
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devLinkAttachments(messageId, attachmentIds); return; }
  await db.update(chatAttachments).set({ messageId }).where(inArray(chatAttachments.id, attachmentIds));
}

export async function listConversationAttachments(conversationId: number): Promise<ChatAttachment[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListConversationAttachments(conversationId) : [];
  return db.select().from(chatAttachments).where(eq(chatAttachments.conversationId, conversationId)).orderBy(desc(chatAttachments.id));
}

export async function upsertUserPublicKey(userId: number, jwk: unknown): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devUpsertUserPublicKey(userId, jwk); return; }
  await db.insert(chatUserKeys).values({ userId, publicKeyJwk: jwk })
    .onDuplicateKeyUpdate({ set: { publicKeyJwk: jwk, updatedAt: new Date() } });
}

export async function getUserPublicKeys(userIds: number[]): Promise<{ userId: number; publicKeyJwk: unknown }[]> {
  if (!userIds.length) return [];
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetUserPublicKeys(userIds) : [];
  const rows = await db.select().from(chatUserKeys).where(inArray(chatUserKeys.userId, userIds));
  return rows.map((r) => ({ userId: r.userId, publicKeyJwk: r.publicKeyJwk }));
}

export async function addChatBan(data: InsertChatBan): Promise<ChatBan | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devAddBan(data); throw new Error("DB unavailable"); }
  const [header] = await db.insert(chatBans).values(data)
    .onDuplicateKeyUpdate({ set: { reason: data.reason ?? null, bannedBy: data.bannedBy } });
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(chatBans).where(eq(chatBans.id, insertId)).limit(1);
  return rows[0] ?? null;
}

export async function removeChatBan(id: number): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devRemoveBan(id); return; }
  await db.delete(chatBans).where(eq(chatBans.id, id));
}

export async function listChatBans(): Promise<ChatBan[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListBans() : [];
  return db.select().from(chatBans).orderBy(desc(chatBans.id));
}

export async function isChatBanned(userId: number, conversationId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devIsBanned(userId, conversationId) : false;
  const rows = await db.select().from(chatBans).where(and(
    eq(chatBans.userId, userId),
    sql`(${chatBans.scope} = 'global' OR ${chatBans.conversationId} = ${conversationId})`,
  )).limit(1);
  return !!rows[0];
}

export async function adminListConversations(opts: { type?: string; mode?: string; limit: number; offset: number }): Promise<{ rows: ChatConversation[]; total: number }> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListAllConversations(opts) : { rows: [], total: 0 };
  const conds = [];
  if (opts.type) conds.push(eq(chatConversations.type, opts.type as ChatConversation["type"]));
  if (opts.mode) conds.push(eq(chatConversations.mode, opts.mode as ChatConversation["mode"]));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select().from(chatConversations).where(where).orderBy(desc(chatConversations.id)).limit(opts.limit).offset(opts.offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(chatConversations).where(where);
  return { rows, total: Number(count) };
}

export async function adminSearchMessages(opts: { userId?: number; conversationId?: number; keyword?: string; dateFrom?: Date; dateTo?: Date; limit: number; offset: number }): Promise<{ rows: ConversationMessage[]; total: number }> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devAdminSearchMessages(opts) : { rows: [], total: 0 };
  const conds = [];
  if (opts.userId != null) conds.push(eq(conversationMessages.senderId, opts.userId));
  if (opts.conversationId != null) conds.push(eq(conversationMessages.conversationId, opts.conversationId));
  if (opts.keyword) conds.push(sql`${conversationMessages.content} LIKE ${"%" + opts.keyword + "%"}`);
  if (opts.dateFrom) conds.push(sql`${conversationMessages.createdAt} >= ${opts.dateFrom}`);
  if (opts.dateTo) conds.push(sql`${conversationMessages.createdAt} <= ${opts.dateTo}`);
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select().from(conversationMessages).where(where).orderBy(desc(conversationMessages.id)).limit(opts.limit).offset(opts.offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(conversationMessages).where(where);
  return { rows, total: Number(count) };
}

export async function adminListAttachments(opts: { conversationId?: number; limit: number; offset: number }): Promise<{ rows: ChatAttachment[]; total: number }> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListAllAttachments(opts) : { rows: [], total: 0 };
  const where = opts.conversationId != null ? eq(chatAttachments.conversationId, opts.conversationId) : undefined;
  const rows = await db.select().from(chatAttachments).where(where).orderBy(desc(chatAttachments.id)).limit(opts.limit).offset(opts.offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(chatAttachments).where(where);
  return { rows, total: Number(count) };
}

export async function getChatSettings(): Promise<ChatSettingsRow> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devGetChatSettings(); throw new Error("DB unavailable"); }
  const rows = await db.select().from(chatSettings).where(eq(chatSettings.id, 1)).limit(1);
  if (rows[0]) return rows[0];
  await db.insert(chatSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const again = await db.select().from(chatSettings).where(eq(chatSettings.id, 1)).limit(1);
  return again[0]!;
}

export async function setChatSettings(patch: Partial<Pick<ChatSettingsRow, "serverlessAllowed" | "lobbyEnabled" | "maxFileMb">>): Promise<ChatSettingsRow> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devSetChatSettings(patch); throw new Error("DB unavailable"); }
  await db.insert(chatSettings).values({ id: 1, ...patch }).onDuplicateKeyUpdate({ set: patch });
  return getChatSettings();
}

/** Search users by name/email for starting DMs or inviting (capped, excludes self). */
export async function searchUsersForChat(q: string, excludeUserId: number, limit = 20): Promise<{ id: number; name: string | null; email: string | null }[]> {
  const db = await getDb();
  if (!db) {
    if (DEV_MODE) return [{ id: 2, name: "Dev User 2", email: "dev2@localhost" }].filter((u) => u.id !== excludeUserId && (`${u.name}${u.email}`).toLowerCase().includes(q.toLowerCase()));
    return [];
  }
  const like = "%" + q + "%";
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users)
    .where(and(sql`(${users.name} LIKE ${like} OR ${users.email} LIKE ${like})`, sql`${users.id} <> ${excludeUserId}`))
    .limit(limit);
  return rows;
}
