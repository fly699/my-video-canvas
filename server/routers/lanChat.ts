import path from "path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../_core/trpc";
import { lanChatBus } from "../_core/lanChatBus";
import { storagePut, isStorageConfigured } from "../storage";
import { writeAuditLog } from "../_core/auditLog";
import { hashPassword } from "../_core/scrypt";
import {
  listLanChatRooms,
  createLanChatRoom,
  deleteLanChatRoom,
  insertLanChatMessage,
  getLanChatMessages,
  redeemLanChatInvite,
  getLanChatSettings,
  isIpInLanChatWhitelist,
} from "../db";
import type { LanChatMessage, ChatAttachment } from "../../shared/types";

// Reuse the existing multimodal attachment shape so the chat input drop zone
// can share parsing logic with AIChatNode.
const attachmentSchema = z.object({
  type: z.enum(["image", "file"]),
  url: z.string().max(2048),
  mimeType: z.string().max(128),
  name: z.string().max(255),
  textContent: z.string().max(50_000).optional(),
});

const ALLOWED_UPLOAD_MIME = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime", "video/x-matroska",
] as const;

function rowToWire(row: {
  id: number; roomId: number; nickname: string; color: string;
  content: string; attachments: unknown; createdAt: Date;
}): LanChatMessage {
  return {
    id: row.id,
    roomId: row.roomId,
    nickname: row.nickname,
    color: row.color,
    content: row.content,
    attachments: (row.attachments as ChatAttachment[] | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// Forward declaration — Express bootstrapping sets this once io is created.
// kept module-local so the tRPC layer doesn't need to import index.ts (cycle).
let broadcaster: ((roomId: number, msg: LanChatMessage) => void) | null = null;
export function registerLanChatBroadcaster(fn: (roomId: number, msg: LanChatMessage) => void): void {
  broadcaster = fn;
}

// Group-level broadcaster — push an event to every socket in a networkGroup
// (e.g. "a new room was created") so peers update without a manual refresh.
let groupBroadcaster: ((groupId: string, event: string, payload: unknown) => void) | null = null;
export function registerLanChatGroupBroadcaster(
  fn: (groupId: string, event: string, payload: unknown) => void,
): void {
  groupBroadcaster = fn;
}

// Group-ID validator. Accepts:
//   "public"     — global fallback (when client can't detect LAN)
//   "lan-A.B.C"  — RFC1918 /24 subnet detected by browser WebRTC
//   "code-XYZ"   — explicit invite code from URL hash (#g=XYZ)
// Length-capped + charset-restricted so it can safely become a column value.
const groupIdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);

/** Ensure every network has a "大厅" room — auto-created lazily on the
 *  first joinSession from that network. Avoids the cold-start "no rooms"
 *  experience when a brand-new IP arrives. */
async function ensureLobby(networkGroupId: string): Promise<void> {
  await createLanChatRoom(networkGroupId, "大厅");
}

export const lanChatRouter = router({
  // Server-observed client IP — the reliable, third-party-free way to group
  // LAN users. For a cloud-hosted server, every browser behind the same
  // office/home NAT egresses through one public IP, so the server sees the
  // same clientIp for all of them → same group. This replaces the fragile
  // browser-side ipify/icanhazip fetch (which fails on rate-limits, CORS,
  // ad-blockers, or air-gapped LANs and then locks users out entirely).
  // Returns a normalized IPv4/IPv6 string, or null when the server itself
  // can't determine it (e.g. "unknown").
  clientInfo: publicProcedure.query(({ ctx }) => {
    let ip = ctx.clientIp || "";
    // Normalize IPv4-mapped IPv6 (::ffff:1.2.3.4) and IPv6 loopback.
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    if (ip === "::1") ip = "127.0.0.1";
    const usable = /^[0-9a-fA-F.:]{3,45}$/.test(ip) && ip !== "unknown";
    return { ip: usable ? ip : null };
  }),


  // Nickname + LAN groupId → sessionId. The groupId is computed CLIENT-SIDE
  // (WebRTC ICE host candidate → /24 subnet, or URL #g= override, or
  // "public" fallback). Server trusts what the client reports — this is
  // best-effort LAN grouping, not authentication.
  //
  // Effect: two browsers on the same WiFi see the same group code (their
  // shared subnet) → join the same chat. Cross-LAN users get different
  // codes → separate chats. Browsers blocking WebRTC ICE fall back to
  // "public" so users still come online (just in the global pool).
  joinSession: publicProcedure
    .input(z.object({
      nickname: z.string().trim().min(1).max(20),
      // No default — client must supply a real groupId derived from
      // browser-detected public IP or URL-hash invite code. We reject
      // the legacy "public" pool here so old clients can't slip back
      // into the global free-for-all.
      groupId: groupIdSchema,
      // Client-generated persistent device fingerprint (UUID stored in
      // localStorage). Included in the session dedup key so two different
      // users on the same LAN who pick the same nickname each get their
      // own session instead of colliding into one shared sessionId.
      deviceId: z.string().min(1).max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.groupId === "public") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "需要获取公网 IP 后才能加入聊天（请刷新或使用 /lan-chat#g=代号 邀请链接）",
        });
      }
      // Admin-controlled public-IP whitelist. When enabled, only IPs in
      // lan_chat_ip_whitelist may join. Invite-code groups (starts with
      // "code-") bypass this — admin has explicitly given those out.
      const settings = await getLanChatSettings();
      if (settings.ipWhitelistEnabled && !input.groupId.startsWith("code-")) {
        if (!(await isIpInLanChatWhitelist(ctx.clientIp))) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "本应用聊天功能已启用 IP 白名单，您的 IP 未在允许列表",
          });
        }
      }
      await ensureLobby(input.groupId);
      const res = lanChatBus.joinSession(input.nickname, input.groupId, input.deviceId);
      // Audit log — record both the client-reported IP (extracted from
      // groupId when source is "ip-…") and the server-observed clientIp.
      // Mismatch tells admins the user is behind a reverse proxy / VPN
      // where the two diverge; not necessarily fraud, but worth noting.
      const reportedIp = input.groupId.startsWith("ip-") ? input.groupId.slice(3) : null;
      writeAuditLog({
        ctx,
        action: "lan_chat:join",
        detail: { nickname: res.nickname, groupId: input.groupId, reportedIp, serverIp: ctx.clientIp },
      });
      if (reportedIp && reportedIp !== ctx.clientIp) {
        writeAuditLog({
          ctx,
          action: "lan_chat:ip_mismatch",
          detail: { reportedIp, serverIp: ctx.clientIp, nickname: res.nickname },
        });
      }
      return res;
    }),

  listRooms: publicProcedure
    .input(z.object({ sessionId: z.string().min(1).optional() }).optional())
    .query(async ({ input }) => {
      // The chat group lives on the session. Without it we don't know
      // which network to show → return empty (the caller's hook just
      // got an empty rooms list, will re-fetch after joinSession).
      const sid = input?.sessionId;
      if (!sid) return [];
      const sess = lanChatBus.getSession(sid);
      if (!sess) return [];
      const rows = await listLanChatRooms(sess.networkGroupId);
      return rows.map((r) => ({ id: r.id, name: r.name, isPrivate: !!r.passwordHash }));
  }),

  createRoom: publicProcedure
    .input(z.object({
      sessionId: z.string().min(1),
      name: z.string().trim().min(1).max(80),
      /** Optional — when set, room is private; enterRoom requires the
       *  same password. Stored as scrypt hash, never in cleartext. */
      password: z.string().min(1).max(128).optional(),
    }))
    .mutation(async ({ input }) => {
      const sess = lanChatBus.getSession(input.sessionId);
      if (!sess) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先输入昵称" });
      const passwordHash = input.password ? await hashPassword(input.password) : null;
      const row = await createLanChatRoom(sess.networkGroupId, input.name, passwordHash);
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "创建房间失败" });
      // Notify everyone in the same network group so the new room appears
      // in their sidebar without a page refresh.
      groupBroadcaster?.(sess.networkGroupId, "lan-chat:room-created", {
        id: row.id, name: row.name, isPrivate: !!passwordHash,
      });
      return { id: row.id, name: row.name, isPrivate: !!passwordHash };
    }),

  deleteRoom: publicProcedure
    .input(z.object({
      sessionId: z.string().min(1),
      roomId: z.number().int(),
    }))
    .mutation(async ({ input }) => {
      const sess = lanChatBus.getSession(input.sessionId);
      if (!sess) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先输入昵称" });
      const rooms = await listLanChatRooms(sess.networkGroupId);
      if (!rooms.some((r) => r.id === input.roomId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "房间不存在" });
      }
      if (rooms.length <= 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能删除最后一个房间" });
      }
      await deleteLanChatRoom(input.roomId);
      groupBroadcaster?.(sess.networkGroupId, "lan-chat:room-deleted", { id: input.roomId });
      return { success: true };
    }),

  // History — newest-first, client reverses for chronological render
  getMessages: publicProcedure
    .input(z.object({
      sessionId: z.string().min(1).optional(),
      roomId: z.number().int(),
      beforeId: z.number().int().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      // Defense in depth: when the caller supplies a sessionId, verify
      // the requested room belongs to that session's group. Without
      // sessionId we allow read (history's already public to anyone
      // who guesses the id) — guarded only by length cap + rate limit.
      if (input.sessionId) {
        const sess = lanChatBus.getSession(input.sessionId);
        if (sess) {
          const rooms = await listLanChatRooms(sess.networkGroupId);
          if (!rooms.some((r) => r.id === input.roomId)) {
            throw new TRPCError({ code: "NOT_FOUND", message: "房间不存在" });
          }
        }
      }
      const rows = await getLanChatMessages(input.roomId, { beforeId: input.beforeId, limit: input.limit });
      return rows.map(rowToWire);
    }),

  // Send: persist + broadcast. socket.io handles realtime delivery to other
  // tabs — the sender's local UI also updates from the broadcast (no
  // optimistic dedup needed; the round-trip is fast on LAN).
  sendMessage: publicProcedure
    .input(z.object({
      sessionId: z.string().min(1),
      roomId: z.number().int(),
      content: z.string().max(4000),
      attachments: z.array(attachmentSchema).max(8).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sess = lanChatBus.getSession(input.sessionId);
      if (!sess) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先输入昵称" });
      if (!input.content.trim() && !(input.attachments?.length ?? 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "消息内容不能为空" });
      }
      // Cross-group send check: room must belong to caller's group.
      const rooms = await listLanChatRooms(sess.networkGroupId);
      if (!rooms.some((r) => r.id === input.roomId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "不能向其他网络的房间发消息" });
      }
      const row = await insertLanChatMessage({
        roomId: input.roomId,
        nickname: sess.nickname,
        color: sess.color,
        content: input.content,
        attachments: input.attachments ?? null,
        clientIp: ctx.clientIp,
      });
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "发送失败" });
      const wire = rowToWire(row);
      broadcaster?.(input.roomId, wire);
      return wire;
    }),

  uploadMedia: publicProcedure
    .input(z.object({
      sessionId: z.string().min(1),
      base64: z.string().refine((s) => !/^\s*data:/i.test(s), {
        message: "base64 must not include a data: prefix",
      }),
      mimeType: z.string().refine((t) => (ALLOWED_UPLOAD_MIME as readonly string[]).includes(t), {
        message: "Unsupported MIME type",
      }),
      filename: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      const sess = lanChatBus.getSession(input.sessionId);
      if (!sess) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先输入昵称" });
      const buf = Buffer.from(input.base64, "base64");
      if (buf.byteLength > 16 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "文件超过 16 MB" });
      }
      const ext = input.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
      const rawName = input.filename
        ? path.basename(input.filename).replace(/[^a-zA-Z0-9._-]/g, "_")
        : `lan-${Date.now()}.${ext}`;
      const today = new Date().toISOString().slice(0, 10);
      const key = `lan-chat/${today}/${sess.id}-${Date.now()}-${rawName}`;

      if (!isStorageConfigured()) {
        return { url: `data:${input.mimeType};base64,${input.base64}`, storageKey: key };
      }
      const { url } = await storagePut(key, buf, input.mimeType);
      return { url, storageKey: key };
    }),

  // Redeem a one-time invite code. Atomic single-use — concurrent
  // redemptions only let one through; rest get NOT_FOUND. Caller then
  // calls joinSession with the returned groupId.
  redeemInvite: publicProcedure
    .input(z.object({
      code: z.string().regex(/^[A-Za-z0-9_-]{4,64}$/),
      nickname: z.string().trim().min(1).max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const row = await redeemLanChatInvite(input.code, {
        nickname: input.nickname ?? "",
        ip: ctx.clientIp,
      });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "邀请码无效、已使用或已过期" });
      }
      return { groupId: row.groupId, expiresAt: row.expiresAt.toISOString() };
    }),
});
