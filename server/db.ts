import { eq, and, or, desc, sql, inArray, isNull, like, count, gte } from "drizzle-orm";
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
  canvasAgentSessions,
  notifyWebhooks,
  type CanvasAgentTurn,
  whitelistSettings,
  comfySettings,
  whitelistEntries,
  kieApiKeys,
  kieKeyBindings,
  kieBalanceSnapshots,
  storageSettings,
  modelToggleSettings,
  tunnelSettings,
  authSettings,
  type SelfHostedLlmConfig,
  type BridgeMcpConfig,
  auditLogs,
  comfyUsageLogs,
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
  InsertComfyUsageLog,
  InsertProjectCollaborator,
  ProjectCollaborator,
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
  chatRoomKeys,
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
  editSessions,
  type EditSession,
  type InsertEditSession,
  comfyNodeTemplates,
  type ComfyNodeTemplateRow,
  type InsertComfyNodeTemplate,
  characterLibrary,
  type CharacterLibraryRow,
  type InsertCharacterLibrary,
  promptLibrary,
  type PromptLibraryRow,
  type InsertPromptLibrary,
  userPrefs,
  comfyTemplateAnalysis,
  type ComfyTemplateAnalysisRow,
  type InsertComfyTemplateAnalysis,
  comfyStressHistory,
  type ComfyStressHistoryRow,
  comfyStressTemplates,
  type ComfyStressTemplateRow,
  comfyOpsServers,
  type ComfyOpsServer,
  type InsertComfyOpsServer,
  comfyOpsScripts,
  type ComfyOpsScript,
  type InsertComfyOpsScript,
  comfyOpsRecords,
  type ComfyOpsRecord,
  type InsertComfyOpsRecord,
  comfyOpsSettings,
  type ComfyOpsSettings,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import * as dev from "./_core/devStore";
import { normalizeSystemDefaultModels } from "../shared/nodeDefaultModels";

/** True for a MySQL duplicate-key violation (ER_DUP_ENTRY / errno 1062), raised when
 *  an INSERT hits a UNIQUE index — used to turn unique-constraint races into
 *  get-or-create instead of a 500. drizzle wraps driver errors in DrizzleQueryError,
 *  so walk the `.cause` chain (the real mysql2 error carries code/errno). */
export function isDupEntryError(e: unknown): boolean {
  let cur = e as { code?: string; errno?: number; cause?: unknown } | null | undefined;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (cur.code === "ER_DUP_ENTRY" || cur.errno === 1062) return true;
    cur = cur.cause as typeof cur;
  }
  return false;
}

// Dev-mode whitelist state
const devWhitelistSettings = { id: 1, enabled: false, comfyuiBypass: false, llmBypass: false, kieEnabled: false, updatedAt: new Date() };
const devStorageSettings = { id: 1, persistAudio: true, persistVideo: true, persistImage: true, presignTtlSec: 3600, poyoUploadFallback: false, minioOnly: true, preferUpstreamRefSource: false, downloadAuthEnabled: false, downloadAuthBypassLevel: 1, forceStorageRelay: false, watermarkEnabled: false, downloadWatermarkEnabled: false, devtoolsBlockEnabled: false, updatedAt: new Date() };
const devModelToggleSettings: { disabledModels: string[]; selfHostedLlm?: import("../drizzle/schema").SelfHostedLlmConfig; bridgeMcp?: import("../drizzle/schema").BridgeMcpConfig; systemDefaultModels?: Record<string, string> } = { disabledModels: [] };
const devAuthSettings = { emailVerificationEnabled: false, smtpHost: "", smtpPort: 587, smtpSecure: false, smtpUser: "", smtpPass: "", smtpFrom: "" };
const devWhitelistEntries: Array<{ id: number; type: "ip" | "user"; value: string; note: string | null; createdBy: number | null; createdAt: Date }> = [];
let devNextWhitelistId = 1;

const DEV_MODE = process.env.NODE_ENV === "development" && !process.env.DATABASE_URL && !process.env.OAUTH_SERVER_URL;

let _db: ReturnType<typeof drizzle> | null = null;

// Full canvas_nodes.type enum — keep in sync with drizzle/schema.ts.
const NODE_TYPE_ENUM_VALUES = [
  "script", "storyboard", "prompt", "image_gen", "asset", "video_task", "ai_chat",
  "note", "audio", "post_process", "group", "character", "clip", "merge", "subtitle",
  "overlay", "subtitle_motion", "smart_cut", "pose_control", "voice_clone", "lip_sync",
  "avatar", "comfyui_image", "comfyui_video", "comfyui_workflow", "image_edit", "director", "agent",
] as const;

// Boot-time self-heal: guarantee canvas_nodes.type accepts every node type even if
// migrations are stuck/partial (notably 'agent' — a missing value makes agent-node
// inserts fail with ER 1265, which rolls back the whole node-save transaction so
// NOTHING — nodes OR viewport — persists). Idempotent: only ALTERs when a value is
// actually missing. Runs once per process; failures are non-fatal (logged).
let _selfHealPromise: Promise<void> | null = null;
async function ensureNodeTypeEnum(db: NonNullable<typeof _db>): Promise<void> {
  const work = (async () => {
    const res = await db.execute(sql`SELECT COLUMN_TYPE AS ct FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_nodes' AND COLUMN_NAME = 'type'`);
    const rows = (Array.isArray(res) ? res[0] : res) as unknown as Array<{ ct?: string }> | undefined;
    const colType = rows?.[0]?.ct;
    if (!colType) return; // table not created yet (fresh DB) — migrations will build it
    const missing = NODE_TYPE_ENUM_VALUES.filter((v) => !colType.includes(`'${v}'`));
    if (missing.length === 0) return; // already complete — no-op
    const enumList = NODE_TYPE_ENUM_VALUES.map((v) => `'${v}'`).join(",");
    await db.execute(sql.raw(`ALTER TABLE \`canvas_nodes\` MODIFY COLUMN \`type\` ENUM(${enumList}) NOT NULL`));
    console.warn(`[Database] self-heal: added missing canvas_nodes.type enum values: ${missing.join(", ")}`);
  })();
  // 注：压测历史/模板表的自愈已下沉到查询路径（ensureStressTables，见下方压测
  // helpers）——每次读写前幂等保证，无需在启动期重复建表。

  // Bound the wait: a hung information_schema/ALTER must NOT block every other DB
  // call (getDb awaits this once). The ALTER, if slow, still finishes in the bg.
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 8000));
  try { await Promise.race([work, timeout]); }
  catch (e) { console.warn("[Database] canvas_nodes enum self-heal skipped:", e instanceof Error ? e.message : e); }
  work.catch(() => { /* background completion errors are non-fatal */ });
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
    if (_db && !_selfHealPromise) _selfHealPromise = ensureNodeTypeEnum(_db);
  }
  if (_selfHealPromise) await _selfHealPromise;
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

// ── 内建「AI 助手」机器人用户 ───────────────────────────────────────────────────
// 聊天里的 AI 功能以一个真实但不可登录的种子用户存在（与他私聊即 LLM 对话）。
// 用固定 openId 标识、disabled=true 禁止登录。无需迁移（复用 users 表）。
export const ASSISTANT_OPEN_ID = "__ai_assistant__";
export const ASSISTANT_NAME = "AI 助手";
let _assistantUserId: number | null = null;

export async function getOrCreateAssistantUserId(): Promise<number> {
  if (_assistantUserId != null) return _assistantUserId;
  const db = await getDb();
  if (!db) { _assistantUserId = 2; return 2; } // dev（无库）：返回固定 id，避免崩溃
  let row = await getUserByOpenId(ASSISTANT_OPEN_ID);
  if (!row) {
    await db.insert(users).values({ openId: ASSISTANT_OPEN_ID, name: ASSISTANT_NAME, disabled: true })
      .onDuplicateKeyUpdate({ set: { name: ASSISTANT_NAME, disabled: true } });
    row = await getUserByOpenId(ASSISTANT_OPEN_ID);
  }
  if (!row) throw new Error("无法创建 AI 助手用户");
  _assistantUserId = row.id;
  return row.id;
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

// ── 用户管理（管理员）────────────────────────────────────────────────────────
/** 所有用户（不含密码哈希），按最近登录倒序。供管理员用户管理界面。 */
export async function listAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: users.id, openId: users.openId, name: users.name, email: users.email,
    loginMethod: users.loginMethod, role: users.role, adminLevel: users.adminLevel, disabled: users.disabled,
    hasPassword: sql<boolean>`(${users.passwordHash} IS NOT NULL)`,
    createdAt: users.createdAt, lastSignedIn: users.lastSignedIn,
  }).from(users).orderBy(desc(users.lastSignedIn));
}

/** 冻结 / 解冻一个用户。 */
export async function setUserDisabled(id: number, disabled: boolean): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ disabled }).where(eq(users.id, id));
}

/** 设置某用户的管理员级别（0=普通用户·1=查看员·2=运营·3=管理员·4=超管）。
 *  同步 role：level>=1 → 'admin'，否则 'user'。 */
export async function setUserAdminLevel(id: number, level: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const lv = Math.max(0, Math.min(4, Math.floor(level)));
  await db.update(users).set({ adminLevel: lv, role: lv >= 1 ? "admin" : "user" }).where(eq(users.id, id));
}

/** 管理员重置某用户的密码（直接写入新哈希）。 */
export async function adminSetUserPassword(id: number, passwordHash: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}

/** 删除一个用户（仅删 users 行；其拥有的项目等数据不在此处级联处理）。 */
export async function deleteUserById(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(users).where(eq(users.id, id));
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

/** Returns the resulting row plus `wasNew` = whether THIS call actually inserted a
 *  brand-new collaborator (vs. updating/colliding with an existing one). Callers use
 *  `wasNew` to decide whether a share-link slot should be consumed (so a concurrent
 *  same-user accept can't burn two link uses for one membership). */
export async function upsertCollaborator(
  data: InsertProjectCollaborator,
): Promise<{ row: ProjectCollaborator | undefined; wasNew: boolean }> {
  const db = await getDb();
  if (!db) {
    if (DEV_MODE) {
      const before = data.userId != null
        ? dev.devFindCollaborator(data.projectId, data.userId)
        : data.email != null ? dev.devFindCollaboratorByEmail(data.projectId, data.email) : undefined;
      return { row: dev.devUpsertCollaborator(data), wasNew: !before };
    }
    throw new Error("DB unavailable");
  }
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
    return { row: rows[0], wasNew: false };
  }
  // No existing row was seen — but a CONCURRENT accept could insert the same
  // (projectId, userId) between our SELECT and this INSERT. The unique index
  // `project_collab_project_user_uniq` (migration 0057) turns that race into an
  // upsert instead of a phantom duplicate row / 500. Only userId-keyed rows carry
  // the unique constraint (pending email rows have userId=NULL → multiple allowed),
  // so the email-only path keeps the plain insert.
  if (data.userId != null) {
    const [header] = await db.insert(projectCollaborators).values(data)
      .onDuplicateKeyUpdate({ set: { role: data.role, status: data.status ?? "active", email: data.email ?? sql`email` } });
    // MySQL affectedRows: 1 = inserted (new), 2 = updated an existing row, 0 = matched
    // but unchanged. So only `=== 1` is a genuinely new membership — a concurrent
    // sibling that lost the race sees 2/0 and reports wasNew=false.
    const affected = (header as unknown as { affectedRows?: number })?.affectedRows ?? 0;
    const rows = await db.select().from(projectCollaborators)
      .where(and(eq(projectCollaborators.projectId, data.projectId), eq(projectCollaborators.userId, data.userId)));
    return { row: rows[0], wasNew: affected === 1 };
  }
  const [header] = await db.insert(projectCollaborators).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(projectCollaborators).where(eq(projectCollaborators.id, insertId));
  return { row: rows[0], wasNew: true };
}

// SECURITY: scope by projectId too — the caller only proves admin on `projectId`,
// so a bare `WHERE id=?` would let an admin of project A mutate a collaborator
// row belonging to project B (cross-tenant IDOR). Returns false when no row in
// THIS project matched, so the router can reject instead of silently succeeding.
export async function updateCollaboratorRole(id: number, projectId: number, role: "viewer" | "editor" | "admin"): Promise<boolean> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devUpdateCollaboratorRole(id, projectId, role); throw new Error("DB unavailable"); }
  const result = await db.update(projectCollaborators).set({ role })
    .where(and(eq(projectCollaborators.id, id), eq(projectCollaborators.projectId, projectId)));
  return ((result[0] as { affectedRows?: number })?.affectedRows ?? 0) > 0;
}

export async function removeCollaborator(id: number, projectId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devRemoveCollaborator(id, projectId); throw new Error("DB unavailable"); }
  const result = await db.delete(projectCollaborators)
    .where(and(eq(projectCollaborators.id, id), eq(projectCollaborators.projectId, projectId)));
  return ((result[0] as { affectedRows?: number })?.affectedRows ?? 0) > 0;
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

/**
 * Give back one slot previously taken by consumeShareLink. Used when a slot was
 * consumed but no NEW membership resulted — e.g. a concurrent same-user accept
 * raced us and the unique index collapsed our INSERT to a no-op. Clamped at >0 so
 * it can never drive usesCount negative. Returns true if a slot was actually refunded.
 */
export async function refundShareLink(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    if (DEV_MODE) return dev.devRefundShareLink(id);
    throw new Error("DB unavailable");
  }
  const result = await db
    .update(projectShareLinks)
    .set({ usesCount: sql`${projectShareLinks.usesCount} - 1` })
    .where(and(
      eq(projectShareLinks.id, id),
      sql`${projectShareLinks.usesCount} > 0`,
    ));
  const header = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number };
  return (header?.affectedRows ?? 0) > 0;
}

// SECURITY: scope by projectId (see updateCollaboratorRole) — prevents an admin
// of one project from revoking another project's share link by raw linkId.
export async function revokeShareLink(id: number, projectId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devRevokeShareLink(id, projectId); throw new Error("DB unavailable"); }
  const result = await db.update(projectShareLinks).set({ revokedAt: new Date() })
    .where(and(eq(projectShareLinks.id, id), eq(projectShareLinks.projectId, projectId)));
  return ((result[0] as { affectedRows?: number })?.affectedRows ?? 0) > 0;
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
  // Cascade-delete edges referencing this node. canvas_edges has no FK/ON DELETE
  // cascade, and saveCanvas only ever UPSERTs edges (never diffs deletions), so
  // without this a deleted node leaves orphan edge rows that edges.list revives
  // (endpoint-less) on the next load. Runs first so a node-delete failure doesn't
  // strand already-removed edges.
  await db.delete(canvasEdges).where(and(
    eq(canvasEdges.projectId, projectId),
    or(eq(canvasEdges.sourceNodeId, id), eq(canvasEdges.targetNodeId, id)),
  ));
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
 * Project-scoped asset library — every asset tied to `projectId` regardless of
 * which collaborator created it, so editors of a shared project see one common
 * library. Caller must already be authorized for the project (assertProjectAccess).
 */
export async function getAssetsByProject(projectId: number, filter: Omit<AssetFilter, "projectId"> = {}) {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetAssetsByProject(projectId, filter) : [];
  const conds = [eq(assets.projectId, projectId), isNull(assets.deletedAt)];
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
    // 新产物入库成功（非重复）→ 触发通知推送（站内通知房 + 外部 webhook）。
    // 仅「生成」类推送；上传/外部导入不打扰。fire-and-forget，失败绝不影响入库。
    if ((a.source ?? "generated") === "generated" && assetNotifier) {
      try {
        assetNotifier({
          userId: a.userId, projectId: a.projectId ?? null, type: a.type,
          url: a.url, name: displayName, mimeType: a.mimeType ?? null,
          provider: a.provider ?? null, model: a.model ?? null,
        });
      } catch { /* 通知非关键 */ }
    }
  } catch (err) {
    // The (userId, storageKey) unique index (migration 0059) rejects a concurrent
    // duplicate record of the same generation — exactly the no-dup outcome we want,
    // so a dup-key error here is expected and silent. Anything else stays a warning.
    if (!isDupEntryError(err)) console.error("[recordGeneratedAsset] non-fatal:", err);
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

// Resolve storage keys for a set of asset ids (admin, no user scope, includes
// already soft-deleted rows) — used by the hard-delete path to know which MinIO
// objects to physically remove before deleting the rows.
export async function getAssetStorageKeysByIds(ids: number[]): Promise<{ id: number; storageKey: string | null }[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devGetAssetStorageKeysByIds(ids); return []; }
  return db.select({ id: assets.id, storageKey: assets.storageKey }).from(assets).where(inArray(assets.id, ids));
}

// Admin HARD delete (no user scope): physically remove the rows. The caller must
// delete the MinIO objects first. Irreversible — used by the "彻底删除" action.
export async function hardDeleteAssetsAdmin(ids: number[]) {
  if (ids.length === 0) return;
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devHardDeleteAssetsAdmin(ids); return; } throw new Error("DB unavailable"); }
  await db.delete(assets).where(inArray(assets.id, ids));
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
  try {
    const [header] = await db.insert(videoTasks).values(data);
    const insertId = (header as unknown as { insertId: number }).insertId;
    const rows = await db.select().from(videoTasks).where(eq(videoTasks.id, insertId));
    return rows[0] ?? null;
  } catch (e) {
    // The in-flight unique index `video_tasks_inflight_uniq` (migration 0058)
    // rejected a concurrent/cross-user/multi-process duplicate in-flight task for
    // the same (projectId, nodeId). Collapse to the existing in-flight row so we
    // never submit — and charge — the upstream provider twice (get-or-create).
    if (isDupEntryError(e)) {
      const existing = await findInFlightVideoTask(data.projectId, data.nodeId);
      if (existing) return existing;
    }
    throw e;
  }
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
    // Deterministic oldest-first (MySQL's default order is unspecified). Combined
    // with the poller's stuck-task reclaim, the oldest permanently-stuck rows are
    // seen and failed-out from the front each cycle, draining a backlog instead of
    // letting it sit forever and crowd the 200-row window.
    .orderBy(videoTasks.createdAt)
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

// ── 画布助手会话（持久化 turns，按 projectId+userId 一行） ──
function normalizeAgentTurns(v: unknown): CanvasAgentTurn[] {
  const arr = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : v;
  if (!Array.isArray(arr)) return [];
  return arr.filter((t): t is CanvasAgentTurn => !!t && typeof t === "object" && typeof (t as { content?: unknown }).content === "string"
    && ((t as { role?: unknown }).role === "user" || (t as { role?: unknown }).role === "assistant"));
}

export async function getCanvasAgentSession(projectId: number, userId: number): Promise<CanvasAgentTurn[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetCanvasAgentSession(projectId, userId) : [];
  const rows = await db.select().from(canvasAgentSessions)
    .where(and(eq(canvasAgentSessions.projectId, projectId), eq(canvasAgentSessions.userId, userId))).limit(1);
  return normalizeAgentTurns(rows[0]?.turns);
}

export async function setCanvasAgentSession(projectId: number, userId: number, turns: CanvasAgentTurn[]): Promise<void> {
  const clean = normalizeAgentTurns(turns).slice(-80); // 服务端也封顶，防超大 payload
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devSetCanvasAgentSession(projectId, userId, clean); return; }
  await db.insert(canvasAgentSessions).values({ projectId, userId, turns: clean })
    .onDuplicateKeyUpdate({ set: { turns: clean, updatedAt: new Date() } });
}

// ── Whitelist ─────────────────────────────────────────────────────────────────

export async function getWhitelistSettings() {
  const db = await getDb();
  if (!db) return devWhitelistSettings;
  const rows = await db.select().from(whitelistSettings).limit(1);
  return rows[0] ?? null;
}

// ── Global ComfyUI server registry (admin-managed, shared by all users) ────────
// Stored as JSON in comfy_settings.servers (single row id=1). Legacy rows held a
// bare string[] of URLs; we now hold { servers, gpuIndex } so the admin's chosen
// physical GPU per server also syncs to everyone. Reads accept BOTH shapes, so no
// migration is needed — the text column already exists.
interface ComfyGlobalSettings { servers: string[]; gpuIndex: Record<string, number>; }
let devComfyServers: string[] = [];
let devComfyGpuIndex: Record<string, number> = {};

function parseComfySettings(raw: string | null | undefined): ComfyGlobalSettings {
  if (!raw) return { servers: [], gpuIndex: {} };
  try {
    const p: unknown = JSON.parse(raw);
    if (Array.isArray(p)) return { servers: p.filter((u): u is string => typeof u === "string"), gpuIndex: {} };
    if (p && typeof p === "object") {
      const o = p as { servers?: unknown; gpuIndex?: unknown };
      const servers = Array.isArray(o.servers) ? o.servers.filter((u): u is string => typeof u === "string") : [];
      const gpuIndex: Record<string, number> = {};
      if (o.gpuIndex && typeof o.gpuIndex === "object") {
        for (const [k, v] of Object.entries(o.gpuIndex as Record<string, unknown>)) {
          if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 63) gpuIndex[k] = v;
        }
      }
      return { servers, gpuIndex };
    }
  } catch { /* fall through */ }
  return { servers: [], gpuIndex: {} };
}

export async function getComfyGlobalSettings(): Promise<ComfyGlobalSettings> {
  const db = await getDb();
  if (!db) return { servers: devComfyServers, gpuIndex: devComfyGpuIndex };
  try {
    const rows = await db.select().from(comfySettings).limit(1);
    return parseComfySettings(rows[0]?.servers);
  } catch { return { servers: [], gpuIndex: {} }; }
}

async function writeComfyGlobalSettings(next: ComfyGlobalSettings): Promise<void> {
  const db = await getDb();
  if (!db) { devComfyServers = next.servers; devComfyGpuIndex = next.gpuIndex; return; }
  const json = JSON.stringify(next);
  await db.insert(comfySettings).values({ id: 1, servers: json })
    .onDuplicateKeyUpdate({ set: { servers: json } });
}

export async function getComfyGlobalServers(): Promise<string[]> {
  return (await getComfyGlobalSettings()).servers;
}

export async function setComfyGlobalServers(servers: string[]): Promise<void> {
  const clean = Array.from(new Set(servers.map((u) => u.trim()).filter(Boolean))).slice(0, 50);
  const cur = await getComfyGlobalSettings();
  // Prune GPU pins for servers that no longer exist.
  const gpuIndex: Record<string, number> = {};
  for (const u of clean) if (cur.gpuIndex[u] != null) gpuIndex[u] = cur.gpuIndex[u];
  await writeComfyGlobalSettings({ servers: clean, gpuIndex });
}

export async function getComfyGlobalGpuIndex(): Promise<Record<string, number>> {
  return (await getComfyGlobalSettings()).gpuIndex;
}

export async function setComfyGlobalGpuIndex(gpuIndex: Record<string, number>): Promise<void> {
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(gpuIndex)) {
    const key = k.trim();
    if (key && typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 63) clean[key] = v;
  }
  const cur = await getComfyGlobalSettings();
  await writeComfyGlobalSettings({ servers: cur.servers, gpuIndex: clean });
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

export async function setWhitelistLlmBypass(llmBypass: boolean): Promise<void> {
  const db = await getDb();
  if (!db) { devWhitelistSettings.llmBypass = llmBypass; return; }
  await db.insert(whitelistSettings).values({ id: 1, llmBypass })
    .onDuplicateKeyUpdate({ set: { llmBypass } });
}

// Whether (whitelisted/admin) users may use the shared "house" kie.ai key.
export async function setWhitelistKieEnabled(kieEnabled: boolean): Promise<void> {
  const db = await getDb();
  if (!db) { devWhitelistSettings.kieEnabled = kieEnabled; return; }
  await db.insert(whitelistSettings).values({ id: 1, kieEnabled })
    .onDuplicateKeyUpdate({ set: { kieEnabled } });
}

export async function getWhitelistEntries() {
  const db = await getDb();
  if (!db) return [...devWhitelistEntries];
  return db.select().from(whitelistEntries).orderBy(whitelistEntries.createdAt);
}

// ── Storage persistence settings ────────────────────────────────────────────

export async function getStorageSettings(): Promise<{ persistAudio: boolean; persistVideo: boolean; persistImage: boolean; presignTtlSec: number; poyoUploadFallback: boolean; minioOnly: boolean; preferUpstreamRefSource: boolean; downloadAuthEnabled: boolean; downloadAuthBypassLevel: number; forceStorageRelay: boolean; watermarkEnabled: boolean; downloadWatermarkEnabled: boolean; devtoolsBlockEnabled: boolean }> {
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
    downloadAuthBypassLevel: devStorageSettings.downloadAuthBypassLevel,
    forceStorageRelay: devStorageSettings.forceStorageRelay,
    watermarkEnabled: devStorageSettings.watermarkEnabled,
    downloadWatermarkEnabled: devStorageSettings.downloadWatermarkEnabled,
    devtoolsBlockEnabled: devStorageSettings.devtoolsBlockEnabled,
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
    downloadAuthBypassLevel: row?.downloadAuthBypassLevel ?? 1,
    forceStorageRelay: row?.forceStorageRelay ?? false,
    watermarkEnabled: row?.watermarkEnabled ?? false,
    downloadWatermarkEnabled: row?.downloadWatermarkEnabled ?? false,
    devtoolsBlockEnabled: row?.devtoolsBlockEnabled ?? false,
  };
}

export async function setStorageSettings(patch: { persistAudio?: boolean; persistVideo?: boolean; persistImage?: boolean; presignTtlSec?: number; poyoUploadFallback?: boolean; minioOnly?: boolean; preferUpstreamRefSource?: boolean; downloadAuthEnabled?: boolean; downloadAuthBypassLevel?: number; forceStorageRelay?: boolean; watermarkEnabled?: boolean; downloadWatermarkEnabled?: boolean; devtoolsBlockEnabled?: boolean }): Promise<void> {
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
    if (patch.downloadAuthBypassLevel !== undefined) devStorageSettings.downloadAuthBypassLevel = patch.downloadAuthBypassLevel;
    if (patch.forceStorageRelay !== undefined) devStorageSettings.forceStorageRelay = patch.forceStorageRelay;
    if (patch.watermarkEnabled !== undefined) devStorageSettings.watermarkEnabled = patch.watermarkEnabled;
    if (patch.downloadWatermarkEnabled !== undefined) devStorageSettings.downloadWatermarkEnabled = patch.downloadWatermarkEnabled;
    if (patch.devtoolsBlockEnabled !== undefined) devStorageSettings.devtoolsBlockEnabled = patch.devtoolsBlockEnabled;
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
  if (patch.downloadAuthBypassLevel !== undefined) set.downloadAuthBypassLevel = patch.downloadAuthBypassLevel;
  if (patch.forceStorageRelay !== undefined) set.forceStorageRelay = patch.forceStorageRelay;
  if (patch.watermarkEnabled !== undefined) set.watermarkEnabled = patch.watermarkEnabled;
  if (patch.downloadWatermarkEnabled !== undefined) set.downloadWatermarkEnabled = patch.downloadWatermarkEnabled;
  if (patch.devtoolsBlockEnabled !== undefined) set.devtoolsBlockEnabled = patch.devtoolsBlockEnabled;
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

// ── Auth settings (registration email-verification toggle + SMTP) ───────────
export interface AuthSettings {
  emailVerificationEnabled: boolean;
  smtpHost: string; smtpPort: number; smtpSecure: boolean;
  smtpUser: string; smtpPass: string; smtpFrom: string;
}

export async function getAuthSettings(): Promise<AuthSettings> {
  const db = await getDb();
  if (!db) return { ...devAuthSettings };
  const rows = await db.select().from(authSettings).limit(1);
  const r = rows[0];
  return {
    emailVerificationEnabled: r?.emailVerificationEnabled ?? false,
    smtpHost: r?.smtpHost ?? "",
    smtpPort: r?.smtpPort ?? 587,
    smtpSecure: r?.smtpSecure ?? false,
    smtpUser: r?.smtpUser ?? "",
    smtpPass: r?.smtpPass ?? "",
    smtpFrom: r?.smtpFrom ?? "",
  };
}

export async function setAuthSettings(patch: Partial<AuthSettings>): Promise<void> {
  const db = await getDb();
  if (!db) { Object.assign(devAuthSettings, patch); return; }
  const set: Record<string, boolean | number | string> = {};
  for (const k of ["emailVerificationEnabled", "smtpHost", "smtpPort", "smtpSecure", "smtpUser", "smtpPass", "smtpFrom"] as const) {
    if (patch[k] !== undefined) set[k] = patch[k]!;
  }
  if (Object.keys(set).length === 0) return;
  await db.insert(authSettings).values({ id: 1, ...set }).onDuplicateKeyUpdate({ set });
}

// Set/clear a user's email-verification state + pending code (by openId).
export async function setUserVerification(openId: string, patch: { emailVerified?: boolean; verifyCode?: string | null; verifyCodeExpiresAt?: Date | null }): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const set: Record<string, unknown> = {};
  if (patch.emailVerified !== undefined) set.emailVerified = patch.emailVerified;
  if (patch.verifyCode !== undefined) set.verifyCode = patch.verifyCode;
  if (patch.verifyCodeExpiresAt !== undefined) set.verifyCodeExpiresAt = patch.verifyCodeExpiresAt;
  if (Object.keys(set).length === 0) return;
  await db.update(users).set(set).where(eq(users.openId, openId));
}

// ── Model visibility toggles (admin-managed) ────────────────────────────────
/** 读取被管理员禁用的模型 id 集合（空数组 = 全部可见）。 */
export async function getDisabledModels(): Promise<string[]> {
  const db = await getDb();
  if (!db) return [...devModelToggleSettings.disabledModels];
  const rows = await db.select().from(modelToggleSettings).limit(1);
  const v = rows[0]?.disabledModels;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** 覆盖写入被禁用的模型 id 集合（去重）。upsert：单行 id=1。 */
export async function setDisabledModels(ids: string[]): Promise<void> {
  const disabledModels = Array.from(new Set(ids.filter((x) => typeof x === "string")));
  const db = await getDb();
  if (!db) { devModelToggleSettings.disabledModels = disabledModels; return; }
  await db.insert(modelToggleSettings).values({ id: 1, disabledModels })
    .onDuplicateKeyUpdate({ set: { disabledModels } });
}

export function normalizeSelfHostedLlm(v: unknown): SelfHostedLlmConfig {
  // JSON columns come back parsed on MySQL 8 but as a STRING on MariaDB (JSON=longtext),
  // so accept both: parse a string, else use the object.
  let o: Record<string, unknown> = {};
  if (typeof v === "string") { try { o = JSON.parse(v) as Record<string, unknown>; } catch { o = {}; } }
  else if (v && typeof v === "object") o = v as Record<string, unknown>;
  const models = Array.isArray(o.models) ? o.models.filter((m): m is { id: string; label: string } =>
    !!m && typeof m === "object" && typeof (m as { id?: unknown }).id === "string").map((m) => ({ id: String(m.id), label: String((m as { label?: unknown }).label ?? m.id) })) : [];
  return { url: typeof o.url === "string" ? o.url : "", apiKey: typeof o.apiKey === "string" ? o.apiKey : "", models };
}

/** 管理员配置的自建 OpenAI 兼容 LLM（url/apiKey/models）。单行 id=1 的 JSON 列。 */
export async function getSelfHostedLlmConfig(): Promise<SelfHostedLlmConfig> {
  const db = await getDb();
  if (!db) return normalizeSelfHostedLlm(devModelToggleSettings.selfHostedLlm);
  const rows = await db.select().from(modelToggleSettings).limit(1);
  return normalizeSelfHostedLlm(rows[0]?.selfHostedLlm);
}

export async function setSelfHostedLlmConfig(cfg: SelfHostedLlmConfig): Promise<void> {
  const selfHostedLlm = normalizeSelfHostedLlm(cfg);
  const db = await getDb();
  if (!db) { devModelToggleSettings.selfHostedLlm = selfHostedLlm; return; }
  await db.insert(modelToggleSettings).values({ id: 1, selfHostedLlm })
    .onDuplicateKeyUpdate({ set: { selfHostedLlm } });
}

export function normalizeBridgeMcp(v: unknown): BridgeMcpConfig {
  // JSON column: MySQL 8 returns a parsed object, MariaDB returns a string — accept both.
  let o: Record<string, unknown> = {};
  if (typeof v === "string") { try { o = JSON.parse(v) as Record<string, unknown>; } catch { o = {}; } }
  else if (v && typeof v === "object") o = v as Record<string, unknown>;
  return {
    mcpConfig: typeof o.mcpConfig === "string" ? o.mcpConfig : "",
    skills: o.skills === true,
    // strict 缺省为 true（默认 --strict-mcp-config，与 env `!== "0"` 语义一致）。
    strict: o.strict === false ? false : true,
    permissionMode: typeof o.permissionMode === "string" ? o.permissionMode : "",
    allowedTools: typeof o.allowedTools === "string" ? o.allowedTools : "",
  };
}

/** 管理员配置的桥接 MCP/技能增强（替代 CLAUDE_BRIDGE_* env）。单行 id=1 的 JSON 列。 */
export async function getBridgeMcpConfig(): Promise<BridgeMcpConfig> {
  const db = await getDb();
  if (!db) return normalizeBridgeMcp(devModelToggleSettings.bridgeMcp);
  const rows = await db.select().from(modelToggleSettings).limit(1);
  return normalizeBridgeMcp(rows[0]?.bridgeMcp);
}

export async function setBridgeMcpConfig(cfg: BridgeMcpConfig): Promise<void> {
  const bridgeMcp = normalizeBridgeMcp(cfg);
  const db = await getDb();
  if (!db) { devModelToggleSettings.bridgeMcp = bridgeMcp; return; }
  await db.insert(modelToggleSettings).values({ id: 1, bridgeMcp })
    .onDuplicateKeyUpdate({ set: { bridgeMcp } });
}

/** 管理员配置的「系统默认模型」（按槽位 llm/image/video/transcribe）。单行 id=1 的 JSON 列。 */
export async function getSystemDefaultModels(): Promise<Record<string, string>> {
  const db = await getDb();
  if (!db) return normalizeSystemDefaultModels(devModelToggleSettings.systemDefaultModels);
  const rows = await db.select().from(modelToggleSettings).limit(1);
  return normalizeSystemDefaultModels(rows[0]?.systemDefaultModels);
}

export async function setSystemDefaultModels(cfg: Record<string, string>): Promise<void> {
  const systemDefaultModels = normalizeSystemDefaultModels(cfg);
  const db = await getDb();
  if (!db) { devModelToggleSettings.systemDefaultModels = systemDefaultModels; return; }
  await db.insert(modelToggleSettings).values({ id: 1, systemDefaultModels })
    .onDuplicateKeyUpdate({ set: { systemDefaultModels } });
}

// ── Public tunnel (cloudflared) settings + its separate access whitelist ──
import type { TunnelEmailNotify } from "../drizzle/schema";
export type { TunnelEmailNotify };
export type TunnelSettings = { enabled: boolean; runCloudflared: boolean; token: string; preferQuick: boolean; publicUrl: string; whitelistUsers: number[]; whitelistIps: string[]; emailNotify: TunnelEmailNotify; edgeBindAddress: string };
export const EMPTY_EMAIL_NOTIFY: TunnelEmailNotify = { to: "", host: "", port: 587, user: "", pass: "", secure: false, from: "" };
const devTunnel: TunnelSettings = { enabled: false, runCloudflared: true, token: "", preferQuick: false, publicUrl: "", whitelistUsers: [], whitelistIps: [], emailNotify: { ...EMPTY_EMAIL_NOTIFY }, edgeBindAddress: "" };
function _safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
function _strArr(v: unknown): string[] { const a = typeof v === "string" ? _safeJson(v) : v; return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : []; }
function _numArr(v: unknown): number[] { const a = typeof v === "string" ? _safeJson(v) : v; return Array.isArray(a) ? a.filter((x): x is number => typeof x === "number") : []; }
function _email(v: unknown): TunnelEmailNotify {
  const o = (typeof v === "string" ? _safeJson(v) : v) as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return { ...EMPTY_EMAIL_NOTIFY };
  const s = (k: string) => typeof o[k] === "string" ? o[k] as string : "";
  return { to: s("to"), host: s("host"), port: typeof o.port === "number" ? o.port : 587, user: s("user"), pass: s("pass"), secure: o.secure === true, from: s("from") };
}

export async function getTunnelSettings(): Promise<TunnelSettings> {
  const db = await getDb();
  if (!db) return { ...devTunnel };
  const rows = await db.select().from(tunnelSettings).limit(1);
  const r = rows[0];
  if (!r) return { enabled: false, runCloudflared: true, token: "", preferQuick: false, publicUrl: "", whitelistUsers: [], whitelistIps: [], emailNotify: { ...EMPTY_EMAIL_NOTIFY }, edgeBindAddress: "" };
  return { enabled: !!r.enabled, runCloudflared: r.runCloudflared !== false, token: r.token ?? "", preferQuick: (r as { preferQuick?: boolean | null }).preferQuick === true, publicUrl: r.publicUrl ?? "", whitelistUsers: _numArr(r.whitelistUsers), whitelistIps: _strArr(r.whitelistIps), emailNotify: _email(r.emailNotify), edgeBindAddress: (r as { edgeBindAddress?: string | null }).edgeBindAddress ?? "" };
}

export async function setTunnelSettings(patch: Partial<TunnelSettings>): Promise<void> {
  const db = await getDb();
  if (!db) { Object.assign(devTunnel, patch); return; }
  const set: Record<string, unknown> = {};
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.runCloudflared !== undefined) set.runCloudflared = patch.runCloudflared;
  if (patch.token !== undefined) set.token = patch.token;
  if (patch.preferQuick !== undefined) set.preferQuick = patch.preferQuick;
  if (patch.publicUrl !== undefined) set.publicUrl = patch.publicUrl;
  if (patch.whitelistUsers !== undefined) set.whitelistUsers = patch.whitelistUsers;
  if (patch.whitelistIps !== undefined) set.whitelistIps = patch.whitelistIps;
  if (patch.emailNotify !== undefined) set.emailNotify = patch.emailNotify;
  if (patch.edgeBindAddress !== undefined) set.edgeBindAddress = patch.edgeBindAddress;
  await db.insert(tunnelSettings).values({ id: 1, enabled: patch.enabled ?? false, runCloudflared: patch.runCloudflared ?? true, token: patch.token, preferQuick: patch.preferQuick ?? false, publicUrl: patch.publicUrl, whitelistUsers: patch.whitelistUsers, whitelistIps: patch.whitelistIps, emailNotify: patch.emailNotify, edgeBindAddress: patch.edgeBindAddress })
    .onDuplicateKeyUpdate({ set });
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

// ── kie.ai keys (admin-distributed, encrypted at rest) ────────────────────────
type KieKeyRow = typeof kieApiKeys.$inferSelect;
type KieBindingRow = typeof kieKeyBindings.$inferSelect;
type KieSnapRow = typeof kieBalanceSnapshots.$inferSelect;
const devKieKeys: KieKeyRow[] = [];
let devKieKeyId = 1;
const devKieBindings: KieBindingRow[] = [];
let devKieBindingId = 1;
const devKieSnaps: KieSnapRow[] = []; // newest first
let devKieSnapId = 1;

export interface KieKeySummary {
  id: number; name: string; keyLast4: string; enabled: boolean; note: string | null;
  createdAt: Date; bindingCount: number; activeBindingCount: number;
}

/** Add an encrypted kie key. Returns null if a key with the same hash already exists. */
export async function addKieKey(data: { name: string; encryptedKey: string; keyLast4: string; keyHash: string; note: string | null; createdBy: number | null }): Promise<{ id: number } | null> {
  const db = await getDb();
  if (!db) {
    if (devKieKeys.some(k => k.keyHash === data.keyHash)) return null;
    const row = { id: devKieKeyId++, name: data.name, encryptedKey: data.encryptedKey, keyLast4: data.keyLast4, keyHash: data.keyHash, enabled: true, note: data.note, createdBy: data.createdBy, createdAt: new Date(), updatedAt: new Date() } as KieKeyRow;
    devKieKeys.push(row);
    return { id: row.id };
  }
  const existing = await db.select({ id: kieApiKeys.id }).from(kieApiKeys).where(eq(kieApiKeys.keyHash, data.keyHash)).limit(1);
  if (existing.length) return null;
  const [res] = await db.insert(kieApiKeys).values({ name: data.name, encryptedKey: data.encryptedKey, keyLast4: data.keyLast4, keyHash: data.keyHash, note: data.note ?? undefined, createdBy: data.createdBy ?? undefined });
  return { id: (res as { insertId?: number }).insertId ?? 0 };
}

export async function listKieKeysWithCounts(): Promise<KieKeySummary[]> {
  const db = await getDb();
  if (!db) {
    return devKieKeys.map(k => {
      const binds = devKieBindings.filter(b => b.keyId === k.id);
      return { id: k.id, name: k.name, keyLast4: k.keyLast4, enabled: k.enabled, note: k.note, createdAt: k.createdAt, bindingCount: binds.length, activeBindingCount: binds.filter(b => b.enabled).length };
    });
  }
  const keys = await db.select().from(kieApiKeys).orderBy(desc(kieApiKeys.id));
  const binds = await db.select({ keyId: kieKeyBindings.keyId, enabled: kieKeyBindings.enabled }).from(kieKeyBindings);
  return keys.map(k => {
    const kb = binds.filter(b => b.keyId === k.id);
    return { id: k.id, name: k.name, keyLast4: k.keyLast4, enabled: k.enabled, note: k.note, createdAt: k.createdAt, bindingCount: kb.length, activeBindingCount: kb.filter(b => b.enabled).length };
  });
}

export async function setKieKeyEnabled(id: number, enabled: boolean): Promise<boolean> {
  const db = await getDb();
  if (!db) { const k = devKieKeys.find(x => x.id === id); if (!k) return false; k.enabled = enabled; return true; }
  const [res] = await db.update(kieApiKeys).set({ enabled }).where(eq(kieApiKeys.id, id));
  return (res as { affectedRows?: number }).affectedRows !== 0;
}

export async function deleteKieKey(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    const idx = devKieKeys.findIndex(x => x.id === id);
    if (idx === -1) return false;
    devKieKeys.splice(idx, 1);
    for (let i = devKieBindings.length - 1; i >= 0; i--) if (devKieBindings[i].keyId === id) devKieBindings.splice(i, 1);
    return true;
  }
  await db.delete(kieKeyBindings).where(eq(kieKeyBindings.keyId, id));
  const [res] = await db.delete(kieApiKeys).where(eq(kieApiKeys.id, id));
  return (res as { affectedRows?: number }).affectedRows !== 0;
}

export interface KieBindingSummary { id: number; userId: number; enabled: boolean; note: string | null; createdAt: Date; userEmail: string | null; userName: string | null }

export async function listKieBindings(keyId: number): Promise<KieBindingSummary[]> {
  const db = await getDb();
  if (!db) {
    return devKieBindings.filter(b => b.keyId === keyId).map(b => ({ id: b.id, userId: b.userId, enabled: b.enabled, note: b.note, createdAt: b.createdAt, userEmail: null, userName: null }));
  }
  const rows = await db.select({
    id: kieKeyBindings.id, userId: kieKeyBindings.userId, enabled: kieKeyBindings.enabled, note: kieKeyBindings.note, createdAt: kieKeyBindings.createdAt,
    userEmail: users.email, userName: users.name,
  }).from(kieKeyBindings).leftJoin(users, eq(kieKeyBindings.userId, users.id)).where(eq(kieKeyBindings.keyId, keyId)).orderBy(desc(kieKeyBindings.id));
  return rows.map(r => ({ id: r.id, userId: r.userId, enabled: r.enabled, note: r.note, createdAt: r.createdAt, userEmail: r.userEmail ?? null, userName: r.userName ?? null }));
}

/** Bind a user to a key. Returns null if the binding already exists. */
export async function bindKieUser(keyId: number, userId: number, note: string | null, createdBy: number | null): Promise<{ id: number } | null> {
  const db = await getDb();
  if (!db) {
    if (devKieBindings.some(b => b.keyId === keyId && b.userId === userId)) return null;
    const row = { id: devKieBindingId++, keyId, userId, enabled: true, note, createdBy, createdAt: new Date() } as KieBindingRow;
    devKieBindings.push(row);
    return { id: row.id };
  }
  const existing = await db.select({ id: kieKeyBindings.id }).from(kieKeyBindings).where(and(eq(kieKeyBindings.keyId, keyId), eq(kieKeyBindings.userId, userId))).limit(1);
  if (existing.length) return null;
  try {
    const [res] = await db.insert(kieKeyBindings).values({ keyId, userId, note: note ?? undefined, createdBy: createdBy ?? undefined });
    return { id: (res as { insertId?: number }).insertId ?? 0 };
  } catch (e) {
    // Concurrent bind of the same (keyId, userId): the `keyUserUniq` index rejected the
    // second insert. Report it as the same "already bound" outcome (null) the SELECT
    // above returns, not a 500.
    if (isDupEntryError(e)) return null;
    throw e;
  }
}

export async function setKieBindingEnabled(bindingId: number, enabled: boolean): Promise<boolean> {
  const db = await getDb();
  if (!db) { const b = devKieBindings.find(x => x.id === bindingId); if (!b) return false; b.enabled = enabled; return true; }
  const [res] = await db.update(kieKeyBindings).set({ enabled }).where(eq(kieKeyBindings.id, bindingId));
  return (res as { affectedRows?: number }).affectedRows !== 0;
}

export async function deleteKieBinding(bindingId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) { const idx = devKieBindings.findIndex(x => x.id === bindingId); if (idx === -1) return false; devKieBindings.splice(idx, 1); return true; }
  const [res] = await db.delete(kieKeyBindings).where(eq(kieKeyBindings.id, bindingId));
  return (res as { affectedRows?: number }).affectedRows !== 0;
}

/** A user's effective assigned kie key: an enabled binding whose key is also enabled. */
export async function getEffectiveKieKeyForUser(userId: number): Promise<{ keyId: number; name: string; keyLast4: string; encryptedKey: string } | null> {
  const db = await getDb();
  if (!db) {
    const b = devKieBindings.find(x => x.userId === userId && x.enabled);
    if (!b) return null;
    const k = devKieKeys.find(x => x.id === b.keyId && x.enabled);
    return k ? { keyId: k.id, name: k.name, keyLast4: k.keyLast4, encryptedKey: k.encryptedKey } : null;
  }
  const rows = await db.select({ keyId: kieApiKeys.id, name: kieApiKeys.name, keyLast4: kieApiKeys.keyLast4, encryptedKey: kieApiKeys.encryptedKey })
    .from(kieKeyBindings)
    .innerJoin(kieApiKeys, eq(kieKeyBindings.keyId, kieApiKeys.id))
    .where(and(eq(kieKeyBindings.userId, userId), eq(kieKeyBindings.enabled, true), eq(kieApiKeys.enabled, true)))
    .orderBy(desc(kieApiKeys.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertKieBalanceSnapshotThrottled(creditsAmount: number, windowMs = 5 * 60_000): Promise<boolean> {
  const now = Date.now();
  const db = await getDb();
  if (!db) {
    const last = devKieSnaps[0];
    if (last && now - last.createdAt.getTime() < windowMs) return false;
    devKieSnaps.unshift({ id: devKieSnapId++, creditsAmount, createdAt: new Date() } as KieSnapRow);
    if (devKieSnaps.length > 500) devKieSnaps.pop();
    return true;
  }
  const lastRows = await db.select({ createdAt: kieBalanceSnapshots.createdAt }).from(kieBalanceSnapshots).orderBy(desc(kieBalanceSnapshots.createdAt)).limit(1);
  const last = lastRows[0];
  if (last && now - last.createdAt.getTime() < windowMs) return false;
  await db.insert(kieBalanceSnapshots).values({ creditsAmount });
  return true;
}

export async function getRecentKieBalanceSnapshots(limit = 50): Promise<Array<{ creditsAmount: number; at: Date }>> {
  const db = await getDb();
  if (!db) return devKieSnaps.slice(0, limit).map(r => ({ creditsAmount: r.creditsAmount, at: r.createdAt }));
  const rows = await db.select().from(kieBalanceSnapshots).orderBy(desc(kieBalanceSnapshots.createdAt)).limit(limit);
  return rows.map(r => ({ creditsAmount: r.creditsAmount, at: r.createdAt }));
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
  /** 按用户名 / 邮箱 / ID 模糊筛选。 */
  user?: string;
}): Promise<{ rows: typeof auditLogs.$inferSelect[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const db = await getDb();

  // "kie_gen" 是个伪类别：kie 的图/视频/音乐生成走的是 image_gen/video_gen/audio_music
  // 等动作，靠 detail 里的 model/provider 以 "kie_" 开头来识别。
  const KIE_GEN_ACTIONS = ["image_gen", "video_gen", "audio_music", "audio_dubbing"];

  if (!db) {
    const uq = opts.user?.trim().toLowerCase();
    const filtered = devAuditLogs.filter((l) => {
      if (opts.action === "kie_gen") {
        const d = (l.detail ?? {}) as { model?: string; provider?: string };
        if (!(KIE_GEN_ACTIONS.includes(l.action) && (String(d.model ?? "").startsWith("kie_") || String(d.provider ?? "").startsWith("kie_")))) return false;
      } else if (opts.action && l.action !== opts.action) return false;
      if (uq && !(`${l.userName ?? ""} ${l.userEmail ?? ""} ${l.userId ?? ""}`.toLowerCase().includes(uq))) return false;
      return true;
    });
    return {
      rows: filtered.slice(offset, offset + limit) as typeof auditLogs.$inferSelect[],
      total: filtered.length,
    };
  }

  const conds = [];
  if (opts.action === "kie_gen") {
    conds.push(inArray(auditLogs.action, KIE_GEN_ACTIONS));
    conds.push(sql`(JSON_UNQUOTE(JSON_EXTRACT(${auditLogs.detail}, '$.model')) LIKE 'kie_%' OR JSON_UNQUOTE(JSON_EXTRACT(${auditLogs.detail}, '$.provider')) LIKE 'kie_%')`);
  } else if (opts.action) {
    conds.push(eq(auditLogs.action, opts.action));
  }
  if (opts.user?.trim()) {
    const like = `%${opts.user.trim()}%`;
    conds.push(sql`(${auditLogs.userName} LIKE ${like} OR ${auditLogs.userEmail} LIKE ${like} OR CAST(${auditLogs.userId} AS CHAR) LIKE ${like})`);
  }
  const where = conds.length ? and(...conds) : undefined;

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

// ── ComfyUI usage logs ──────────────────────────────────────────────────────
type DevComfyUsageLog = typeof comfyUsageLogs.$inferSelect;
const devComfyUsageLogs: DevComfyUsageLog[] = []; // newest first
let devComfyUsageLogId = 1;

export async function insertComfyUsageLog(data: InsertComfyUsageLog): Promise<void> {
  const db = await getDb();
  if (!db) {
    devComfyUsageLogs.unshift({ ...data, id: devComfyUsageLogId++, createdAt: new Date() } as DevComfyUsageLog);
    if (devComfyUsageLogs.length > 1000) devComfyUsageLogs.pop();
    return;
  }
  await db.insert(comfyUsageLogs).values(data);
}

export async function getComfyUsageLogs(opts: {
  limit?: number; offset?: number;
  userId?: number; host?: string; status?: string; action?: string; sinceMs?: number;
}): Promise<{ rows: DevComfyUsageLog[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const db = await getDb();

  if (!db) {
    const f = devComfyUsageLogs.filter((l) =>
      (opts.userId == null || l.userId === opts.userId) &&
      (!opts.host || l.host === opts.host) &&
      (!opts.status || l.status === opts.status) &&
      (!opts.action || l.action === opts.action) &&
      (opts.sinceMs == null || (l.createdAt instanceof Date ? l.createdAt.getTime() : 0) >= opts.sinceMs));
    return { rows: f.slice(offset, offset + limit), total: f.length };
  }

  const conds = [
    opts.userId != null ? eq(comfyUsageLogs.userId, opts.userId) : undefined,
    opts.host ? eq(comfyUsageLogs.host, opts.host) : undefined,
    opts.status ? eq(comfyUsageLogs.status, opts.status) : undefined,
    opts.action ? eq(comfyUsageLogs.action, opts.action) : undefined,
    opts.sinceMs != null ? gte(comfyUsageLogs.createdAt, new Date(opts.sinceMs)) : undefined,
  ].filter(Boolean);
  const where = conds.length > 0 ? and(...conds) : undefined;

  const [rows, countRows] = await Promise.all([
    db.select().from(comfyUsageLogs).where(where).orderBy(desc(comfyUsageLogs.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`COUNT(*)` }).from(comfyUsageLogs).where(where),
  ]);
  return { rows, total: Number(countRows[0]?.count ?? 0) };
}

/** Aggregate stats per user and per server/host (success/error counts, avg ms). */
export async function getComfyUsageSummary(opts: { sinceMs?: number } = {}): Promise<{
  byUser: { userId: number | null; userEmail: string | null; runs: number; errors: number; avgMs: number }[];
  byHost: { host: string | null; runs: number; errors: number; avgMs: number }[];
  totals: { runs: number; errors: number; avgMs: number };
}> {
  const db = await getDb();
  const errExpr = sql<number>`SUM(CASE WHEN ${comfyUsageLogs.status} = 'error' THEN 1 ELSE 0 END)`;
  const avgExpr = sql<number>`AVG(${comfyUsageLogs.durationMs})`;

  if (!db) {
    const since = opts.sinceMs ?? 0;
    const rows = devComfyUsageLogs.filter((l) => (l.createdAt instanceof Date ? l.createdAt.getTime() : 0) >= since);
    const grp = <K extends string | number | null>(key: (l: DevComfyUsageLog) => K) => {
      const m = new Map<K, { runs: number; errors: number; sum: number; n: number; sample: DevComfyUsageLog }>();
      for (const l of rows) {
        const k = key(l); const e = m.get(k) ?? { runs: 0, errors: 0, sum: 0, n: 0, sample: l };
        e.runs++; if (l.status === "error") e.errors++; if (typeof l.durationMs === "number") { e.sum += l.durationMs; e.n++; }
        m.set(k, e);
      }
      return m;
    };
    const byUserM = grp((l) => l.userId);
    const byHostM = grp((l) => l.host);
    const byUser = Array.from(byUserM.entries()).map(([userId, v]) => ({ userId, userEmail: v.sample.userEmail, runs: v.runs, errors: v.errors, avgMs: v.n ? Math.round(v.sum / v.n) : 0 })).sort((a, b) => b.runs - a.runs);
    const byHost = Array.from(byHostM.entries()).map(([host, v]) => ({ host, runs: v.runs, errors: v.errors, avgMs: v.n ? Math.round(v.sum / v.n) : 0 })).sort((a, b) => b.runs - a.runs);
    const runs = rows.length, errors = rows.filter((l) => l.status === "error").length;
    const durs = rows.filter((l) => typeof l.durationMs === "number");
    const avgMs = durs.length ? Math.round(durs.reduce((s, l) => s + (l.durationMs ?? 0), 0) / durs.length) : 0;
    return { byUser, byHost, totals: { runs, errors, avgMs } };
  }

  const where = opts.sinceMs != null ? gte(comfyUsageLogs.createdAt, new Date(opts.sinceMs)) : undefined;
  const [byUserRows, byHostRows, totalRows] = await Promise.all([
    db.select({ userId: comfyUsageLogs.userId, userEmail: comfyUsageLogs.userEmail, runs: sql<number>`COUNT(*)`, errors: errExpr, avgMs: avgExpr })
      .from(comfyUsageLogs).where(where).groupBy(comfyUsageLogs.userId, comfyUsageLogs.userEmail).orderBy(desc(sql`COUNT(*)`)).limit(50),
    db.select({ host: comfyUsageLogs.host, runs: sql<number>`COUNT(*)`, errors: errExpr, avgMs: avgExpr })
      .from(comfyUsageLogs).where(where).groupBy(comfyUsageLogs.host).orderBy(desc(sql`COUNT(*)`)).limit(50),
    db.select({ runs: sql<number>`COUNT(*)`, errors: errExpr, avgMs: avgExpr }).from(comfyUsageLogs).where(where),
  ]);
  const num = (v: unknown) => Math.round(Number(v ?? 0));
  return {
    byUser: byUserRows.map((r) => ({ userId: r.userId, userEmail: r.userEmail, runs: num(r.runs), errors: num(r.errors), avgMs: num(r.avgMs) })),
    byHost: byHostRows.map((r) => ({ host: r.host, runs: num(r.runs), errors: num(r.errors), avgMs: num(r.avgMs) })),
    totals: { runs: num(totalRows[0]?.runs), errors: num(totalRows[0]?.errors), avgMs: num(totalRows[0]?.avgMs) },
  };
}

export async function clearComfyUsageLogs(): Promise<void> {
  const db = await getDb();
  if (!db) { devComfyUsageLogs.splice(0); return; }
  await db.delete(comfyUsageLogs);
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

// Singleton server-mode channel where download requests are posted for admins.
// Keyed by dmKey for dedup; not E2E (server mode) so the server can post to it.
export async function getOrCreateDownloadChannel(): Promise<ChatConversation> {
  const existing = await getConversationByDmKey("system:download-approval");
  if (existing) return existing;
  return createConversation({ type: "group", mode: "server", title: "下载审批", dmKey: "system:download-approval", createdBy: null });
}

// 每用户专属「我的产物」通知房：server 模式（明文，机器人可推），dmKey 去重。
// 用户 + AI 助手 bot 为成员。生成产物自动推到这里，用户不进画布即可实时收/历史查。
export async function getOrCreateUserNotifyRoom(userId: number): Promise<ChatConversation> {
  const key = `system:notify:${userId}`;
  const existing = await getConversationByDmKey(key);
  if (existing) { await addChatMember(existing.id, userId, "owner"); return existing; }
  const room = await createConversation({ type: "group", mode: "server", title: "我的产物通知", dmKey: key, createdBy: null });
  await addChatMember(room.id, userId, "owner");
  try { await addChatMember(room.id, await getOrCreateAssistantUserId(), "member"); } catch { /* bot 成员非关键 */ }
  return room;
}

// ── 产物生成通知钩子（由 index.ts 注册，避免 db.ts ↔ chat.ts 循环依赖）──
export interface RecordedAssetInfo {
  userId: number; projectId?: number | null;
  type: "image" | "video" | "audio" | "other";
  url: string; name: string; mimeType?: string | null;
  provider?: string | null; model?: string | null;
}
let assetNotifier: ((a: RecordedAssetInfo) => void) | null = null;
export function registerAssetNotifier(fn: (a: RecordedAssetInfo) => void): void { assetNotifier = fn; }

// ── 用户产物推送 webhook 配置（每用户一行）──
export interface NotifyWebhookConfig { enabled: boolean; kind: string; url: string | null }
const _devWebhooks = new Map<number, NotifyWebhookConfig>(); // dev（无库）内存存储
export async function getUserWebhook(userId: number): Promise<NotifyWebhookConfig | null> {
  const db = await getDb();
  if (!db) return _devWebhooks.get(userId) ?? null;
  const rows = await db.select().from(notifyWebhooks).where(eq(notifyWebhooks.userId, userId)).limit(1);
  const r = rows[0];
  return r ? { enabled: r.enabled, kind: r.kind, url: r.url ?? null } : null;
}
export async function setUserWebhook(userId: number, cfg: NotifyWebhookConfig): Promise<void> {
  const db = await getDb();
  if (!db) { _devWebhooks.set(userId, cfg); return; }
  await db.insert(notifyWebhooks).values({ userId, enabled: cfg.enabled, kind: cfg.kind, url: cfg.url })
    .onDuplicateKeyUpdate({ set: { enabled: cfg.enabled, kind: cfg.kind, url: cfg.url } });
}

export async function createConversation(data: InsertChatConversation): Promise<ChatConversation> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devCreateConversation(data); throw new Error("DB unavailable"); }
  try {
    const [header] = await db.insert(chatConversations).values(data);
    const insertId = (header as unknown as { insertId: number }).insertId;
    const rows = await db.select().from(chatConversations).where(eq(chatConversations.id, insertId)).limit(1);
    return rows[0]!;
  } catch (e) {
    // Concurrent first-create of a dmKey-unique conversation (DM / download channel /
    // assistant): the `chat_conv_dmkey_uniq` index rejected our insert. Return the row
    // the sibling created instead of surfacing a 500.
    if (isDupEntryError(e) && data.dmKey) {
      const existing = await getConversationByDmKey(data.dmKey);
      if (existing) return existing;
    }
    throw e;
  }
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

/** Clear all MESSAGES (and their attachments) of a conversation, keeping the
 *  conversation itself. Used by the AI-assistant「新对话」reset. */
export async function clearConversationMessages(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(conversationMessages).where(eq(conversationMessages.conversationId, id));
  await db.delete(chatAttachments).where(eq(chatAttachments.conversationId, id));
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

export async function linkAttachmentsToMessage(messageId: number, attachmentIds: number[], conversationId: number): Promise<void> {
  if (!attachmentIds.length) return;
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devLinkAttachments(messageId, attachmentIds, conversationId); return; }
  // Scope by conversationId: the caller passes raw client-supplied attachmentIds, so
  // without this a member of conversation B could re-home conversation A's attachments
  // (write IDOR / cross-conversation attachment hijack). Only rows that already belong
  // to THIS conversation may be linked.
  await db.update(chatAttachments).set({ messageId })
    .where(and(inArray(chatAttachments.id, attachmentIds), eq(chatAttachments.conversationId, conversationId)));
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

export type WrappedRoomKey = { ciphertext: string; iv: string };
export type RoomKeyBundle = { senderPubJwk: unknown; wrappedKey: WrappedRoomKey };

/** Store per-member wrapped room keys (serverless group E2E). Server keeps ciphertext only. */
export async function putChatRoomKeyBundles(
  conversationId: number, senderPubJwk: unknown, bundles: { memberUserId: number; wrappedKey: WrappedRoomKey }[],
): Promise<void> {
  if (!bundles.length) return;
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devPutRoomKeyBundles(conversationId, senderPubJwk, bundles); return; }
  for (const b of bundles) {
    await db.insert(chatRoomKeys).values({ conversationId, memberUserId: b.memberUserId, senderPubJwk, wrappedKey: b.wrappedKey })
      .onDuplicateKeyUpdate({ set: { senderPubJwk, wrappedKey: b.wrappedKey, updatedAt: new Date() } });
  }
}

/** Fetch a member's wrapped room key for a conversation, or null. */
export async function getChatRoomKeyBundle(conversationId: number, memberUserId: number): Promise<RoomKeyBundle | null> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetRoomKeyBundle(conversationId, memberUserId) : null;
  const rows = await db.select().from(chatRoomKeys)
    .where(and(eq(chatRoomKeys.conversationId, conversationId), eq(chatRoomKeys.memberUserId, memberUserId))).limit(1);
  const r = rows[0];
  return r ? { senderPubJwk: r.senderPubJwk, wrappedKey: r.wrappedKey as WrappedRoomKey } : null;
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

/** Only reveal a user's email back to the searcher when the query IS that exact full
 *  email (they already know it — e.g. inviting by address). Substring/name matches get
 *  email=null, so nobody can harvest全站邮箱(PII) by enumerating with partial queries. */
export function redactSearchEmail<T extends { email: string | null }>(rows: T[], q: string): T[] {
  const qExact = q.trim().toLowerCase();
  return rows.map((u) => ({ ...u, email: u.email && u.email.toLowerCase() === qExact ? u.email : null }));
}

/** Search users by name/email for starting DMs or inviting (capped, excludes self). */
export async function searchUsersForChat(q: string, excludeUserId: number, limit = 20): Promise<{ id: number; name: string | null; email: string | null }[]> {
  const db = await getDb();
  if (!db) {
    if (DEV_MODE) return redactSearchEmail([{ id: 2, name: "Dev User 2", email: "dev2@localhost" as string | null }].filter((u) => u.id !== excludeUserId && (`${u.name}${u.email}`).toLowerCase().includes(q.toLowerCase())), q);
    return [];
  }
  const like = "%" + q + "%";
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users)
    .where(and(
      sql`(${users.name} LIKE ${like} OR ${users.email} LIKE ${like})`,
      sql`${users.id} <> ${excludeUserId}`,
      // AI 助手机器人不在人员搜索里出现（通过专用入口进入）。
      sql`${users.openId} <> ${ASSISTANT_OPEN_ID}`,
    ))
    .limit(limit);
  return redactSearchEmail(rows, q);
}

// ── Video Editor sessions ─────────────────────────────────────────────────────
export async function listEditSessions(userId: number): Promise<EditSession[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListEditSessions(userId) : [];
  return db.select().from(editSessions)
    .where(and(eq(editSessions.userId, userId), isNull(editSessions.deletedAt)))
    .orderBy(desc(editSessions.updatedAt));
}

export async function getEditSession(id: number, userId: number): Promise<EditSession | undefined> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetEditSession(id, userId) : undefined;
  const rows = await db.select().from(editSessions)
    .where(and(eq(editSessions.id, id), eq(editSessions.userId, userId), isNull(editSessions.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function createEditSession(data: InsertEditSession): Promise<EditSession | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devCreateEditSession(data); throw new Error("DB unavailable"); }
  const [header] = await db.insert(editSessions).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(editSessions).where(eq(editSessions.id, insertId));
  return rows[0] ?? null;
}

/** Update a session's doc/name/thumbnail. Scoped to the owner; no-op if not theirs. */
export async function updateEditSession(
  id: number,
  userId: number,
  patch: Partial<Pick<InsertEditSession, "name" | "doc" | "thumbnailUrl">>,
): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devUpdateEditSession(id, userId, patch); return; } throw new Error("DB unavailable"); }
  await db.update(editSessions).set(patch)
    .where(and(eq(editSessions.id, id), eq(editSessions.userId, userId)));
}

/** Soft-delete (hide from the user; row kept). */
export async function deleteEditSession(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devDeleteEditSession(id, userId); return; } throw new Error("DB unavailable"); }
  await db.update(editSessions).set({ deletedAt: new Date() })
    .where(and(eq(editSessions.id, id), eq(editSessions.userId, userId)));
}

// ── ComfyUI node template library (shared across all users) ────────────────────
export async function listComfyNodeTemplates(): Promise<ComfyNodeTemplateRow[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListComfyNodeTemplates() : [];
  return db.select().from(comfyNodeTemplates).orderBy(desc(comfyNodeTemplates.updatedAt));
}

export async function getComfyNodeTemplate(id: number): Promise<ComfyNodeTemplateRow | undefined> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetComfyNodeTemplate(id) : undefined;
  const rows = await db.select().from(comfyNodeTemplates).where(eq(comfyNodeTemplates.id, id)).limit(1);
  return rows[0];
}

export async function createComfyNodeTemplate(data: InsertComfyNodeTemplate): Promise<ComfyNodeTemplateRow | null> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) return dev.devCreateComfyNodeTemplate(data); throw new Error("DB unavailable"); }
  const [header] = await db.insert(comfyNodeTemplates).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(comfyNodeTemplates).where(eq(comfyNodeTemplates.id, insertId));
  return rows[0] ?? null;
}

export async function updateComfyNodeTemplate(
  id: number,
  patch: Partial<Pick<InsertComfyNodeTemplate, "label" | "note" | "payload" | "thumbnail" | "useCloud">>,
): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devUpdateComfyNodeTemplate(id, patch); return; } throw new Error("DB unavailable"); }
  await db.update(comfyNodeTemplates).set(patch).where(eq(comfyNodeTemplates.id, id));
}

export async function deleteComfyNodeTemplate(id: number): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { dev.devDeleteComfyNodeTemplate(id); return; } throw new Error("DB unavailable"); }
  await db.delete(comfyNodeTemplates).where(eq(comfyNodeTemplates.id, id));
}

// ── Global character library ──────────────────────────────────────────────────
// Dev-mode (no DB) uses a self-contained in-memory store so the feature works in
// the dev bypass without a database.
const _devCharLib: CharacterLibraryRow[] = [];
let _devCharLibSeq = 1;

export async function listCharacterLibrary(userId?: number): Promise<CharacterLibraryRow[]> {
  const db = await getDb();
  if (!db) {
    if (!DEV_MODE) return [];
    const rows = userId != null ? _devCharLib.filter((r) => r.userId === userId) : _devCharLib;
    return [...rows].sort((a, b) => +b.updatedAt - +a.updatedAt);
  }
  const q = db.select().from(characterLibrary);
  const rows = userId != null
    ? await q.where(eq(characterLibrary.userId, userId)).orderBy(desc(characterLibrary.updatedAt))
    : await q.orderBy(desc(characterLibrary.updatedAt));
  return rows;
}

export async function updateCharacterLibrary(id: number, patch: Partial<Pick<InsertCharacterLibrary, "name" | "note" | "payload" | "thumbnail">>): Promise<void> {
  const db = await getDb();
  if (!db) {
    if (DEV_MODE) { const r = _devCharLib.find((x) => x.id === id); if (r) Object.assign(r, patch, { updatedAt: new Date() }); return; }
    throw new Error("DB unavailable");
  }
  await db.update(characterLibrary).set(patch).where(eq(characterLibrary.id, id));
}

export async function getCharacterLibrary(id: number): Promise<CharacterLibraryRow | undefined> {
  const db = await getDb();
  if (!db) return DEV_MODE ? _devCharLib.find((r) => r.id === id) : undefined;
  const rows = await db.select().from(characterLibrary).where(eq(characterLibrary.id, id)).limit(1);
  return rows[0];
}

export async function createCharacterLibrary(data: InsertCharacterLibrary): Promise<CharacterLibraryRow | null> {
  const db = await getDb();
  if (!db) {
    if (!DEV_MODE) throw new Error("DB unavailable");
    const now = new Date();
    const row = { id: _devCharLibSeq++, creatorName: null, thumbnail: null, note: null, characterKind: "person", ...data, createdAt: now, updatedAt: now } as CharacterLibraryRow;
    _devCharLib.push(row);
    return row;
  }
  const [header] = await db.insert(characterLibrary).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(characterLibrary).where(eq(characterLibrary.id, insertId));
  return rows[0] ?? null;
}

export async function deleteCharacterLibrary(id: number): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { const i = _devCharLib.findIndex((r) => r.id === id); if (i >= 0) _devCharLib.splice(i, 1); return; } throw new Error("DB unavailable"); }
  await db.delete(characterLibrary).where(eq(characterLibrary.id, id));
}

// ── Prompt library（每用户私有；自定义提示词 + 10 个「/」快捷槽位）────────────────
const _devPromptLib: PromptLibraryRow[] = [];
let _devPromptLibSeq = 1;

export async function listPromptLibrary(userId: number): Promise<PromptLibraryRow[]> {
  const db = await getDb();
  if (!db) {
    if (!DEV_MODE) return [];
    return [..._devPromptLib.filter((r) => r.userId === userId)]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }
  return db.select().from(promptLibrary).where(eq(promptLibrary.userId, userId)).orderBy(promptLibrary.sortOrder);
}

export async function getPromptLibrary(id: number): Promise<PromptLibraryRow | undefined> {
  const db = await getDb();
  if (!db) return DEV_MODE ? _devPromptLib.find((r) => r.id === id) : undefined;
  const rows = await db.select().from(promptLibrary).where(eq(promptLibrary.id, id)).limit(1);
  return rows[0];
}

export async function createPromptLibrary(data: InsertPromptLibrary): Promise<PromptLibraryRow | null> {
  const db = await getDb();
  if (!db) {
    if (!DEV_MODE) throw new Error("DB unavailable");
    const now = new Date();
    const row = { id: _devPromptLibSeq++, category: "通用", slot: null, slotKind: null, sortOrder: 0, ...data, createdAt: now, updatedAt: now } as PromptLibraryRow;
    _devPromptLib.push(row);
    return row;
  }
  const [header] = await db.insert(promptLibrary).values(data);
  const insertId = (header as unknown as { insertId: number }).insertId;
  const rows = await db.select().from(promptLibrary).where(eq(promptLibrary.id, insertId));
  return rows[0] ?? null;
}

export async function updatePromptLibrary(id: number, patch: Partial<Pick<InsertPromptLibrary, "label" | "text" | "category" | "slot" | "slotKind" | "sortOrder">>): Promise<void> {
  const db = await getDb();
  if (!db) {
    if (DEV_MODE) { const r = _devPromptLib.find((x) => x.id === id); if (r) Object.assign(r, patch, { updatedAt: new Date() }); return; }
    throw new Error("DB unavailable");
  }
  await db.update(promptLibrary).set(patch).where(eq(promptLibrary.id, id));
}

export async function deletePromptLibrary(id: number): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { const i = _devPromptLib.findIndex((r) => r.id === id); if (i >= 0) _devPromptLib.splice(i, 1); return; } throw new Error("DB unavailable"); }
  await db.delete(promptLibrary).where(eq(promptLibrary.id, id));
}

// ── 通用 per-user 偏好（user_prefs，upsert by (userId, prefKey)）─────────────────
const _devUserPrefs = new Map<string, unknown>(); // key = `${userId}:${prefKey}`

export async function getUserPref(userId: number, prefKey: string): Promise<unknown | undefined> {
  const db = await getDb();
  if (!db) return DEV_MODE ? _devUserPrefs.get(`${userId}:${prefKey}`) : undefined;
  const rows = await db.select().from(userPrefs).where(and(eq(userPrefs.userId, userId), eq(userPrefs.prefKey, prefKey))).limit(1);
  return rows[0]?.value;
}

export async function setUserPref(userId: number, prefKey: string, value: unknown): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) { _devUserPrefs.set(`${userId}:${prefKey}`, value); return; } throw new Error("DB unavailable"); }
  await db.insert(userPrefs).values({ userId, prefKey, value }).onDuplicateKeyUpdate({ set: { value } });
}

// ── ComfyUI template analysis (agent planning knowledge) ──────────────────────
export async function listComfyTemplateAnalysis(): Promise<ComfyTemplateAnalysisRow[]> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devListComfyTemplateAnalysis() : [];
  return db.select().from(comfyTemplateAnalysis);
}

export async function getComfyTemplateAnalysis(templateId: number): Promise<ComfyTemplateAnalysisRow | undefined> {
  const db = await getDb();
  if (!db) return DEV_MODE ? dev.devGetComfyTemplateAnalysis(templateId) : undefined;
  const rows = await db.select().from(comfyTemplateAnalysis).where(eq(comfyTemplateAnalysis.templateId, templateId)).limit(1);
  return rows[0];
}

export async function upsertComfyTemplateAnalysis(data: InsertComfyTemplateAnalysis): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devUpsertComfyTemplateAnalysis(data); return; }
  await db.insert(comfyTemplateAnalysis).values(data).onDuplicateKeyUpdate({
    set: {
      functionSummary: data.functionSummary,
      capabilities: data.capabilities,
      outputType: data.outputType,
      hasVideoOutput: data.hasVideoOutput,
      modelNames: data.modelNames,
      // maxFrames/fps MUST be refreshed on re-analysis too (e.g. v1→v2 upgrade adds
      // them) — omitting them here previously left upgraded rows with NULL duration,
      // so the agent couldn't plan shot counts by per-shot length.
      maxFrames: data.maxFrames ?? null,
      fps: data.fps ?? null,
      analysisVersion: data.analysisVersion ?? 1,
      model: data.model,
      analyzedAt: new Date(),
    },
  });
}

/** Delete one template's analysis row (called when the template is deleted, and
 *  to prune orphans). No-op when absent. */
export async function deleteComfyTemplateAnalysis(templateId: number): Promise<void> {
  const db = await getDb();
  if (!db) { if (DEV_MODE) dev.devDeleteComfyTemplateAnalysis(templateId); return; }
  await db.delete(comfyTemplateAnalysis).where(eq(comfyTemplateAnalysis.templateId, templateId));
}

// ── ComfyUI 压测历史 / 模板 ───────────────────────────────────────────────────
// 历史：任务结束（completed/cancelled/failed）由 comfyStress core 自动落库。
// dev bypass（无 DB）时静默跳过——压测页本就是管理员专属，dev 下不可达。

// 强健自愈：每次压测读写前确保两张表存在（CREATE TABLE IF NOT EXISTS 幂等）。
// 不依赖启动时序/迁移是否跑过——只要 DB 可连，查询路径自身保证表可用。memo 一次即可，
// 失败不缓存（下次重试）；DDL 隐式提交，对后续 DML 无副作用。
let _stressTablesReady: Promise<void> | null = null;
async function ensureStressTables(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<void> {
  if (_stressTablesReady) return _stressTablesReady;
  _stressTablesReady = (async () => {
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`comfy_stress_history\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`jobId\` VARCHAR(64) NOT NULL UNIQUE,
      \`status\` VARCHAR(16) NOT NULL,
      \`startedByEmail\` VARCHAR(255),
      \`config\` JSON,
      \`result\` JSON NOT NULL,
      \`startedAt\` TIMESTAMP NOT NULL,
      \`finishedAt\` TIMESTAMP NULL,
      \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX \`csh_startedAt_idx\` (\`startedAt\`)
    )`));
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`comfy_stress_templates\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`name\` VARCHAR(128) NOT NULL,
      \`config\` JSON NOT NULL,
      \`createdByEmail\` VARCHAR(255),
      \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX \`cst_updatedAt_idx\` (\`updatedAt\`)
    )`));
    // 存量表幂等补排序索引（MySQL 无 ADD INDEX IF NOT EXISTS → information_schema 守卫）。
    // ORDER BY 走索引避免 filesort，是 1038 Out-of-sort-memory 的第二道防线
    // （第一道是 list 的两步查询，见下）。
    for (const [table, index, column] of [
      ["comfy_stress_history", "csh_startedAt_idx", "startedAt"],
      ["comfy_stress_templates", "cst_updatedAt_idx", "updatedAt"],
    ] as const) {
      const res = await db.execute(sql.raw(
        `SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND INDEX_NAME = '${index}'`,
      ));
      const rows = (Array.isArray(res) ? res[0] : res) as unknown as Array<{ n?: number | string }>;
      if (Number(rows?.[0]?.n ?? 0) === 0) {
        await db.execute(sql.raw(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` (\`${column}\`)`));
      }
    }
  })();
  try { await _stressTablesReady; }
  catch (e) { _stressTablesReady = null; throw e; } // 失败不缓存，下次重试
}

export async function insertComfyStressHistory(row: {
  jobId: string; status: string; startedByEmail: string | null;
  config: unknown; result: unknown; startedAt: Date; finishedAt: Date | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await ensureStressTables(db);
  await db.insert(comfyStressHistory).values(row).onDuplicateKeyUpdate({
    set: { status: row.status, result: row.result, finishedAt: row.finishedAt },
  });
}

export async function listComfyStressHistory(limit = 50): Promise<ComfyStressHistoryRow[]> {
  const db = await getDb();
  if (!db) return [];
  await ensureStressTables(db);
  // 两步查询：history.result 是 MB 级 JSON（含 timeSeries），直接
  // SELECT * ORDER BY startedAt 会让 MySQL filesort 把巨大行塞进 sort buffer，
  // 触发 1038 "Out of sort memory"。先只排序 id+startedAt 小行，再按 id 取整行、
  // JS 里恢复顺序——不依赖索引与 DB 参数。
  const idRows = await db
    .select({ id: comfyStressHistory.id })
    .from(comfyStressHistory)
    .orderBy(desc(comfyStressHistory.startedAt))
    .limit(limit);
  if (idRows.length === 0) return [];
  const ids = idRows.map((r) => r.id);
  const rows = await db.select().from(comfyStressHistory).where(inArray(comfyStressHistory.id, ids));
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function deleteComfyStressHistory(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await ensureStressTables(db);
  await db.delete(comfyStressHistory).where(eq(comfyStressHistory.id, id));
}

export async function clearComfyStressHistory(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await ensureStressTables(db);
  await db.delete(comfyStressHistory);
}

export async function listComfyStressTemplates(): Promise<ComfyStressTemplateRow[]> {
  const db = await getDb();
  if (!db) return [];
  await ensureStressTables(db);
  // 同 history：config 可含 2MB 工作流 JSON，避免大行 filesort（1038）→ 两步查询。
  const idRows = await db
    .select({ id: comfyStressTemplates.id })
    .from(comfyStressTemplates)
    .orderBy(desc(comfyStressTemplates.updatedAt));
  if (idRows.length === 0) return [];
  const ids = idRows.map((r) => r.id);
  const rows = await db.select().from(comfyStressTemplates).where(inArray(comfyStressTemplates.id, ids));
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function saveComfyStressTemplate(name: string, config: unknown, createdByEmail: string | null): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await ensureStressTables(db);
  await db.insert(comfyStressTemplates).values({ name, config, createdByEmail });
}

export async function deleteComfyStressTemplate(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await ensureStressTables(db);
  await db.delete(comfyStressTemplates).where(eq(comfyStressTemplates.id, id));
}

// ── ComfyUI 运维中心（ops center）─────────────────────────────────────────────
// All helpers require a real DB (admin feature). In dev-bypass (no DATABASE_URL)
// they return empty/no-op so the app still boots, but the ops center is inert.

export async function listOpsServers(): Promise<ComfyOpsServer[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(comfyOpsServers).orderBy(desc(comfyOpsServers.createdAt));
}

export async function getOpsServer(id: number): Promise<ComfyOpsServer | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(comfyOpsServers).where(eq(comfyOpsServers.id, id)).limit(1);
  return row ?? null;
}

export async function insertOpsServer(data: InsertComfyOpsServer): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("运维中心需要数据库（未配置 DATABASE_URL）");
  const [header] = await db.insert(comfyOpsServers).values(data);
  return Number(header.insertId);
}

export async function updateOpsServer(id: number, patch: Partial<InsertComfyOpsServer>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(comfyOpsServers).set(patch).where(eq(comfyOpsServers.id, id));
}

export async function deleteOpsServer(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(comfyOpsServers).where(eq(comfyOpsServers.id, id));
}

export async function listOpsScripts(): Promise<ComfyOpsScript[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(comfyOpsScripts).orderBy(desc(comfyOpsScripts.updatedAt));
}

export async function insertOpsScript(data: InsertComfyOpsScript): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("运维中心需要数据库");
  const [header] = await db.insert(comfyOpsScripts).values(data);
  return Number(header.insertId);
}

export async function updateOpsScript(id: number, patch: Partial<InsertComfyOpsScript>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(comfyOpsScripts).set(patch).where(eq(comfyOpsScripts.id, id));
}

export async function deleteOpsScript(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(comfyOpsScripts).where(eq(comfyOpsScripts.id, id));
}

export async function insertOpsRecord(data: InsertComfyOpsRecord): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(comfyOpsRecords).values(data);
}

export async function listOpsRecords(opts: { serverId?: number; limit?: number } = {}): Promise<ComfyOpsRecord[]> {
  const db = await getDb();
  if (!db) return [];
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const base = db.select().from(comfyOpsRecords);
  const rows = opts.serverId != null
    ? await base.where(eq(comfyOpsRecords.serverId, opts.serverId)).orderBy(desc(comfyOpsRecords.createdAt)).limit(limit)
    : await base.orderBy(desc(comfyOpsRecords.createdAt)).limit(limit);
  return rows;
}

export async function getOpsSettings(): Promise<ComfyOpsSettings> {
  const db = await getDb();
  if (!db) return { id: 1, globalTrustMode: false, autoExecWhitelist: null, readOnlyOpenToWhitelist: true };
  const [row] = await db.select().from(comfyOpsSettings).where(eq(comfyOpsSettings.id, 1)).limit(1);
  return row ?? { id: 1, globalTrustMode: false, autoExecWhitelist: null, readOnlyOpenToWhitelist: true };
}

export async function setOpsSettings(patch: Partial<Omit<ComfyOpsSettings, "id">>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(comfyOpsSettings).values({ id: 1, ...patch })
    .onDuplicateKeyUpdate({ set: patch });
}
