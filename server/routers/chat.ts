import path from "path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { storagePut, storagePresignPut, isStorageConfigured, canBrowserReachStorageDirectly, assertObjectStorageWritable, finalizeStorageKey } from "../storage";
import { signUploadToken } from "../_core/uploadToken";
import { hashPassword, verifyPassword } from "../_core/scrypt";
import {
  getOrCreateLobby,
  getOrCreateDownloadChannel,
  createConversation,
  getConversationById,
  getConversationByDmKey,
  updateConversation,
  deleteConversation as dbDeleteConversation,
  addChatMember,
  removeChatMember,
  listChatMembers,
  isChatMember,
  listConversationsForUser,
  listJoinableGroups,
  updateLastRead,
  insertConversationMessage,
  getConversationMessages,
  insertChatAttachment,
  linkAttachmentsToMessage,
  listConversationAttachments,
  upsertUserPublicKey,
  getUserPublicKeys,
  isChatBanned,
  getChatSettings,
  searchUsersForChat,
  getUserById,
} from "../db";
import type { ChatWireMessage, ChatFileRef } from "../../shared/types";
import type { ConversationMessage } from "../../drizzle/schema";

// ── wire helpers ────────────────────────────────────────────────────────────
function rowToWire(row: ConversationMessage): ChatWireMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    senderName: row.senderName,
    content: row.content,
    attachments: (row.attachments as ChatFileRef[] | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function kindFromMime(mime: string): "image" | "video" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

function dmKeyFor(a: number, b: number): string {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return `dm:${lo}:${hi}`;
}

// ── broadcaster wiring (set by index.ts once io exists; avoids import cycle) ──
let broadcaster: ((conversationId: number, msg: ChatWireMessage) => void) | null = null;
export function registerChatBroadcaster(fn: (conversationId: number, msg: ChatWireMessage) => void): void {
  broadcaster = fn;
}
let eventBroadcaster: ((conversationId: number, event: string, payload: unknown) => void) | null = null;
export function registerChatEventBroadcaster(fn: (conversationId: number, event: string, payload: unknown) => void): void {
  eventBroadcaster = fn;
}

/** Post a download request into the dedicated "下载审批" channel + broadcast it
 *  live (best-effort; called from the downloads router). */
export async function postDownloadRequestToChannel(notice: {
  grantId: number; userId: number; requesterName: string | null;
  fileName: string | null; fileType: string | null; projectName: string | null; reason: string | null;
}): Promise<void> {
  try {
    const ch = await getOrCreateDownloadChannel();
    // Leading [#DLREQ:<grantId>] marker lets the chat client render an inline
    // approve control; it's stripped from the displayed text.
    const content =
      `[#DLREQ:${notice.grantId}]\n` +
      `📥 下载申请\n` +
      `申请人：${notice.requesterName ?? `用户${notice.userId}`}\n` +
      `文件：${notice.fileName ?? "（未知）"}${notice.fileType ? `（${notice.fileType}）` : ""}` +
      `${notice.projectName ? `\n项目：${notice.projectName}` : ""}` +
      `${notice.reason ? `\n理由：${notice.reason}` : ""}`;
    const msg = await insertConversationMessage({
      conversationId: ch.id, senderId: notice.userId,
      senderName: notice.requesterName ?? `用户${notice.userId}`, content,
    });
    if (msg && broadcaster) broadcaster(ch.id, rowToWire(msg));
  } catch { /* non-fatal — popup/badge still notify */ }
}
/** Broadcast directly to a user's personal room (for new-DM / invite notices). */
let userBroadcaster: ((userId: number, event: string, payload: unknown) => void) | null = null;
export function registerChatUserBroadcaster(fn: (userId: number, event: string, payload: unknown) => void): void {
  userBroadcaster = fn;
}


export const chatRouter = router({
  // ── conversations ─────────────────────────────────────────────────────────
  listConversations: protectedProcedure.query(async ({ ctx }) => {
    const settings = await getChatSettings().catch(() => null);
    // Ensure the global lobby exists (in dev/no-migration setups it is created lazily).
    if (!settings || settings.lobbyEnabled) { try { await getOrCreateLobby(); } catch { /* non-fatal */ } }
    // Admins auto-join the "下载审批" channel so it shows in their chat list.
    if (ctx.user.role === "admin") {
      try { const ch = await getOrCreateDownloadChannel(); if (!(await isChatMember(ch.id, ctx.user.id))) await addChatMember(ch.id, ctx.user.id, "member"); } catch { /* non-fatal */ }
    }
    const convs = await listConversationsForUser(ctx.user.id);
    const out = [] as Array<{
      id: number; type: string; mode: string; title: string | null;
      isPrivate: boolean; memberCount: number; lastMessage: ChatWireMessage | null;
      unread: number; peer?: { id: number; name: string | null };
    }>;
    for (const c of convs) {
      if (c.type === "lobby" && settings && !settings.lobbyEnabled) continue;
      const members = await listChatMembers(c.id);
      const me = members.find((m) => m.userId === ctx.user.id);
      let lastMessage: ChatWireMessage | null = null;
      let unread = 0;
      if (c.mode === "server") {
        const recent = await getConversationMessages(c.id, { limit: 1 });
        lastMessage = recent[0] ? rowToWire(recent[0]) : null;
        if (lastMessage && me) unread = lastMessage.id > me.lastReadMessageId ? 1 : 0;
      }
      let peer: { id: number; name: string | null } | undefined;
      if (c.type === "dm") {
        const other = members.find((m) => m.userId !== ctx.user.id);
        if (other) { const u = await getUserById(other.userId); peer = { id: other.userId, name: u?.name ?? null }; }
      }
      out.push({
        id: c.id, type: c.type, mode: c.mode, title: c.title,
        isPrivate: !!c.passwordHash, memberCount: members.length,
        lastMessage, unread, peer,
      });
    }
    return out;
  }),

  getConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      if (!(await isChatMember(conv.id, ctx.user.id))) throw new TRPCError({ code: "FORBIDDEN" });
      const members = await listChatMembers(conv.id);
      const membersWithNames = await Promise.all(members.map(async (m) => {
        const u = await getUserById(m.userId);
        return { userId: m.userId, name: u?.name ?? `用户${m.userId}`, role: m.role };
      }));
      return {
        id: conv.id, type: conv.type, mode: conv.mode, title: conv.title,
        isPrivate: !!conv.passwordHash, createdBy: conv.createdBy, members: membersWithNames,
      };
    }),

  getLobby: protectedProcedure.query(async () => {
    const settings = await getChatSettings().catch(() => null);
    if (settings && !settings.lobbyEnabled) throw new TRPCError({ code: "FORBIDDEN", message: "大厅已关闭" });
    const lobby = await getOrCreateLobby();
    return { id: lobby.id, type: lobby.type, mode: lobby.mode, title: lobby.title };
  }),

  createRoom: protectedProcedure
    .input(z.object({
      title: z.string().trim().min(1).max(120),
      mode: z.enum(["server", "serverless"]).default("server"),
      password: z.string().min(1).max(128).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const settings = await getChatSettings().catch(() => null);
      if (input.mode === "serverless" && settings && !settings.serverlessAllowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无服务器模式已被管理员禁用" });
      }
      const passwordHash = input.password ? await hashPassword(input.password) : null;
      const conv = await createConversation({
        type: "group", mode: input.mode, title: input.title, passwordHash, createdBy: ctx.user.id,
      });
      await addChatMember(conv.id, ctx.user.id, "owner");
      return { id: conv.id };
    }),

  // Discover group rooms the user hasn't joined yet (for the "可加入的房间" list).
  listJoinableRooms: protectedProcedure.query(async ({ ctx }) => {
    const rooms = await listJoinableGroups(ctx.user.id);
    const banned = await Promise.all(rooms.map((r) => isChatBanned(ctx.user.id, r.id)));
    return rooms
      .filter((_r, i) => !banned[i])
      .map((r) => ({ id: r.id, title: r.title, isPrivate: !!r.passwordHash, mode: r.mode }));
  }),

  deleteRoom: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv || conv.type === "lobby") throw new TRPCError({ code: "BAD_REQUEST", message: "大厅不可删除" });
      const members = await listChatMembers(conv.id);
      const me = members.find((m) => m.userId === ctx.user.id);
      if (!me) throw new TRPCError({ code: "FORBIDDEN", message: "你不在该会话中" });
      // Group: owner only. DM: either participant may delete the private chat.
      if (conv.type === "group" && me.role !== "owner" && conv.createdBy !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅群主可删除房间" });
      }
      // Notify members (so their lists refresh and active view closes) before deleting.
      if (eventBroadcaster) eventBroadcaster(conv.id, "conversation:deleted", { conversationId: conv.id });
      await dbDeleteConversation(conv.id);
      return { success: true };
    }),

  joinRoom: protectedProcedure
    .input(z.object({ conversationId: z.number(), password: z.string().max(128).optional() }))
    .mutation(async ({ ctx, input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv || conv.type !== "group") throw new TRPCError({ code: "NOT_FOUND" });
      if (await isChatBanned(ctx.user.id, conv.id)) throw new TRPCError({ code: "FORBIDDEN", message: "你已被封禁" });
      if (conv.passwordHash) {
        const ok = input.password ? await verifyPassword(input.password, conv.passwordHash) : false;
        if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "房间密码错误" });
      }
      await addChatMember(conv.id, ctx.user.id, "member");
      return { id: conv.id };
    }),

  startDm: protectedProcedure
    .input(z.object({ targetUserId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (input.targetUserId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "不能和自己私聊" });
      const target = await getUserById(input.targetUserId);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
      const key = dmKeyFor(ctx.user.id, input.targetUserId);
      const existing = await getConversationByDmKey(key);
      if (existing) {
        await addChatMember(existing.id, ctx.user.id, "member");
        return { id: existing.id };
      }
      const conv = await createConversation({ type: "dm", mode: "server", dmKey: key, createdBy: ctx.user.id });
      await addChatMember(conv.id, ctx.user.id, "member");
      await addChatMember(conv.id, input.targetUserId, "member");
      if (userBroadcaster) userBroadcaster(input.targetUserId, "conversation:created", { id: conv.id });
      return { id: conv.id };
    }),

  inviteToRoom: protectedProcedure
    .input(z.object({ conversationId: z.number(), targetUserId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv || conv.type !== "group") throw new TRPCError({ code: "NOT_FOUND" });
      if (!(await isChatMember(conv.id, ctx.user.id))) throw new TRPCError({ code: "FORBIDDEN" });
      await addChatMember(conv.id, input.targetUserId, "member");
      if (userBroadcaster) userBroadcaster(input.targetUserId, "conversation:created", { id: conv.id });
      return { success: true };
    }),

  leaveRoom: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv || conv.type === "lobby") throw new TRPCError({ code: "BAD_REQUEST" });
      await removeChatMember(conv.id, ctx.user.id);
      return { success: true };
    }),

  setMode: protectedProcedure
    .input(z.object({ conversationId: z.number(), mode: z.enum(["server", "serverless"]) }))
    .mutation(async ({ ctx, input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      if (conv.type === "lobby") throw new TRPCError({ code: "BAD_REQUEST", message: "大厅模式不可更改" });
      const members = await listChatMembers(conv.id);
      const me = members.find((m) => m.userId === ctx.user.id);
      const allowed = conv.type === "dm" ? !!me : me?.role === "owner";
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "仅群主可切换模式" });
      const settings = await getChatSettings().catch(() => null);
      if (input.mode === "serverless" && settings && !settings.serverlessAllowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无服务器模式已被管理员禁用" });
      }
      await updateConversation(conv.id, { mode: input.mode });
      if (eventBroadcaster) eventBroadcaster(conv.id, "conversation:mode-changed", { conversationId: conv.id, mode: input.mode });
      return { success: true };
    }),

  // ── messages (server mode only) ─────────────────────────────────────────────
  getMessages: protectedProcedure
    .input(z.object({ conversationId: z.number(), beforeId: z.number().optional(), limit: z.number().min(1).max(100).default(40) }))
    .query(async ({ ctx, input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      if (!(await isChatMember(conv.id, ctx.user.id))) throw new TRPCError({ code: "FORBIDDEN" });
      if (conv.mode !== "server") return [] as ChatWireMessage[]; // serverless: history is local-only
      const rows = await getConversationMessages(conv.id, { beforeId: input.beforeId, limit: input.limit });
      return rows.map(rowToWire).reverse(); // oldest-first for display
    }),

  sendMessage: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      content: z.string().max(8000),
      attachmentIds: z.array(z.number()).max(10).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      if (conv.mode !== "server") throw new TRPCError({ code: "BAD_REQUEST", message: "无服务器会话请通过加密通道发送" });
      if (!(await isChatMember(conv.id, ctx.user.id))) throw new TRPCError({ code: "FORBIDDEN" });
      if (await isChatBanned(ctx.user.id, conv.id)) throw new TRPCError({ code: "FORBIDDEN", message: "你已被封禁" });
      if (!input.content.trim() && !input.attachmentIds?.length) throw new TRPCError({ code: "BAD_REQUEST" });

      let attachments: ChatFileRef[] | null = null;
      if (input.attachmentIds?.length) {
        const all = await listConversationAttachments(conv.id);
        attachments = all
          .filter((a) => input.attachmentIds!.includes(a.id))
          .map((a) => ({ attachmentId: a.id, name: a.name, mimeType: a.mimeType, size: a.size, url: a.url, kind: a.kind }));
      }
      const msg = await insertConversationMessage({
        conversationId: conv.id, senderId: ctx.user.id,
        senderName: ctx.user.name ?? `用户${ctx.user.id}`,
        content: input.content, attachments: attachments ?? undefined,
      });
      if (!msg) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (input.attachmentIds?.length) await linkAttachmentsToMessage(msg.id, input.attachmentIds);
      const wire = rowToWire(msg);
      if (broadcaster) broadcaster(conv.id, wire);
      return wire;
    }),

  markRead: protectedProcedure
    .input(z.object({ conversationId: z.number(), messageId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await isChatMember(input.conversationId, ctx.user.id))) throw new TRPCError({ code: "FORBIDDEN" });
      await updateLastRead(input.conversationId, ctx.user.id, input.messageId);
      return { success: true };
    }),

  // ── files (server mode) ─────────────────────────────────────────────────────
  uploadFile: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      base64: z.string(),
      mimeType: z.string().max(128),
      filename: z.string().max(255),
    }))
    .mutation(async ({ ctx, input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      if (conv.mode !== "server") throw new TRPCError({ code: "BAD_REQUEST", message: "无服务器会话文件走加密通道" });
      if (!(await isChatMember(conv.id, ctx.user.id))) throw new TRPCError({ code: "FORBIDDEN" });
      // All file formats are allowed (size limit still enforced below). Attachments
      // are served as downloads / typed media, never executed in the app origin.

      const settings = await getChatSettings().catch(() => null);
      const maxBytes = (settings?.maxFileMb ?? 5000) * 1024 * 1024;
      const buffer = Buffer.from(input.base64, "base64");
      if (buffer.length > maxBytes) throw new TRPCError({ code: "BAD_REQUEST", message: `文件超过 ${settings?.maxFileMb ?? 5000}MB 上限` });

      const safeName = path.basename(input.filename).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
      const date = new Date().toISOString().slice(0, 10);
      const key = `chat/${conv.id}/${date}/${crypto.randomUUID()}-${safeName}`;
      let url: string;
      let storageKey: string;
      if (isStorageConfigured()) {
        // 「仅允许 MinIO/S3」开关：未配 MinIO/S3 时拒绝写入，不回退 Forge 存储。
        await assertObjectStorageWritable();
        const res = await storagePut(key, buffer, input.mimeType);
        url = res.url; storageKey = res.key;
      } else {
        url = `data:${input.mimeType};base64,${input.base64}`; storageKey = key;
      }
      const att = await insertChatAttachment({
        conversationId: conv.id, uploaderId: ctx.user.id, storageKey, url,
        name: safeName, mimeType: input.mimeType, size: buffer.length, kind: kindFromMime(input.mimeType),
      });
      if (!att) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { attachmentId: att.id, url: att.url, name: att.name, mimeType: att.mimeType, size: att.size, kind: att.kind };
    }),

  // Direct-to-storage upload for large files: browser PUTs straight to S3,
  // bypassing the server body limit + base64 bloat. Returns mode "presigned"
  // (preferred) or "base64" (dev / storage not configured → use uploadFile).
  createUploadUrl: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      filename: z.string().max(255),
      mimeType: z.string().max(128),
      size: z.number().int().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      if (conv.mode !== "server") throw new TRPCError({ code: "BAD_REQUEST", message: "无服务器会话文件走加密通道" });
      if (!(await isChatMember(conv.id, ctx.user.id))) throw new TRPCError({ code: "FORBIDDEN" });
      const settings = await getChatSettings().catch(() => null);
      const maxBytes = (settings?.maxFileMb ?? 5000) * 1024 * 1024;
      if (input.size > maxBytes) throw new TRPCError({ code: "BAD_REQUEST", message: `文件超过 ${settings?.maxFileMb ?? 5000}MB 上限` });

      const safeName = path.basename(input.filename).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
      const date = new Date().toISOString().slice(0, 10);
      const relKey = `chat/${conv.id}/${date}/${crypto.randomUUID()}-${safeName}`;
      // Storage configured but the browser can't reach the host directly (typical
      // internal MinIO, no S3_PUBLIC_ENDPOINT) → stream the upload THROUGH this
      // server, mirroring the download proxy. No public endpoint or base64 cap.
      if (isStorageConfigured() && !canBrowserReachStorageDirectly()) {
        await assertObjectStorageWritable();
        const key = finalizeStorageKey(relKey);
        const token = signUploadToken({
          key, conversationId: conv.id, userId: ctx.user.id,
          maxBytes, contentType: input.mimeType, exp: Date.now() + 60 * 60 * 1000,
        });
        return {
          mode: "proxy" as const,
          uploadUrl: `/manus-storage-upload?token=${encodeURIComponent(token)}`,
          key, url: `/manus-storage/${key}`, name: safeName, kind: kindFromMime(input.mimeType),
        };
      }
      // No storage at all → base64 through tRPC (bounded by the 50MB body limit;
      // base64 inflates ~4/3 → ~36MB ceiling). Reject larger with a clear message.
      if (!isStorageConfigured()) {
        const BASE64_TRANSPORT_CAP = 36 * 1024 * 1024;
        if (input.size > BASE64_TRANSPORT_CAP) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "未配置对象存储，单文件最大约 36MB。请配置 MinIO/S3，或改用加密会话传大文件。",
          });
        }
        return { mode: "base64" as const };
      }
      // 「仅允许 MinIO/S3」开关：未配 MinIO/S3 时拒绝直传，不回退 Forge 存储。
      await assertObjectStorageWritable();
      const { uploadUrl, key, url } = await storagePresignPut(relKey, input.mimeType);
      return { mode: "presigned" as const, uploadUrl, key, url, name: safeName, kind: kindFromMime(input.mimeType) };
    }),

  // Register an attachment AFTER a successful presigned PUT.
  confirmUpload: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      key: z.string().max(512),
      url: z.string().max(1024),
      name: z.string().max(255),
      mimeType: z.string().max(128),
      size: z.number().int().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      if (!(await isChatMember(conv.id, ctx.user.id))) throw new TRPCError({ code: "FORBIDDEN" });
      // Guard: the key must live under this conversation's namespace.
      if (!input.key.startsWith(`chat/${conv.id}/`)) throw new TRPCError({ code: "BAD_REQUEST", message: "非法的存储 key" });
      const att = await insertChatAttachment({
        conversationId: conv.id, uploaderId: ctx.user.id, storageKey: input.key, url: input.url,
        name: input.name, mimeType: input.mimeType, size: input.size, kind: kindFromMime(input.mimeType),
      });
      if (!att) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { attachmentId: att.id, url: att.url, name: att.name, mimeType: att.mimeType, size: att.size, kind: att.kind };
    }),

  listFiles: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ ctx, input }) => {
      if (!(await isChatMember(input.conversationId, ctx.user.id))) throw new TRPCError({ code: "FORBIDDEN" });
      const rows = await listConversationAttachments(input.conversationId);
      return rows.map((a) => ({ id: a.id, name: a.name, url: a.url, mimeType: a.mimeType, size: a.size, kind: a.kind, uploaderId: a.uploaderId, createdAt: a.createdAt.toISOString() }));
    }),

  searchUsers: protectedProcedure
    .input(z.object({ q: z.string().trim().min(1).max(64) }))
    .query(async ({ ctx, input }) => searchUsersForChat(input.q, ctx.user.id)),

  // Public (logged-in) subset of admin settings so the client enforces the same
  // limits + shows the same warnings the admin configured.
  getSettings: protectedProcedure.query(async () => {
    const s = await getChatSettings().catch(() => null);
    return {
      maxFileMb: s?.maxFileMb ?? 5000,
      serverlessAllowed: s?.serverlessAllowed ?? true,
      lobbyEnabled: s?.lobbyEnabled ?? true,
      storageConfigured: isStorageConfigured(),
    };
  }),

  // ── E2E key exchange (serverless mode) ──────────────────────────────────────
  publishPublicKey: protectedProcedure
    .input(z.object({ publicKeyJwk: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      await upsertUserPublicKey(ctx.user.id, input.publicKeyJwk);
      return { success: true };
    }),

  getPublicKeys: protectedProcedure
    .input(z.object({ userIds: z.array(z.number()).max(200) }))
    .query(async ({ input }) => getUserPublicKeys(input.userIds)),
});
