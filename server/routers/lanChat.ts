import path from "path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../_core/trpc";
import { assertLanOnly } from "../_core/lanGate";
import { lanChatBus } from "../_core/lanChatBus";
import { storagePut, isStorageConfigured } from "../storage";
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

export const lanChatRouter = router({
  // Nickname → sessionId. Caller stores sessionId in localStorage and passes
  // it on every subsequent call (also as socket.io `auth.sessionId`).
  joinSession: publicProcedure
    .input(z.object({ nickname: z.string().trim().min(1).max(20) }))
    .mutation(({ ctx, input }) => {
      assertLanOnly(ctx);
      const res = lanChatBus.joinSession(input.nickname, ctx.clientIp);
      return res;
    }),

  // Rooms
  listRooms: publicProcedure.query(async ({ ctx }) => {
    assertLanOnly(ctx);
    const rows = await listLanChatRooms();
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }),

  createRoom: publicProcedure
    .input(z.object({
      sessionId: z.string().min(1),
      name: z.string().trim().min(1).max(80),
    }))
    .mutation(async ({ ctx, input }) => {
      assertLanOnly(ctx);
      const sess = lanChatBus.getSession(input.sessionId);
      if (!sess) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先输入昵称" });
      const row = await createLanChatRoom(input.name);
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "创建房间失败" });
      return { id: row.id, name: row.name };
    }),

  // History — newest-first, client reverses for chronological render
  getMessages: publicProcedure
    .input(z.object({
      roomId: z.number().int(),
      beforeId: z.number().int().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      assertLanOnly(ctx);
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
      assertLanOnly(ctx);
      const sess = lanChatBus.getSession(input.sessionId);
      if (!sess) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先输入昵称" });
      if (!input.content.trim() && !(input.attachments?.length ?? 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "消息内容不能为空" });
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

  // Media upload — LAN-only variant of upload.uploadImage. We accept video
  // MIME types too (image: shown inline, video: link reference).
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
    .mutation(async ({ ctx, input }) => {
      assertLanOnly(ctx);
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
