import { eq, and, desc, sql, or, gt, inArray, isNull } from "drizzle-orm";
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
    // Lowercase the email at write time so eq() lookups match regardless of
    // the MySQL collation (default ci collation hides this; binary collation
    // would expose the case-sensitivity bug — make it consistent at the
    // application layer rather than relying on a server config).
    const normalized = field === "email" && typeof value === "string" ? value.toLowerCase() : value ?? null;
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

/** Claim pending email invites for a user that just registered/logged in. */
export async function claimPendingInvitations(email: string, userId: number) {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devClaimPendingCollaboratorsByEmail(email, userId); return; } return; }
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
  const result = await db
    .update(projectShareLinks)
    .set({ usesCount: sql`${projectShareLinks.usesCount} + 1` })
    .where(and(
      eq(projectShareLinks.id, id),
      isNull(projectShareLinks.revokedAt),
      gt(projectShareLinks.expiresAt, new Date()),
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
  const { inArray } = await import("drizzle-orm");
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

// In-memory probe: whether the persistImage column exists on the deployed
// DB. Probed lazily on first read and cached for the process lifetime so a
// missing column doesn't trigger a DB error on every getStorageSettings()
// call. Reset to null if you want to re-probe (e.g. after running migration).
let _persistImageColumnExists: boolean | null = null;

async function probePersistImageColumn(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<boolean> {
  if (_persistImageColumnExists !== null) return _persistImageColumnExists;
  try {
    // INFORMATION_SCHEMA is the cheapest, safest way to ask "does this column
    // exist?" without triggering a SELECT/UPDATE that errors out.
    const rows = await db
      .select({ name: sql<string>`COLUMN_NAME` })
      .from(sql`INFORMATION_SCHEMA.COLUMNS`)
      .where(sql`TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storageSettings' AND COLUMN_NAME = 'persistImage'`);
    _persistImageColumnExists = Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    // Don't cache failure — connection may recover later; just assume missing
    // for this call and re-probe next time.
    console.warn("[storageSettings] probePersistImageColumn failed:", err instanceof Error ? err.message : err);
    return false;
  }
  return _persistImageColumnExists;
}

export async function getStorageSettings(): Promise<{ persistAudio: boolean; persistVideo: boolean; persistImage: boolean }> {
  const db = await getDb();
  if (!db) return {
    persistAudio: devStorageSettings.persistAudio,
    persistVideo: devStorageSettings.persistVideo,
    persistImage: devStorageSettings.persistImage,
  };
  const rows = await db.select().from(storageSettings).limit(1);
  const row = rows[0];

  // Read persistImage only if the column exists. Default to ON otherwise —
  // matches the pre-feature behaviour of always persisting images.
  let persistImage = true;
  if (await probePersistImageColumn(db)) {
    try {
      const result = await db
        .select({ persistImage: sql<number | boolean>`persistImage` })
        .from(storageSettings)
        .where(eq(storageSettings.id, 1))
        .limit(1);
      const v = result[0]?.persistImage;
      if (v != null) persistImage = Boolean(v);
    } catch (err) {
      console.warn("[storageSettings] read persistImage failed:", err instanceof Error ? err.message : err);
    }
  }

  return {
    persistAudio: row?.persistAudio ?? true,
    persistVideo: row?.persistVideo ?? true,
    persistImage,
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

  // Write audio/video via drizzle ORM (these columns always exist).
  // The previous shape used INSERT … ON DUPLICATE KEY UPDATE which re-reads
  // current settings — that path was broken when persistImage read threw,
  // bricking audio/video toggles too. Now both branches are isolated and
  // audio/video uses a plain UPDATE against the seeded singleton (id=1).
  if (patch.persistAudio !== undefined || patch.persistVideo !== undefined) {
    await db.update(storageSettings).set({
      ...(patch.persistAudio !== undefined ? { persistAudio: patch.persistAudio } : {}),
      ...(patch.persistVideo !== undefined ? { persistVideo: patch.persistVideo } : {}),
    }).where(eq(storageSettings.id, 1));
  }

  // Write persistImage via raw SQL only if the column exists. If not, surface
  // a clear "please run pnpm db:push" message instead of MySQL's cryptic
  // "Unknown column 'persistImage' in 'field list'".
  if (patch.persistImage !== undefined) {
    if (!(await probePersistImageColumn(db))) {
      throw new Error(
        "持久化图像功能需要先在服务端执行 `pnpm db:push`（应用 migration 0017_add_persist_image.sql）。",
      );
    }
    try {
      // The column isn't in the drizzle schema (we deliberately omit it for
      // backward compat — see schema.ts note), so .update().set() can't
      // express it. db.execute with a raw SQL template is the supported way.
      await db.execute(
        sql`UPDATE storageSettings SET persistImage = ${patch.persistImage} WHERE id = 1`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unknown column/i.test(msg) || /persistImage/.test(msg)) {
        // Probe said the column exists but write failed with column error —
        // re-probe next call in case it was a transient miscount.
        _persistImageColumnExists = null;
        throw new Error(
          "持久化图像列尚未创建。请先在服务端执行 `pnpm db:push` 应用 migration 0017_add_persist_image.sql。",
        );
      }
      throw err;
    }
  }
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
