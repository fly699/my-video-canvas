import path from "path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../_core/trpc";
import { lanChatBus } from "../_core/lanChatBus";
import { storagePut, isStorageConfigured } from "../storage";
import { writeAuditLog } from "../_core/auditLog";
import {
  listLanChatRooms,
  createLanChatRoom,
  insertLanChatMessage,
  getLanChatMessages,
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
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.groupId === "public") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "需要获取公网 IP 后才能加入聊天（请刷新或使用 /lan-chat#g=代号 邀请链接）",
        });
      }
      await ensureLobby(input.groupId);
      const res = lanChatBus.joinSession(input.nickname, input.groupId);
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
      return rows.map((r) => ({ id: r.id, name: r.name }));
  }),

  createRoom: publicProcedure
    .input(z.object({
      sessionId: z.string().min(1),
      name: z.string().trim().min(1).max(80),
    }))
    .mutation(async ({ input }) => {
      const sess = lanChatBus.getSession(input.sessionId);
      if (!sess) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先输入昵称" });
      // Group comes from the session (set at joinSession time from the
      // client's WebRTC-detected LAN code), not from the per-request IP
      // — sessions persist across reconnects so the same user stays in
      // the same group regardless of proxy hops.
      const row = await createLanChatRoom(sess.networkGroupId, input.name);
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "创建房间失败" });
      return { id: row.id, name: row.name };
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
});
