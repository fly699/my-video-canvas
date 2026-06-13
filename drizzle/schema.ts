import {
  int,
  bigint,
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

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  // 冻结：true=禁止登录（管理员可冻结/解冻）。
  disabled: boolean("disabled").notNull().default(false),
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
  /** Per-node-type default model config (NodeDefaultModelsConfig). Editable from toolbar. */
  defaultModels: json("defaultModels"),
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
    "agent",
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
  // BIGINT: video uploads can exceed the signed-INT max (~2.1GB). (#1)
  size: bigint("size", { mode: "number" }),
  storageKey: text("storageKey").notNull(),
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnailUrl"),
  // Unified media library: each row is one of these sources.
  source: mysqlEnum("source", ["upload", "generated", "external"]).notNull().default("upload"),
  provider: varchar("provider", { length: 32 }),   // poyo|higgsfield|openai|forge|comfyui|edit|manus
  model: varchar("model", { length: 128 }),         // generating model / checkpoint / template
  nodeId: varchar("nodeId", { length: 64 }),        // canvas node that produced it (if any)
  deletedAt: timestamp("deletedAt"),                // soft delete: hidden from user, file kept in MinIO
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Asset = typeof assets.$inferSelect;
export type InsertAsset = typeof assets.$inferInsert;

// ── Video Editor sessions ───────────────────────────────────────────────────
// One row per saved timeline-editor document. `doc` holds the full EDL
// (tracks/clips/effects) the front-end edits; the server renders it in a single
// ffmpeg pass on export. Soft-deletable; not tied to a canvas project (optional
// link via projectId for "import from canvas").
export const editSessions = mysqlTable("edit_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId"),                       // optional link to a canvas project
  name: varchar("name", { length: 255 }).notNull().default("未命名剪辑"),
  doc: json("doc").notNull(),                         // EditorDoc JSON
  thumbnailUrl: text("thumbnailUrl"),
  deletedAt: timestamp("deletedAt"),                  // soft delete: hidden from user
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdx: index("edit_sessions_user_idx").on(t.userId),
}));

export type EditSession = typeof editSessions.$inferSelect;
export type InsertEditSession = typeof editSessions.$inferInsert;

// ── ComfyUI node template library ──────────────────────────────────────────────
// Shared across ALL users: any logged-in user can add; everyone can view/use;
// only the creator (or an admin) may edit/delete. `payload` holds the sanitized
// node parameters (prompts / models / workflow JSON) so a template re-creates a
// fully-configured node. No thumbnail/output is stored.
export const comfyNodeTemplates = mysqlTable("comfy_node_templates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),                          // creator
  creatorName: varchar("creatorName", { length: 255 }),     // display name (denormalized)
  label: varchar("label", { length: 64 }).notNull(),
  nodeType: varchar("nodeType", { length: 32 }).notNull(),  // comfyui_image|video|workflow
  payload: json("payload").notNull(),
  note: text("note"),
  thumbnail: text("thumbnail"),                             // generated-image URL captured at save (not exported)
  useCloud: boolean("useCloud"),                            // workflow: local vs cloud (card color)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  typeIdx: index("comfy_node_templates_type_idx").on(t.nodeType),
}));

export type ComfyNodeTemplateRow = typeof comfyNodeTemplates.$inferSelect;
export type InsertComfyNodeTemplate = typeof comfyNodeTemplates.$inferInsert;

// ── Global character library (reusable identities across projects/canvases) ────
// One row per saved character/scene. `payload` holds the full CharacterNodeData
// so it can be re-instantiated as a node anywhere. Shared library (all users see
// all entries); creator/admin may edit/delete (enforced in the router).
export const characterLibrary = mysqlTable("character_library", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),                          // creator
  creatorName: varchar("creatorName", { length: 255 }),     // display name (denormalized)
  name: varchar("name", { length: 120 }).notNull(),         // library display name
  characterKind: varchar("characterKind", { length: 16 }).notNull().default("person"), // person|scene
  payload: json("payload").notNull(),                       // full CharacterNodeData
  thumbnail: text("thumbnail"),                             // reference-image URL captured at save
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdx: index("character_library_user_idx").on(t.userId),
  kindIdx: index("character_library_kind_idx").on(t.characterKind),
}));

export type CharacterLibraryRow = typeof characterLibrary.$inferSelect;
export type InsertCharacterLibrary = typeof characterLibrary.$inferInsert;

// ── Quick prompt library (per-user custom prompts + 10 favorite quick-slots) ───
// 每行是用户的一个自定义提示词，按 category 分组。slot(0..9) 非空时该行占用一个
// 「/」快捷槽位：slotKind="prompt" 表示直接插入其 text；slotKind="category" 表示该槽位
// 是一个类别入口，点击展开 `category` 下的二级菜单。私有库（每用户只见自己的）。
export const promptLibrary = mysqlTable("prompt_library", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  label: varchar("label", { length: 120 }).notNull(),
  text: text("text").notNull(),
  category: varchar("category", { length: 120 }).notNull().default("通用"),
  slot: int("slot"),                                  // 0..9 占用快捷槽位；否则 null
  slotKind: varchar("slotKind", { length: 16 }),      // slot 非空时："prompt" | "category"
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdx: index("prompt_library_user_idx").on(t.userId),
}));

export type PromptLibraryRow = typeof promptLibrary.$inferSelect;
export type InsertPromptLibrary = typeof promptLibrary.$inferInsert;

// ── Per-user preferences (通用偏好 KV) ────────────────────────────────────────
// 每用户一组 (prefKey → JSON value) 偏好，唯一 (userId, prefKey)。首个用途：拉线建
// 节点菜单的节点类型自定义排序（prefKey="connectMenuOrder"，value=节点类型 id 数组）。
export const userPrefs = mysqlTable("user_prefs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  prefKey: varchar("prefKey", { length: 64 }).notNull(),
  value: json("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userKeyUniq: uniqueIndex("user_prefs_user_key_uniq").on(t.userId, t.prefKey),
}));

export type UserPrefRow = typeof userPrefs.$inferSelect;
export type InsertUserPref = typeof userPrefs.$inferInsert;

// ── ComfyUI stress-test persistence ───────────────────────────────────────────
// History: one row per finished stress job (auto-saved by the core when a job
// reaches completed/cancelled/failed). `result` is the full StressJobView
// (stats + per-server + timeSeries + errorSamples) so the UI can re-render
// charts for past runs. `config` is the start parameters summary.
export const comfyStressHistory = mysqlTable("comfy_stress_history", {
  id: int("id").autoincrement().primaryKey(),
  jobId: varchar("jobId", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 16 }).notNull(),
  startedByEmail: varchar("startedByEmail", { length: 255 }),
  config: json("config"),
  result: json("result").notNull(),
  startedAt: timestamp("startedAt").notNull(),
  finishedAt: timestamp("finishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ComfyStressHistoryRow = typeof comfyStressHistory.$inferSelect;

// Reusable stress-test parameter templates (admin-shared). `config` carries the
// whole form: baseUrls/source/workflowJson/model/mode/concurrency/total/randomizeSeed.
export const comfyStressTemplates = mysqlTable("comfy_stress_templates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  config: json("config").notNull(),
  createdByEmail: varchar("createdByEmail", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ComfyStressTemplateRow = typeof comfyStressTemplates.$inferSelect;

// ── ComfyUI template functional analysis (for the agent's planning) ───────────
// One row per template (1:1 via unique templateId). The agent reads these
// LLM-produced functional summaries to recommend/configure comfyui_workflow nodes.
export const comfyTemplateAnalysis = mysqlTable("comfy_template_analysis", {
  id: int("id").autoincrement().primaryKey(),
  templateId: int("templateId").notNull().unique(),
  functionSummary: text("functionSummary"),
  capabilities: json("capabilities"),            // string[]
  outputType: varchar("outputType", { length: 16 }), // image|video|mixed
  hasVideoOutput: boolean("hasVideoOutput"),
  modelNames: json("modelNames"),                // string[]
  // Video capability (null for image-only templates). shotSeconds = maxFrames/fps,
  // derived in code. Lets the agent plan enough shots to fill a target duration.
  maxFrames: int("maxFrames"),
  fps: int("fps"),
  analysisVersion: int("analysisVersion").notNull().default(1),
  model: varchar("model", { length: 64 }),       // LLM used for the analysis
  analyzedAt: timestamp("analyzedAt").defaultNow().notNull(),
});

export type ComfyTemplateAnalysisRow = typeof comfyTemplateAnalysis.$inferSelect;
export type InsertComfyTemplateAnalysis = typeof comfyTemplateAnalysis.$inferInsert;

// ── Video Tasks ───────────────────────────────────────────────────────────────
export const videoTasks = mysqlTable("video_tasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId").notNull(),
  nodeId: varchar("nodeId", { length: 64 }).notNull(),
  // varchar (not enum): the provider list grows with every new model. An ENUM
  // column froze the DB at the providers known when the last enum migration ran
  // (0013), so any newer provider (kie_*, newer poyo_*) failed to INSERT. varchar
  // accepts any provider; the API layer still validates against VIDEO_PROVIDERS (Zod).
  provider: varchar("provider", { length: 64 }).notNull(),
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
  // BIGINT: keep parity with assets.size for large media. (#1)
  size: bigint("size", { mode: "number" }).notNull(),
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
  maxFileMb: int("maxFileMb").notNull().default(5000),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ChatSettingsRow = typeof chatSettings.$inferSelect;

// ── Whitelist ─────────────────────────────────────────────────────────────────

export const whitelistSettings = mysqlTable("whitelistSettings", {
  id: int("id").autoincrement().primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  // When true, ComfyUI node procedures bypass the whitelist even while it's
  // globally enabled — ComfyUI is the user's own self-hosted server (no cloud
  // quota cost), so admins can free it up independently. Other cloud AI
  // (Poyo/Higgsfield) stays whitelist-gated. Default false = no behavior change.
  comfyuiBypass: boolean("comfyuiBypass").notNull().default(false),
  // When true, text/vision LLM procedures (AI chat, character-consistency check)
  // bypass the whitelist even while it's globally enabled — lets admins keep
  // cheap LLM features open while gating paid image/video generation. Default
  // false = no behavior change.
  llmBypass: boolean("llmBypass").notNull().default(false),
  // When true, whitelisted (or admin) users may use the shared "house" kie.ai
  // key (KIE_API_KEY env). When false, only users with an admin-assigned kie key
  // or a temporary key they enter themselves can use kie.ai. Default false.
  kieEnabled: boolean("kieEnabled").notNull().default(false),
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
  // Presigned GET URL validity (seconds) for self-hosted S3/MinIO. Longer values
  // help when the URL must stay fetchable by slow upstream AI tasks; shorter
  // values shrink the leak-exposure window. Default 1h.
  presignTtlSec: int("presignTtlSec").notNull().default(3600),
  // When MinIO/S3 is not publicly reachable, route reference images/videos
  // through Poyo's stream-upload endpoint to obtain a public URL for AI models.
  poyoUploadFallback: boolean("poyoUploadFallback").notNull().default(false),
  // When true, object storage is restricted to MinIO/S3 ONLY — the Forge
  // storage fallback is disabled, so no file is ever written to Manus/Forge
  // storage (writes fail if MinIO/S3 isn't configured). ON by default (migration
  // 0025); deployments without MinIO/S3 can turn it off in the admin panel.
  // Does NOT affect Forge non-storage features (LLM, etc.).
  minioOnly: boolean("minioOnly").notNull().default(true),
  // When true, after a downstream node's referenceImageUrl is auto-filled, prefer
  // the upstream AI-platform temporary public URL (imageUrlSource) when it probes
  // alive — so providers can fetch it directly even if self-hosted MinIO isn't
  // public. Off by default; off changes nothing.
  preferUpstreamRefSource: boolean("preferUpstreamRefSource").notNull().default(false),
  // Strict download authorization: when true, non-admins may only download an
  // original file with a consumable grant (admin-approved request or admin
  // batch grant). Admin-controlled from the Storage settings page. Off by
  // default → behavior identical to before (non-breaking).
  downloadAuthEnabled: boolean("downloadAuthEnabled").notNull().default(false),
  // Anti-leech: when true, the storage proxy NEVER 307-redirects to the raw
  // presigned S3/MinIO URL — it always streams the object through this server, so
  // the real storage link is never exposed in the browser's network panel. Off by
  // default → behavior identical to before (redirect when reachable).
  forceStorageRelay: boolean("forceStorageRelay").notNull().default(false),
  // Anti-leech: when true, a faint page-level watermark (the viewer's identity) is
  // overlaid across the app so screenshots / screen recordings are traceable. Off
  // by default → no overlay, behavior unchanged.
  watermarkEnabled: boolean("watermarkEnabled").notNull().default(false),
  // Anti-leech: when true, original-file DOWNLOADS (image/video, via the server
  // proxies) are re-encoded with the downloader's identity burned in (ffmpeg
  // drawtext), so the leaked file itself is traceable. Off by default; on any
  // ffmpeg failure the original file is served unchanged (downloads never break).
  downloadWatermarkEnabled: boolean("downloadWatermarkEnabled").notNull().default(false),
  // Anti-leech deterrent (NOT real security): when true, non-admin clients block
  // the context menu and devtools key shortcuts (F12 / Ctrl+Shift+I/J/C / Ctrl+U).
  // Trivially bypassable; off by default. Admins are always exempt.
  devtoolsBlockEnabled: boolean("devtoolsBlockEnabled").notNull().default(false),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Single-row (id always 1) admin-managed model visibility toggles. `disabledModels`
// is a JSON array of model value/id strings that admins hid from the node model
// pickers. Empty/null = all models visible (default, non-breaking).
export const modelToggleSettings = mysqlTable("model_toggle_settings", {
  id: int("id").primaryKey(),
  disabledModels: json("disabledModels").$type<string[]>(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Single-row (id always 1) admin-managed global ComfyUI server registry,
 *  shared across all users. `servers` is a JSON array of base URLs. */
export const comfySettings = mysqlTable("comfy_settings", {
  id: int("id").primaryKey(),
  servers: text("servers"),
});
export type ComfySettingsRow = typeof comfySettings.$inferSelect;

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

// ── Per-user ComfyUI server usage logs ──────────────────────────────────────
// Detailed record of every ComfyUI call (generate image/video, custom workflow,
// server action): which user, which server/host:port, model, status, duration,
// result and error — for admin observability & per-user/per-server analytics.
export const comfyUsageLogs = mysqlTable("comfyUsageLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  userEmail: varchar("userEmail", { length: 320 }),
  userName: varchar("userName", { length: 255 }),
  ip: varchar("ip", { length: 64 }).notNull(),
  action: varchar("action", { length: 64 }).notNull(),       // generateImage / generateVideo / executeWorkflow / serverAction:free …
  baseUrl: varchar("baseUrl", { length: 512 }).notNull(),    // the server address used
  host: varchar("host", { length: 255 }),                    // host:port derived from baseUrl
  model: varchar("model", { length: 255 }),                  // ckpt / template / preprocessor
  projectId: int("projectId"),
  nodeId: varchar("nodeId", { length: 255 }),
  status: varchar("status", { length: 16 }).notNull(),       // success | error
  durationMs: int("durationMs"),
  resultUrl: varchar("resultUrl", { length: 2048 }),
  resultCount: int("resultCount"),
  errorMessage: varchar("errorMessage", { length: 1024 }),
  detail: json("detail"),                                    // extra dimensions (prompt summary, seed, size, gpuIndex…)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  userIdIdx: index("comfyUsageLogs_userId_idx").on(t.userId),
  hostIdx: index("comfyUsageLogs_host_idx").on(t.host),
  statusIdx: index("comfyUsageLogs_status_idx").on(t.status),
  createdAtIdx: index("comfyUsageLogs_createdAt_idx").on(t.createdAt),
}));

export type ComfyUsageLog = typeof comfyUsageLogs.$inferSelect;
export type InsertComfyUsageLog = typeof comfyUsageLogs.$inferInsert;

// ── Poyo Balance Snapshots ──────────────────────────────────────────────────
// Poyo's balance API only returns the current credit amount (no history), so we
// snapshot it periodically to chart consumption / spending trends. The balance
// is a single platform-wide account (shared across all users), hence no userId.
export const poyoBalanceSnapshots = mysqlTable("poyoBalanceSnapshots", {
  id: int("id").autoincrement().primaryKey(),
  creditsAmount: float("creditsAmount").notNull(),
  email: varchar("email", { length: 320 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  createdAtIdx: index("poyoBalanceSnapshots_createdAt_idx").on(t.createdAt),
}));

export type PoyoBalanceSnapshot = typeof poyoBalanceSnapshots.$inferSelect;
export type InsertPoyoBalanceSnapshot = typeof poyoBalanceSnapshots.$inferInsert;

// ── Download authorization (strict approval + one-time consumption) ──────────
// 严格鉴权模型：除管理员外，任何人（含文件所有者）下载原文件都必须持有一张
// 可消费的授权。授权来源有二——① 用户申请→管理员批准；② 管理员主动批量授权
// （按单文件 / 按整个项目）给某用户。每张授权对「每个文件」只允许成功下载一次。
export const downloadGrants = mysqlTable("download_grants", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),                                   // 被授权人（grantee）
  origin: mysqlEnum("origin", ["request", "admin"]).notNull(),       // 用户申请 / 管理员主动
  scope: mysqlEnum("scope", ["asset", "project"]).notNull(),         // 单文件 / 整个项目
  storageKey: varchar("storageKey", { length: 512 }),                // scope=asset
  assetId: int("assetId"),                                           // scope=asset（已知时）
  projectId: int("projectId"),                                       // scope=project
  status: mysqlEnum("status", ["pending", "active", "revoked", "denied"]).notNull().default("pending"),
  reason: varchar("reason", { length: 500 }),                        // 用户申请理由（origin=request）
  note: varchar("note", { length: 500 }),                            // 管理员备注
  createdBy: int("createdBy").notNull(),                             // 申请人 或 操作管理员
  decidedBy: int("decidedBy"),                                       // 审批的管理员
  decidedAt: timestamp("decidedAt"),
  expiresAt: timestamp("expiresAt"),                                 // 可选有效期
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  userStatusIdx: index("dl_grant_user_status_idx").on(t.userId, t.status),
  statusIdx: index("dl_grant_status_idx").on(t.status),
  projectIdx: index("dl_grant_project_idx").on(t.projectId),
}));

export type DownloadGrant = typeof downloadGrants.$inferSelect;
export type InsertDownloadGrant = typeof downloadGrants.$inferInsert;

// 一次性消费台账：每成功下载一个文件写一行；(grantId, storageKey) 唯一约束在
// 数据库层强制「每张授权对每个文件只能下载一次」，并发安全。也是下载审计来源。
export const downloadConsumptions = mysqlTable("download_consumptions", {
  id: int("id").autoincrement().primaryKey(),
  grantId: int("grantId").notNull(),
  userId: int("userId").notNull(),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  assetId: int("assetId"),
  servedAt: timestamp("servedAt").defaultNow().notNull(),
}, (t) => ({
  grantFileUniq: uniqueIndex("dl_consume_grant_file_uniq").on(t.grantId, t.storageKey),
  userIdx: index("dl_consume_user_idx").on(t.userId),
}));

export type DownloadConsumption = typeof downloadConsumptions.$inferSelect;
export type InsertDownloadConsumption = typeof downloadConsumptions.$inferInsert;

// ── kie.ai keys ───────────────────────────────────────────────────────────────
// Admin-distributed, quota-limited kie.ai API keys. The real key is NEVER stored
// in plaintext — `encryptedKey` is AES-256-GCM (see server/_core/kieCrypto.ts).
// One key can be shared by many users (kieKeyBindings). `enabled` here is the
// group switch (disabling it revokes ALL its bindings at once).
export const kieApiKeys = mysqlTable("kieApiKeys", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  encryptedKey: varchar("encryptedKey", { length: 1024 }).notNull(),
  keyLast4: varchar("keyLast4", { length: 8 }).notNull(),
  keyHash: varchar("keyHash", { length: 64 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  note: varchar("note", { length: 255 }),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  keyHashUniq: uniqueIndex("kieApiKeys_keyHash_uniq").on(t.keyHash),
}));

export type KieApiKey = typeof kieApiKeys.$inferSelect;
export type InsertKieApiKey = typeof kieApiKeys.$inferInsert;

// Binds a kie key to a user. Many users can bind to one key. `enabled` here is
// the per-user authorization switch (independent of the key's group switch). A
// user's "effective assigned key" = a binding where binding.enabled && key.enabled.
export const kieKeyBindings = mysqlTable("kieKeyBindings", {
  id: int("id").autoincrement().primaryKey(),
  keyId: int("keyId").notNull(),
  userId: int("userId").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  note: varchar("note", { length: 255 }),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  keyUserUniq: uniqueIndex("kieKeyBindings_key_user_uniq").on(t.keyId, t.userId),
  userIdx: index("kieKeyBindings_user_idx").on(t.userId),
}));

export type KieKeyBinding = typeof kieKeyBindings.$inferSelect;
export type InsertKieKeyBinding = typeof kieKeyBindings.$inferInsert;

// Throttled balance snapshots for the HOUSE (env) kie key only — admin trend
// view. User/assigned keys are not snapshotted (privacy + volume).
export const kieBalanceSnapshots = mysqlTable("kieBalanceSnapshots", {
  id: int("id").autoincrement().primaryKey(),
  creditsAmount: float("creditsAmount").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  createdAtIdx: index("kieBalanceSnapshots_createdAt_idx").on(t.createdAt),
}));

export type KieBalanceSnapshot = typeof kieBalanceSnapshots.$inferSelect;
export type InsertKieBalanceSnapshot = typeof kieBalanceSnapshots.$inferInsert;

// ── ComfyUI 运维中心（ops center）─────────────────────────────────────────────
// Registered ComfyUI hosts with SSH credentials for the admin ops center.
// `encryptedSecret` is AES-256-GCM (see server/_core/ops/sshCrypto.ts) — the
// plaintext password/private key NEVER leaves the backend. `comfyBaseUrl` links
// to the ComfyUI HTTP API (optional: a pure host has none). Mixed deploy forms
// (docker container vs bare/systemd) are tagged so ops commands adapt.
export const comfyOpsServers = mysqlTable("comfy_ops_servers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  comfyBaseUrl: varchar("comfyBaseUrl", { length: 512 }),
  sshHost: varchar("sshHost", { length: 255 }).notNull(),
  sshPort: int("sshPort").notNull().default(22),
  sshUser: varchar("sshUser", { length: 128 }).notNull(),
  authType: mysqlEnum("authType", ["password", "privateKey"]).notNull(),
  encryptedSecret: varchar("encryptedSecret", { length: 8192 }).notNull(),
  encryptedPassphrase: varchar("encryptedPassphrase", { length: 1024 }),
  secretLast4: varchar("secretLast4", { length: 8 }),
  deployForm: mysqlEnum("deployForm", ["docker", "bare", "systemd"]).notNull().default("bare"),
  dockerContainer: varchar("dockerContainer", { length: 128 }),
  comfyPath: varchar("comfyPath", { length: 512 }),
  trustMode: boolean("trustMode").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  note: varchar("note", { length: 255 }),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ComfyOpsServer = typeof comfyOpsServers.$inferSelect;
export type InsertComfyOpsServer = typeof comfyOpsServers.$inferInsert;

// Shared (admin) ops script library. `dangerous` flags scripts containing
// destructive ops; `source` distinguishes hand-written from AI-generated.
export const comfyOpsScripts = mysqlTable("comfy_ops_scripts", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  category: varchar("category", { length: 32 }),
  description: text("description"),
  body: text("body").notNull(),
  dangerous: boolean("dangerous").notNull().default(false),
  source: mysqlEnum("source", ["manual", "ai"]).notNull().default("manual"),
  createdByEmail: varchar("createdByEmail", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ComfyOpsScript = typeof comfyOpsScripts.$inferSelect;
export type InsertComfyOpsScript = typeof comfyOpsScripts.$inferInsert;

// Execution history / audit detail for every ops action (api/ssh/terminal).
// Complements the cross-feature auditLogs with ops-specific output/exit/duration.
export const comfyOpsRecords = mysqlTable("comfy_ops_records", {
  id: int("id").autoincrement().primaryKey(),
  serverId: int("serverId"),
  userId: int("userId"),
  userEmail: varchar("userEmail", { length: 320 }),
  channel: mysqlEnum("channel", ["api", "ssh", "terminal"]).notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  command: text("command"),
  approvedByAi: boolean("approvedByAi"),
  autoExecuted: boolean("autoExecuted").notNull().default(false),
  status: varchar("status", { length: 16 }).notNull(),
  exitCode: int("exitCode"),
  durationMs: int("durationMs"),
  outputTail: text("outputTail"),
  errorMessage: varchar("errorMessage", { length: 1024 }),
  detail: json("detail"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  serverIdIdx: index("comfy_ops_records_serverId_idx").on(t.serverId),
  createdAtIdx: index("comfy_ops_records_createdAt_idx").on(t.createdAt),
}));

export type ComfyOpsRecord = typeof comfyOpsRecords.$inferSelect;
export type InsertComfyOpsRecord = typeof comfyOpsRecords.$inferInsert;

// Single-row global ops settings (id is fixed = 1).
export const comfyOpsSettings = mysqlTable("comfy_ops_settings", {
  id: int("id").primaryKey(),
  globalTrustMode: boolean("globalTrustMode").notNull().default(false),
  autoExecWhitelist: json("autoExecWhitelist"),
  readOnlyOpenToWhitelist: boolean("readOnlyOpenToWhitelist").notNull().default(true),
});

export type ComfyOpsSettings = typeof comfyOpsSettings.$inferSelect;
export type InsertComfyOpsSettings = typeof comfyOpsSettings.$inferInsert;
