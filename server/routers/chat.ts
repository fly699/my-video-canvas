import path from "path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { storagePut, storagePresignPut, isStorageConfigured, canBrowserReachStorageDirectly, assertObjectStorageWritable, finalizeStorageKey, resolveToAbsoluteUrl } from "../storage";
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
  getOrCreateAssistantUserId,
  ASSISTANT_NAME,
  clearConversationMessages,
} from "../db";
import { assertLLMAllowed } from "../_core/whitelist";
import { invokeLLMWithKie } from "../_core/llmWithKie";
import { extractTextContent } from "../_core/llm";
import { isKieLLMModel } from "../_core/kieLLM";
import { isCustomLLMModel } from "../_core/customLlm";
import { isSelfHostedLlmModel } from "../_core/selfHostedLlm";
import { parseDocumentToText, isParsableDocument } from "../_core/documentParse";
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

// 展示用文件名：保留中文等 Unicode（此前的 ASCII 过滤会把「报告.pdf」变成「__.pdf」），
// 仅取最后一段、去掉控制字符与路径分隔符，限长。用于入库/回显/下载名。
export function displayFileName(raw: string): string {
  const base = String(raw ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = Array.from(base).filter((c) => c.charCodeAt(0) >= 0x20).join("");
  return cleaned.trim().slice(0, 200) || "file";
}
// 存储键用文件名：仅 ASCII 安全字符（对象存储 key 稳妥、避免签名/编码问题），限长。
// 展示名与真实中文由 DB 的 name 字段承载，与此 key 解耦。
export function storageKeyName(raw: string): string {
  return (path.basename(String(raw ?? "")).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)) || "file";
}

/** Turn a stored attachment URL into one the LLM gateway can fetch (absolute http(s)
 *  or data:). Relative /manus-storage/ paths are resolved to an absolute URL. Returns
 *  null for unusable schemes (blob:) so the caller drops them. Mirrors canvas aiChat. */
async function chatImageUrlForLLM(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("blob:")) return null;
  if (url.startsWith("data:")) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/manus-storage/")) {
    try { return await resolveToAbsoluteUrl(url); }
    catch (err) { console.warn("[chatAssistant] resolveToAbsoluteUrl failed:", err instanceof Error ? err.message : err); return null; }
  }
  return null;
}

/** Read a stored attachment's raw bytes for server-side document parsing. Handles
 *  data: URLs (no storage configured / dev), /manus-storage/ proxy paths (resolved
 *  to an absolute URL then fetched), and absolute http(s). Returns null on any
 *  failure / unusable scheme so the caller falls back to the lightweight note. */
async function chatAttachmentBytes(url: string): Promise<Uint8Array | null> {
  if (!url || url.startsWith("blob:")) return null;
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma < 0) return null;
    try { return new Uint8Array(Buffer.from(url.slice(comma + 1), "base64")); } catch { return null; }
  }
  let abs = url;
  if (url.startsWith("/manus-storage/")) {
    try { abs = await resolveToAbsoluteUrl(url); } catch { return null; }
  } else if (!/^https?:\/\//i.test(url)) {
    return null;
  }
  try {
    const resp = await fetch(abs, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return null;
    return new Uint8Array(await resp.arrayBuffer());
  } catch { return null; }
}

/** Parse a single non-image attachment to inline text for the LLM, capped. Returns
 *  null when it isn't a parsable doc, is too big, or yields no text — caller then
 *  falls back to the `[附件：name]` note. */
async function chatDocTextForLLM(att: ChatFileRef): Promise<string | null> {
  if (!isParsableDocument(att.name, att.mimeType)) return null;
  if (att.size > 16 * 1024 * 1024) return null; // mirror parseDocument endpoint ceiling
  const bytes = await chatAttachmentBytes(att.url);
  if (!bytes || bytes.byteLength === 0) return null;
  try {
    const text = await parseDocumentToText(bytes, { filename: att.name, mimeType: att.mimeType });
    const trimmed = text.trim();
    return trimmed ? trimmed.slice(0, 50_000) : null;
  } catch { return null; }
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

  // 内建「AI 助手」的用户 id（前端据此判断某会话是否为 AI 对话）。确保该用户已种子化。
  assistantUserId: protectedProcedure.query(async () => {
    return { userId: await getOrCreateAssistantUserId() };
  }),

  // 打开（或新建）与 AI 助手的私聊会话 —— 复用 DM 机制。
  openAssistant: protectedProcedure.mutation(async ({ ctx }) => {
    const aiId = await getOrCreateAssistantUserId();
    const key = dmKeyFor(ctx.user.id, aiId);
    const existing = await getConversationByDmKey(key);
    if (existing) {
      await addChatMember(existing.id, ctx.user.id, "member");
      return { id: existing.id, assistantUserId: aiId };
    }
    const conv = await createConversation({ type: "dm", mode: "server", dmKey: key, createdBy: ctx.user.id });
    await addChatMember(conv.id, ctx.user.id, "member");
    await addChatMember(conv.id, aiId, "member");
    return { id: conv.id, assistantUserId: aiId };
  }),

  // 向 AI 助手发消息：落库用户消息并广播 → 调 LLM（受所有权限门控）→ 落库 AI 回复并广播。
  // 仅允许在「与 AI 助手的私聊」里调用；其它会话用普通 sendMessage。
  sendToAssistant: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      content: z.string().max(8000),
      model: z.string().max(64).optional(),
      kieTempKey: z.string().max(256).optional(),
      attachmentIds: z.array(z.number()).max(10).optional(),
      // 可选「模板」人设：客户端选模板后把其 prompt 作为系统提示词传入，覆盖默认人设。
      systemPrompt: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const aiId = await getOrCreateAssistantUserId();
      const conv = await getConversationById(input.conversationId);
      if (!conv || conv.type !== "dm") throw new TRPCError({ code: "NOT_FOUND" });
      if (conv.mode !== "server") throw new TRPCError({ code: "BAD_REQUEST", message: "AI 助手仅支持服务器模式会话" });
      if (!(await isChatMember(conv.id, ctx.user.id))) throw new TRPCError({ code: "FORBIDDEN" });
      // 安全：该会话必须确实是「当前用户 ↔ AI 助手」的私聊，杜绝借此向任意会话注入 AI 消息。
      if (conv.dmKey !== dmKeyFor(ctx.user.id, aiId)) throw new TRPCError({ code: "FORBIDDEN", message: "非 AI 助手会话" });
      if (await isChatBanned(ctx.user.id, conv.id)) throw new TRPCError({ code: "FORBIDDEN", message: "你已被封禁" });
      if (!input.content.trim() && !input.attachmentIds?.length) throw new TRPCError({ code: "BAD_REQUEST", message: "请输入内容或附件" });

      // 权限门控：kie 模型走自有 key 体系（resolveKieKey 内含权限校验）；自定义模型走自带 key 体系
      // （invokeLLMWithKie 内：自带 key 放行 / env 兜底门控）；其余 LLM 受白名单/LLM 门控。
      if (!isKieLLMModel(input.model) && !isCustomLLMModel(input.model)) await assertLLMAllowed(ctx, input.model);

      // 0) 解析本会话内的附件（仅限当前用户上传到本会话的，杜绝越权引用他人附件）
      let attachments: ChatFileRef[] | null = null;
      if (input.attachmentIds?.length) {
        const all = await listConversationAttachments(conv.id);
        attachments = all
          .filter((a) => input.attachmentIds!.includes(a.id))
          .map((a) => ({ attachmentId: a.id, name: a.name, mimeType: a.mimeType, size: a.size, url: a.url, kind: a.kind }));
      }

      // 1) 落库并广播用户消息（带附件）
      const userMsg = await insertConversationMessage({
        conversationId: conv.id, senderId: ctx.user.id,
        senderName: ctx.user.name ?? `用户${ctx.user.id}`, content: input.content,
        attachments: attachments ?? undefined,
      });
      if (!userMsg) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (broadcaster) broadcaster(conv.id, rowToWire(userMsg));

      // 2) 取最近历史构造对话上下文（AI 的消息=assistant，其余=user），上限 20 条。
      //    用户消息若带图片附件，拼成多模态 content（image_url），让视觉模型能「看到」参考图；
      //    非图片附件附一行说明。文本/普通模型会忽略图片部分，不影响。
      // 文档解析「仅自建模型透明拦截」：选中自建 Qwen（纯文本）时，把当前这条消息附带的
      // office 文档（PDF/Word/PPT/Excel）解析成文本内联，让模型能读到内容；云端模型保持原样
      // 只附 [附件：名]。只解析最新这条消息（userMsg）的附件，避免每轮重复拉取/解析历史文档。
      const selfHosted = isSelfHostedLlmModel(input.model);
      const history = (await getConversationMessages(conv.id, { limit: 20 })).slice().reverse();
      const histMsgs = await Promise.all(history.map(async (m) => {
        const role = (m.senderId === aiId ? "assistant" : "user") as "assistant" | "user";
        const atts = ((m as { attachments?: ChatFileRef[] | null }).attachments) ?? null;
        if (role === "user" && atts && atts.length > 0) {
          const imgs = atts.filter((a) => a.kind === "image" || a.mimeType.startsWith("image/"));
          const resolved = (await Promise.all(imgs.map((a) => chatImageUrlForLLM(a.url)))).filter((u): u is string => !!u);
          const others = atts.filter((a) => !(a.kind === "image" || a.mimeType.startsWith("image/")));
          let otherNote: string;
          if (selfHosted && m.id === userMsg.id && others.length > 0) {
            const parts = await Promise.all(others.map(async (a) => {
              const docText = await chatDocTextForLLM(a);
              return docText ? `【文档：${a.name}】\n${docText}` : `[附件：${a.name}]`;
            }));
            otherNote = parts.join("\n\n");
          } else {
            otherNote = others.map((a) => `[附件：${a.name}]`).join(" ");
          }
          const text = [m.content, otherNote].filter(Boolean).join("\n") || "请分析附带的图片。";
          if (resolved.length > 0) {
            return { role, content: [{ type: "text" as const, text }, ...resolved.map((url) => ({ type: "image_url" as const, image_url: { url } }))] };
          }
          return { role, content: text };
        }
        return { role, content: m.content };
      }));
      // 系统提示词：客户端选了「模板」则用其人设，否则用默认助手人设。注意——本会话是
      // 共享的「AI 助手」长对话，历史里可能堆着此前某个角色（如某模型专家）的大量回复，
      // 真实 LLM 会顺着历史里已确立的人设走，导致「换了模板却还是旧角色」。故选了模板时
      // 把人设包成「最高优先级、覆盖历史角色」的强指令，让切换立即生效。
      const systemContent = input.systemPrompt?.trim()
        ? `你现在的角色设定如下（最高优先级，必须覆盖本次对话历史中你此前扮演过的任何其它角色 / 风格 / 人设）：\n\n${input.systemPrompt.trim()}\n\n请从现在起严格、始终以上述角色与风格回答，不要再沿用历史对话里的旧角色。`
        : "你是内嵌在团队协作工具里的 AI 助手，用简洁、专业、友好的中文回答用户的问题，可协助创作、答疑、润色等。";
      const llmMessages = [
        { role: "system" as const, content: systemContent },
        ...histMsgs,
      ];

      // 3) 调 LLM
      let reply: string;
      try {
        const resp = await invokeLLMWithKie(ctx, { messages: llmMessages, model: input.model }, input.kieTempKey);
        reply = extractTextContent(resp).trim() || "（模型未返回内容）";
      } catch (err) {
        reply = `⚠️ AI 回复失败：${err instanceof Error ? err.message : String(err)}`;
      }

      // 4) 落库并广播 AI 回复
      const aiMsg = await insertConversationMessage({
        conversationId: conv.id, senderId: aiId, senderName: ASSISTANT_NAME, content: reply,
      });
      if (aiMsg && broadcaster) broadcaster(conv.id, rowToWire(aiMsg));
      return aiMsg ? rowToWire(aiMsg) : null;
    }),

  // 「新对话」：清空当前用户与 AI 助手私聊的全部历史（保留会话本身）。切换人设后历史
  // 清空 → 新模板从零开始，彻底摆脱旧角色惯性。仅限本人 ↔ AI 助手的 DM。
  clearAssistant: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const aiId = await getOrCreateAssistantUserId();
      const conv = await getConversationById(input.conversationId);
      if (!conv || conv.type !== "dm") throw new TRPCError({ code: "NOT_FOUND" });
      if (conv.dmKey !== dmKeyFor(ctx.user.id, aiId)) throw new TRPCError({ code: "FORBIDDEN", message: "非 AI 助手会话" });
      await clearConversationMessages(conv.id);
      if (eventBroadcaster) eventBroadcaster(conv.id, "conversation:cleared", { conversationId: conv.id });
      return { success: true };
    }),

  inviteToRoom: protectedProcedure
    .input(z.object({ conversationId: z.number(), targetUserId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv || conv.type !== "group") throw new TRPCError({ code: "NOT_FOUND" });
      // 仅群主可拉人（与 setMode/deleteRoom 一致；客户端 createGroupWith 里拉人者即建群者=群主，
      // 故不影响正常流程）。此前只校验「是成员」，任意普通成员都能拉人——属越权。
      const members = await listChatMembers(conv.id);
      const me = members.find((m) => m.userId === ctx.user.id);
      if (!me || (me.role !== "owner" && conv.createdBy !== ctx.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅群主可邀请成员" });
      }
      // 目标用户须真实存在，避免写入孤儿成员行。
      if (!(await getUserById(input.targetUserId))) throw new TRPCError({ code: "NOT_FOUND", message: "目标用户不存在" });
      // 关键：不得把被本群封禁的用户重新拉回（sendMessage 有此校验，邀请此前漏写→绕过封禁）。
      if (await isChatBanned(input.targetUserId, conv.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "该用户已被封禁，无法邀请" });
      }
      if (members.some((m) => m.userId === input.targetUserId)) return { success: true }; // 已在群中→幂等
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
      if (input.attachmentIds?.length) await linkAttachmentsToMessage(msg.id, input.attachmentIds, conv.id);
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

      const keyName = storageKeyName(input.filename);
      const displayName = displayFileName(input.filename);
      const date = new Date().toISOString().slice(0, 10);
      const key = `chat/${conv.id}/${date}/${crypto.randomUUID()}-${keyName}`;
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
        name: displayName, mimeType: input.mimeType, size: buffer.length, kind: kindFromMime(input.mimeType),
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

      const keyName = storageKeyName(input.filename);
      const displayName = displayFileName(input.filename);
      const date = new Date().toISOString().slice(0, 10);
      const relKey = `chat/${conv.id}/${date}/${crypto.randomUUID()}-${keyName}`;
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
          key, url: `/manus-storage/${key}`, name: displayName, kind: kindFromMime(input.mimeType),
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
      return { mode: "presigned" as const, uploadUrl, key, url, name: displayName, kind: kindFromMime(input.mimeType) };
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
        name: displayFileName(input.name), mimeType: input.mimeType, size: input.size, kind: kindFromMime(input.mimeType),
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
