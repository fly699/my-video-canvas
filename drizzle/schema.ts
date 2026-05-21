import {
  int,
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

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
  provider: mysqlEnum("provider", ["mock", "poyo_seedance", "poyo_veo", "poyo_kling26", "poyo_kling_o3_std", "poyo_kling_o3_pro", "poyo_kling_o3_4k", "hf_dop_standard", "hf_dop_preview", "hf_dop_lite", "hf_dop_turbo", "hf_kling_21_pro", "hf_kling_30", "hf_seedance_pro", "hf_seedance_20"]).notNull(),
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
