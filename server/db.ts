import { eq, and, desc, sql, inArray, isNull } from "drizzle-orm";
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
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import * as dev from "./_core/devStore";

// Dev-mode whitelist state
const devWhitelistSettings = { id: 1, enabled: false, updatedAt: new Date() };
const devStorageSettings = { id: 1, persistAudio: true, persistVideo: true, persistImage: true, updatedAt: new Date() };
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
    // Email-match only counts for OAuth accounts (loginMethod !== "email") to
    // prevent someone from registering the owner address via the email-auth form.
    const isOwnerById = ENV.ownerOpenId && user.openId === ENV.ownerOpenId;
    const isOwnerByEmail =
      ENV.ownerEmail &&
      user.email?.toLowerCase() === ENV.ownerEmail.toLowerCase() &&
      user.loginMethod !== "email";
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

export async function deleteNode(id: string, projectId: number) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devDeleteNode(id, projectId); return; } throw new Error("DB unavailable"); }
  await db.delete(canvasNodes).where(and(eq(canvasNodes.id, id), eq(canvasNodes.projectId, projectId)));
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

export async function getAssetsByUser(userId: number, projectId?: number) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetAssetsByUser(userId, projectId) : [];
  if (projectId !== undefined) {
    return db
      .select()
      .from(assets)
      .where(and(eq(assets.userId, userId), eq(assets.projectId, projectId)))
      .orderBy(desc(assets.createdAt));
  }
  return db.select().from(assets).where(eq(assets.userId, userId)).orderBy(desc(assets.createdAt));
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
  await db.delete(assets).where(and(eq(assets.id, id), eq(assets.userId, userId)));
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

export async function getWhitelistEntries() {
  const db = await getDb();
  if (!db) return [...devWhitelistEntries];
  return db.select().from(whitelistEntries).orderBy(whitelistEntries.createdAt);
}

// ── Storage persistence settings ────────────────────────────────────────────

export async function getStorageSettings(): Promise<{ persistAudio: boolean; persistVideo: boolean; persistImage: boolean }> {
  const db = await getDb();
  if (!db) return {
    persistAudio: devStorageSettings.persistAudio,
    persistVideo: devStorageSettings.persistVideo,
    persistImage: devStorageSettings.persistImage,
  };
  const rows = await db.select().from(storageSettings).limit(1);
  const row = rows[0];
  return {
    persistAudio: row?.persistAudio ?? true,
    persistVideo: row?.persistVideo ?? true,
    persistImage: row?.persistImage ?? true,
  };
}

export async function setStorageSettings(patch: { persistAudio?: boolean; persistVideo?: boolean; persistImage?: boolean }): Promise<void> {
  const db = await getDb();
  if (!db) {
    if (patch.persistAudio !== undefined) devStorageSettings.persistAudio = patch.persistAudio;
    if (patch.persistVideo !== undefined) devStorageSettings.persistVideo = patch.persistVideo;
    if (patch.persistImage !== undefined) devStorageSettings.persistImage = patch.persistImage;
    return;
  }
  const set: Record<string, boolean> = {};
  if (patch.persistAudio !== undefined) set.persistAudio = patch.persistAudio;
  if (patch.persistVideo !== undefined) set.persistVideo = patch.persistVideo;
  if (patch.persistImage !== undefined) set.persistImage = patch.persistImage;
  if (Object.keys(set).length === 0) return;
  await db.update(storageSettings).set(set).where(eq(storageSettings.id, 1));
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
