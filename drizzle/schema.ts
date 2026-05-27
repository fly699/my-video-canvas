import {
  int,
  index,
  uniqueIndex,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
  float,
  boolean,
} from "drizzle-orm/mysql-core";
import { VIDEO_PROVIDERS } from "../shared/types";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ── Canvas Projects ──────────────────────────────────────────────────────────
export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  thumbnail: text("thumbnail"),
  /** Viewport state: { x, y, scale } */
  viewportState: json("viewportState"),
  /** When true, any authenticated user with the URL can view (read-only). */
  publicReadAccess: boolean("publicReadAccess").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

// ── Project Collaborators ────────────────────────────────────────────────────
// One row per (project, member). userId is nullable when the invite targets
// an email that has not registered yet — at signup time we claim those rows.
// The project owner is NOT stored here; it lives in projects.userId.
export const projectCollaborators = mysqlTable("project_collaborators", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId"),
  email: varchar("email", { length: 320 }),
  role: mysqlEnum("role", ["viewer", "editor", "admin"]).notNull(),
  invitedBy: int("invitedBy").notNull(),
  status: mysqlEnum("status", ["pending", "active"]).notNull().default("active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  projectUserIdx: index("project_collab_project_user_idx").on(t.projectId, t.userId),
  emailIdx: index("project_collab_email_idx").on(t.email),
}));

export type ProjectCollaborator = typeof projectCollaborators.$inferSelect;
export type InsertProjectCollaborator = typeof projectCollaborators.$inferInsert;

// ── Project Share Links ──────────────────────────────────────────────────────
// One-time / multi-use invite tokens. When a link is "consumed", the consumer
// is added to project_collaborators as an active member with the link's role.
// Anti-replay via usesCount < maxUses AND expiresAt > now.
export const projectShareLinks = mysqlTable("project_share_links", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  projectId: int("projectId").notNull(),
  role: mysqlEnum("role", ["viewer", "editor", "admin"]).notNull(),
  maxUses: int("maxUses").notNull().default(1),
  usesCount: int("usesCount").notNull().default(0),
  expiresAt: timestamp("expiresAt").notNull(),
  createdBy: int("createdBy").notNull(),
  revokedAt: timestamp("revokedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("share_links_project_idx").on(t.projectId),
}));

export type ProjectShareLink = typeof projectShareLinks.$inferSelect;
export type InsertProjectShareLink = typeof projectShareLinks.$inferInsert;

// ── Canvas Nodes ─────────────────────────────────────────────────────────────
export const canvasNodes = mysqlTable("canvas_nodes", {
  id: varchar("id", { length: 64 }).primaryKey(), // nanoid
  projectId: int("projectId").notNull(),
  type: mysqlEnum("type", [
    "script",
    "storyboard",
    "prompt",
    "image_gen",
    "asset",
    "video_task",
    "ai_chat",
    "note",
    "audio",
    "post_process",
    "group",
    "character",
    "clip",
    "merge",
    "subtitle",
    "overlay",
    "subtitle_motion",
    "smart_cut",
    "pose_control",
    "voice_clone",
    "lip_sync",
    "avatar",
    "comfyui_image",
    "comfyui_video",
    "comfyui_workflow",
  ]).notNull(),
  title: varchar("title", { length: 255 }),
  /** Node-type-specific data (content, promptText, imageUrl, etc.) */
  data: json("data"),
  posX: float("posX").notNull().default(0),
  posY: float("posY").notNull().default(0),
  width: float("width").notNull().default(320),
  height: float("height").notNull().default(200),
  zIndex: int("zIndex").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CanvasNode = typeof canvasNodes.$inferSelect;
export type InsertCanvasNode = typeof canvasNodes.$inferInsert;

// ── Canvas Edges ─────────────────────────────────────────────────────────────
export const canvasEdges = mysqlTable("canvas_edges", {
  id: varchar("id", { length: 64 }).primaryKey(),
  projectId: int("projectId").notNull(),
  sourceNodeId: varchar("sourceNodeId", { length: 64 }).notNull(),
  targetNodeId: varchar("targetNodeId", { length: 64 }).notNull(),
  sourcePort: varchar("sourcePort", { length: 32 }).default("output"),
  targetPort: varchar("targetPort", { length: 32 }).default("input"),
  label: varchar("label", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CanvasEdge = typeof canvasEdges.$inferSelect;
export type InsertCanvasEdge = typeof canvasEdges.$inferInsert;

// ── Assets ───────────────────────────────────────────────────────────────────
export const assets = mysqlTable("assets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId"),
  name: varchar("name", { length: 255 }).notNull(),
  type: mysqlEnum("type", ["image", "video", "audio", "other"]).notNull(),
  mimeType: varchar("mimeType", { length: 128 }),
  size: int("size"),
  storageKey: text("storageKey").notNull(),
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnailUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Asset = typeof assets.$inferSelect;
export type InsertAsset = typeof assets.$inferInsert;

// ── Video Tasks ───────────────────────────────────────────────────────────────
export const videoTasks = mysqlTable("video_tasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId").notNull(),
  nodeId: varchar("nodeId", { length: 64 }).notNull(),
  provider: mysqlEnum("provider", [...VIDEO_PROVIDERS] as [string, ...string[]]).notNull(),
  externalTaskId: varchar("externalTaskId", { length: 255 }),
  status: mysqlEnum("status", [
    "pending",
    "processing",
    "succeeded",
    "failed",
  ])
    .notNull()
    .default("pending"),
  prompt: text("prompt"),
  negativePrompt: text("negativePrompt"),
  referenceImageUrl: text("referenceImageUrl"),
  resultVideoUrl: text("resultVideoUrl"),
  resultStorageKey: text("resultStorageKey"),
  errorMessage: text("errorMessage"),
  params: json("params"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoTask = typeof videoTasks.$inferSelect;
export type InsertVideoTask = typeof videoTasks.$inferInsert;

// ── AI Chat Messages ──────────────────────────────────────────────────────────
export const chatMessages = mysqlTable("chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  nodeId: varchar("nodeId", { length: 64 }).notNull(),
  projectId: int("projectId").notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

// ── Whitelist ─────────────────────────────────────────────────────────────────

export const whitelistSettings = mysqlTable("whitelistSettings", {
  id: int("id").autoincrement().primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Storage persistence toggles — when persistAudio/persistVideo/persistImage
// is false, generated media is left at the upstream provider's CDN URL
// (Poyo: 24h TTL, Higgsfield: temporary CDN). Useful to save Manus S3
// quota on dev/preview deployments. Defaults: persistence ON.
//
// IMPORTANT: persistImage is INTENTIONALLY omitted from the drizzle column
// list even though migration 0017 adds it. Manus deployments that haven't
// yet run `pnpm db:push` would otherwise hit "unknown column persistImage"
// on every SELECT/INSERT — bricking the entire storage settings panel.
// All reads/writes of persistImage go through raw SQL inside db.ts so the
// missing-column case can be handled gracefully (defaults to true, write
// surfaces a clear migration-required error).
export const storageSettings = mysqlTable("storageSettings", {
  id: int("id").autoincrement().primaryKey(),
  persistAudio: boolean("persistAudio").notNull().default(true),
  persistVideo: boolean("persistVideo").notNull().default(true),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const whitelistEntries = mysqlTable("whitelistEntries", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", ["ip", "user"]).notNull(),
  value: varchar("value", { length: 320 }).notNull(),
  note: text("note"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  typeValueUniq: uniqueIndex("whitelistEntries_type_value_unique").on(t.type, t.value),
}));

export type WhitelistEntry = typeof whitelistEntries.$inferSelect;
export type InsertWhitelistEntry = typeof whitelistEntries.$inferInsert;

// ── Audit Logs ────────────────────────────────────────────────────────────────

export const auditLogs = mysqlTable("auditLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  userEmail: varchar("userEmail", { length: 320 }),
  userName: varchar("userName", { length: 255 }),
  ip: varchar("ip", { length: 64 }).notNull(),
  country: varchar("country", { length: 64 }),
  region: varchar("region", { length: 128 }),
  city: varchar("city", { length: 128 }),
  action: varchar("action", { length: 64 }).notNull(),
  detail: json("detail"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  userIdIdx: index("auditLogs_userId_idx").on(t.userId),
  actionIdx: index("auditLogs_action_idx").on(t.action),
  createdAtIdx: index("auditLogs_createdAt_idx").on(t.createdAt),
}));

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;
