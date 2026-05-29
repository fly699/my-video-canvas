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
  /** Multimodal attachments: Array<{ type, url, mimeType, name }>. NULL = legacy text-only message. */
  attachments: json("attachments"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

// ── LAN Chat ──────────────────────────────────────────────────────────────────
// Anonymous nickname-only group chat. Users behind the same NAT gateway
// (same outbound public IP as seen by this server) auto-share a "network
// group" and can chat with each other — exactly like a LAN chat where
// everyone in the same office sees the same rooms. Across-network
// isolation is enforced by filtering rooms + messages on networkGroupId
// (= the requesting user's clientIp).
//
// No coupling to users/projects — content lives entirely in these two
// tables so the feature can be uninstalled without touching the rest of
// the schema.

export const lanChatRooms = mysqlTable("lan_chat_rooms", {
  id: int("id").autoincrement().primaryKey(),
  /** The shared NAT gateway IP that owns this room. All members must
   *  reach the server from this address to see it. */
  networkGroupId: varchar("networkGroupId", { length: 64 }).notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  /** scrypt(password, salt) hash for private rooms. Null = public room.
   *  Set at createRoom time; verified at enterRoom time. Wrong password
   *  → server refuses to add the session to the room's presence map,
   *  so the requester can't see the room's mesh peers and vice versa. */
  passwordHash: varchar("passwordHash", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  networkNameUniq: uniqueIndex("lan_rooms_network_name_uniq").on(t.networkGroupId, t.name),
}));

export type LanChatRoomRow = typeof lanChatRooms.$inferSelect;
export type InsertLanChatRoom = typeof lanChatRooms.$inferInsert;

/** One-time DB-backed invite codes for the LAN chat. Each row, when
 *  redeemed, grants the bearer membership in `groupId` regardless of
 *  their actual outbound public IP. Atomic UPDATE WHERE usedAt IS NULL
 *  AND expiresAt > NOW() ensures concurrent redemptions can't both win. */
export const lanChatInvites = mysqlTable("lan_chat_invites", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  groupId: varchar("groupId", { length: 64 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  usedByNickname: varchar("usedByNickname", { length: 64 }),
  usedByIp: varchar("usedByIp", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LanChatInviteRow = typeof lanChatInvites.$inferSelect;
export type InsertLanChatInvite = typeof lanChatInvites.$inferInsert;

/** Admin-managed public-IP whitelist for the LAN chat. When the
 *  corresponding setting toggle is on, joinSession refuses any IP
 *  not listed here. App-wide whitelist (whitelistEntries) is left
 *  alone — LAN chat is its own scope. */
export const lanChatIpWhitelist = mysqlTable("lan_chat_ip_whitelist", {
  id: int("id").autoincrement().primaryKey(),
  ip: varchar("ip", { length: 64 }).notNull().unique(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LanChatIpWhitelistRow = typeof lanChatIpWhitelist.$inferSelect;
export type InsertLanChatIpWhitelist = typeof lanChatIpWhitelist.$inferInsert;

/** Single-row settings table (id always 1). */
export const lanChatSettings = mysqlTable("lan_chat_settings", {
  id: int("id").autoincrement().primaryKey(),
  ipWhitelistEnabled: boolean("ipWhitelistEnabled").notNull().default(false),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LanChatSettingsRow = typeof lanChatSettings.$inferSelect;

// Messages carry a snapshot of the sender's nickname + color so historical
// reads still render the right author/badge even after the in-memory session
// expires. clientIp is captured for audit + same-IP nickname reuse — kept
// short (IPv6 max 39 chars) and never exposed to the client.
export const lanChatMessages = mysqlTable("lan_chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  roomId: int("roomId").notNull(),
  nickname: varchar("nickname", { length: 64 }).notNull(),
  color: varchar("color", { length: 16 }).notNull(),
  content: text("content").notNull(),
  attachments: json("attachments"),
  clientIp: varchar("clientIp", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  roomCreatedIdx: index("lan_chat_msgs_room_created_idx").on(t.roomId, t.createdAt),
}));

export type LanChatMessageRow = typeof lanChatMessages.$inferSelect;
export type InsertLanChatMessage = typeof lanChatMessages.$inferInsert;

// ── Account-based Chat (server/serverless rewrite) ──────────────────────────────
// Real user-account chat replacing the old anonymous LAN chat. Two modes per
// conversation:
//   - "server":     messages + files persisted here as plaintext → full history,
//                   admin-queryable.
//   - "serverless": end-to-end encrypted; the server only relays ciphertext over
//                   Socket.IO and NEVER persists it (no rows in
//                   conversation_messages). History lives only on each client.
// Conversation forms: global "lobby", multi-user "group" rooms (optional
// password), and 1:1 "dm".

export const chatConversations = mysqlTable("chat_conversations", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", ["lobby", "group", "dm"]).notNull(),
  mode: mysqlEnum("mode", ["server", "serverless"]).notNull().default("server"),
  /** Display title. Null for dm/lobby (derived client-side from members). */
  title: varchar("title", { length: 120 }),
  /** scrypt hash for password-protected group rooms. Null = open room. */
  passwordHash: varchar("passwordHash", { length: 255 }),
  /** users.id of the creator. Null for the system lobby. */
  createdBy: int("createdBy"),
  /** Dedup key for DMs: "dm:<minUserId>:<maxUserId>". Null for lobby/group. */
  dmKey: varchar("dmKey", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  typeModeIdx: index("chat_conv_type_mode_idx").on(t.type, t.mode),
  dmKeyUniq: uniqueIndex("chat_conv_dmkey_uniq").on(t.dmKey),
}));

export type ChatConversation = typeof chatConversations.$inferSelect;
export type InsertChatConversation = typeof chatConversations.$inferInsert;

export const chatMembers = mysqlTable("chat_members", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["owner", "member"]).notNull().default("member"),
  /** Highest message id this member has read — drives unread counts (server mode). */
  lastReadMessageId: int("lastReadMessageId").notNull().default(0),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
}, (t) => ({
  convUserUniq: uniqueIndex("chat_members_conv_user_uniq").on(t.conversationId, t.userId),
  userIdx: index("chat_members_user_idx").on(t.userId),
}));

export type ChatMember = typeof chatMembers.$inferSelect;
export type InsertChatMember = typeof chatMembers.$inferInsert;

// NOTE: table is named "conversation_messages" (NOT chat_messages) to avoid
// colliding with the existing canvas AI-chat table above. Rows here ONLY exist
// for server-mode conversations; serverless content is never written.
export const conversationMessages = mysqlTable("conversation_messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  senderId: int("senderId").notNull(),
  /** Snapshot of sender display name at send time. */
  senderName: varchar("senderName", { length: 120 }).notNull(),
  content: text("content").notNull(),
  /** Array<{ attachmentId, name, mimeType, size, url, kind }>. Null = text only. */
  attachments: json("attachments"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  convCreatedIdx: index("conv_msgs_conv_created_idx").on(t.conversationId, t.createdAt),
  convIdIdx: index("conv_msgs_conv_id_idx").on(t.conversationId, t.id),
}));

export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type InsertConversationMessage = typeof conversationMessages.$inferInsert;

// Server-mode file metadata. Binary lives in storage (storagePut); this row
// records the reference so file history is queryable. Uploaded first (messageId
// null), then linked when the message row is created.
export const chatAttachments = mysqlTable("chat_attachments", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  messageId: int("messageId"),
  uploaderId: int("uploaderId").notNull(),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  url: text("url").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  size: int("size").notNull(),
  kind: mysqlEnum("kind", ["image", "video", "file"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  convIdx: index("chat_attach_conv_idx").on(t.conversationId),
  msgIdx: index("chat_attach_msg_idx").on(t.messageId),
}));

export type ChatAttachment = typeof chatAttachments.$inferSelect;
export type InsertChatAttachment = typeof chatAttachments.$inferInsert;

// E2E public keys (serverless mode). One active ECDH P-256 public key per user,
// stored as JWK. The matching private key NEVER leaves the client (IndexedDB).
export const chatUserKeys = mysqlTable("chat_user_keys", {
  userId: int("userId").primaryKey(),
  publicKeyJwk: json("publicKeyJwk").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ChatUserKey = typeof chatUserKeys.$inferSelect;
export type InsertChatUserKey = typeof chatUserKeys.$inferInsert;

export const chatBans = mysqlTable("chat_bans", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  scope: mysqlEnum("scope", ["global", "conversation"]).notNull(),
  /** Null when scope = global. */
  conversationId: int("conversationId"),
  reason: varchar("reason", { length: 255 }),
  bannedBy: int("bannedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  banUniq: uniqueIndex("chat_bans_user_scope_conv_uniq").on(t.userId, t.scope, t.conversationId),
}));

export type ChatBan = typeof chatBans.$inferSelect;
export type InsertChatBan = typeof chatBans.$inferInsert;

/** Single-row settings table (id always 1). */
export const chatSettings = mysqlTable("chat_settings", {
  id: int("id").autoincrement().primaryKey(),
  serverlessAllowed: boolean("serverlessAllowed").notNull().default(true),
  lobbyEnabled: boolean("lobbyEnabled").notNull().default(true),
  maxFileMb: int("maxFileMb").notNull().default(16),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ChatSettingsRow = typeof chatSettings.$inferSelect;

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
export const storageSettings = mysqlTable("storageSettings", {
  id: int("id").autoincrement().primaryKey(),
  persistAudio: boolean("persistAudio").notNull().default(true),
  persistVideo: boolean("persistVideo").notNull().default(true),
  persistImage: boolean("persistImage").notNull().default(true),
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
