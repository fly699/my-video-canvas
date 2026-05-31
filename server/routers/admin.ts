import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { invalidateWhitelistCache } from "../_core/whitelist";
import { invalidateStorageSettingsCache } from "../_core/storageConfig";
import { storagePut, storageBackend, isStorageConfigured } from "../storage";
import { ENV } from "../_core/env";
import { randomBytes } from "crypto";
import { getUpdateStatus, getVersionInfo, getUpdateAvailable, startUpdate } from "../_core/selfUpdate";

const AUDIT_ACTIONS = [
  "login_email", "login_oauth",
  "image_gen", "video_gen",
  "audio_music", "audio_dubbing",
  "subtitle_transcribe",
  "logs_cleared",
] as const;

export const adminRouter = router({
  logs: router({
    list: adminProcedure
      .input(z.object({
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
        action: z.enum(AUDIT_ACTIONS).optional(),
      }))
      .query(async ({ input }) => {
        return db.getAuditLogs({ limit: input.limit, offset: input.offset, action: input.action });
      }),

    clear: adminProcedure.mutation(async ({ ctx }) => {
      await db.clearAuditLogs();
      // Write a sentinel so the next log review shows when and who cleared
      await db.insertAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email ?? null,
        userName: ctx.user.name ?? null,
        ip: ctx.clientIp ?? "unknown",
        country: null, region: null, city: null,
        action: "logs_cleared",
        detail: null,
      });
      return { success: true };
    }),
  }),

  whitelist: router({
    getSettings: adminProcedure.query(async () => {
      const settings = await db.getWhitelistSettings();
      return { enabled: settings?.enabled ?? false, comfyuiBypass: settings?.comfyuiBypass ?? false };
    }),

    setEnabled: adminProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        await db.setWhitelistEnabled(input.enabled);
        invalidateWhitelistCache();
        return { success: true };
      }),

    setComfyuiBypass: adminProcedure
      .input(z.object({ comfyuiBypass: z.boolean() }))
      .mutation(async ({ input }) => {
        await db.setWhitelistComfyuiBypass(input.comfyuiBypass);
        invalidateWhitelistCache();
        return { success: true };
      }),

    listEntries: adminProcedure.query(async () => {
      return db.getWhitelistEntries();
    }),

    addEntry: adminProcedure
      .input(z.object({
        type: z.enum(["ip", "user"]),
        value: z.string().min(1).max(320),
        note: z.string().max(500).optional(),
      }).refine(
        (d) => d.type !== "user" || /^\d+$/.test(d.value),
        { message: "用户类型白名单的 value 必须为纯数字用户 ID", path: ["value"] }
      ).refine(
        (d) => d.type !== "ip" || /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$|^[0-9a-fA-F]{0,4}(:[0-9a-fA-F]{0,4}){2,7}$/.test(d.value),
        { message: "IP 类型白名单的 value 必须为合法的 IPv4（如 1.2.3.4）或 IPv6 地址", path: ["value"] }
      ))
      .mutation(async ({ ctx, input }) => {
        await db.addWhitelistEntry(input.type, input.value, input.note ?? null, ctx.user.id);
        invalidateWhitelistCache();
        return { success: true };
      }),

    removeEntry: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        const deleted = await db.removeWhitelistEntry(input.id);
        if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "白名单条目不存在" });
        invalidateWhitelistCache();
        return { success: true };
      }),
  }),

  storage: router({
    getSettings: adminProcedure.query(async () => {
      return db.getStorageSettings();
    }),

    setPersist: adminProcedure
      .input(z.object({
        persistAudio: z.boolean().optional(),
        persistVideo: z.boolean().optional(),
        persistImage: z.boolean().optional(),
        // Presigned GET URL validity for self-hosted S3/MinIO: 1 min … 7 days.
        presignTtlSec: z.number().int().min(60).max(604_800).optional(),
      }))
      .mutation(async ({ input }) => {
        if (
          input.persistAudio === undefined && input.persistVideo === undefined &&
          input.persistImage === undefined && input.presignTtlSec === undefined
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "至少需要指定 persistAudio / persistVideo / persistImage / presignTtlSec 其中一项" });
        }
        await db.setStorageSettings(input);
        invalidateStorageSettingsCache();
        return { success: true };
      }),

    // Active health check — uploads a tiny test object to Manus S3 and
    // returns the result. Lets the admin verify that storagePut actually
    // works rather than guessing from "the URL still looks like upstream"
    // (which can be caused by Forge config missing, S3 quota, network, etc.).
    test: adminProcedure.mutation(async () => {
      const t0 = Date.now();
      // Cheap config check first so the error message points at the actual
      // root cause rather than a downstream symptom.
      if (!isStorageConfigured()) {
        return {
          ok: false as const,
          ms: Date.now() - t0,
          stage: "config" as const,
          backend: "none" as const,
          error: "未配置对象存储 — 请设置 S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY（自建 MinIO，推荐），或 BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY。可运行 deploy\\setup-minio.bat 一键配置。",
        };
      }
      try {
        const probeBytes = Buffer.from(`persistence-probe-${Date.now()}`, "utf8");
        const { url } = await storagePut(`probe/probe-${Date.now()}.txt`, probeBytes, "text/plain");
        return {
          ok: true as const,
          ms: Date.now() - t0,
          backend: storageBackend(),
          url,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Stage classification helps the admin act: "config" → check env,
        // "presign" → Forge backend up but rejecting auth, "upload" → S3
        // reachable but PUT failed (quota / permission).
        let stage: "config" | "presign" | "upload" | "unknown" = "unknown";
        if (/Storage config missing/i.test(msg)) stage = "config";
        else if (/presign/i.test(msg)) stage = "presign";
        else if (/upload/i.test(msg) || /S3/i.test(msg)) stage = "upload";
        return {
          ok: false as const,
          ms: Date.now() - t0,
          stage,
          backend: storageBackend(),
          error: msg.slice(0, 500),
        };
      }
    }),
  }),

  // ── Chat administration (cross-user moderation + history) ──────────────
  // Admin-only. Server-mode conversations expose full plaintext history;
  // serverless (E2E) conversations expose metadata only — the server never
  // had their content.
  chat: router({
    listConversations: adminProcedure
      .input(z.object({
        type: z.enum(["lobby", "group", "dm"]).optional(),
        mode: z.enum(["server", "serverless"]).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }))
      .query(async ({ input }) => {
        const { rows, total } = await db.adminListConversations(input);
        const enriched = await Promise.all(rows.map(async (c) => {
          const members = await db.listChatMembers(c.id);
          return {
            id: c.id, type: c.type, mode: c.mode, title: c.title,
            isPrivate: !!c.passwordHash, memberCount: members.length,
            createdBy: c.createdBy, createdAt: c.createdAt,
          };
        }));
        return { rows: enriched, total };
      }),

    getConversation: adminProcedure
      .input(z.object({ conversationId: z.number().int() }))
      .query(async ({ input }) => {
        const conv = await db.getConversationById(input.conversationId);
        if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
        const members = await db.listChatMembers(conv.id);
        const membersWithNames = await Promise.all(members.map(async (m) => {
          const u = await db.getUserById(m.userId);
          return { userId: m.userId, name: u?.name ?? `用户${m.userId}`, role: m.role };
        }));
        return { id: conv.id, type: conv.type, mode: conv.mode, title: conv.title, members: membersWithNames };
      }),

    searchMessages: adminProcedure
      .input(z.object({
        userId: z.number().int().optional(),
        conversationId: z.number().int().optional(),
        keyword: z.string().max(200).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }))
      .query(async ({ input }) => {
        // If filtering by a specific conversation that is serverless, return
        // metadata-only (no content ever existed server-side).
        if (input.conversationId) {
          const conv = await db.getConversationById(input.conversationId);
          if (conv && conv.mode === "serverless") {
            return { rows: [], total: 0, encrypted: true as const };
          }
        }
        const { rows, total } = await db.adminSearchMessages({
          userId: input.userId,
          conversationId: input.conversationId,
          keyword: input.keyword,
          dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
          dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
          limit: input.limit,
          offset: input.offset,
        });
        return {
          rows: rows.map((r) => ({
            id: r.id, conversationId: r.conversationId, senderId: r.senderId,
            senderName: r.senderName, content: r.content, attachments: r.attachments,
            createdAt: r.createdAt,
          })),
          total,
          encrypted: false as const,
        };
      }),

    listFiles: adminProcedure
      .input(z.object({
        conversationId: z.number().int().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }))
      .query(async ({ input }) => {
        const { rows, total } = await db.adminListAttachments(input);
        return {
          rows: rows.map((a) => ({
            id: a.id, conversationId: a.conversationId, uploaderId: a.uploaderId,
            name: a.name, url: a.url, mimeType: a.mimeType, size: a.size, kind: a.kind,
            createdAt: a.createdAt,
          })),
          total,
        };
      }),

    deleteMessage: adminProcedure
      .input(z.object({ messageId: z.number().int() }))
      .mutation(async ({ input }) => {
        await db.deleteConversationMessage(input.messageId);
        return { success: true };
      }),

    deleteConversation: adminProcedure
      .input(z.object({ conversationId: z.number().int() }))
      .mutation(async ({ input }) => {
        await db.deleteConversation(input.conversationId);
        return { success: true };
      }),

    banUser: adminProcedure
      .input(z.object({
        userId: z.number().int(),
        scope: z.enum(["global", "conversation"]),
        conversationId: z.number().int().optional(),
        reason: z.string().max(255).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.scope === "conversation" && input.conversationId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "会话封禁需指定会话" });
        }
        const row = await db.addChatBan({
          userId: input.userId, scope: input.scope,
          conversationId: input.scope === "conversation" ? input.conversationId : null,
          reason: input.reason ?? null, bannedBy: ctx.user.id,
        });
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return { id: row.id };
      }),

    unbanUser: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await db.removeChatBan(input.id);
        return { success: true };
      }),

    listBans: adminProcedure.query(async () => {
      const rows = await db.listChatBans();
      return Promise.all(rows.map(async (b) => {
        const u = await db.getUserById(b.userId);
        return {
          id: b.id, userId: b.userId, userName: u?.name ?? `用户${b.userId}`,
          scope: b.scope, conversationId: b.conversationId, reason: b.reason, createdAt: b.createdAt,
        };
      }));
    }),

    getSettings: adminProcedure.query(async () => {
      const s = await db.getChatSettings();
      return { serverlessAllowed: s.serverlessAllowed, lobbyEnabled: s.lobbyEnabled, maxFileMb: s.maxFileMb };
    }),

    setSettings: adminProcedure
      .input(z.object({
        serverlessAllowed: z.boolean().optional(),
        lobbyEnabled: z.boolean().optional(),
        maxFileMb: z.number().int().min(1).max(5120).optional(),
      }))
      .mutation(async ({ input }) => {
        const s = await db.setChatSettings(input);
        return { serverlessAllowed: s.serverlessAllowed, lobbyEnabled: s.lobbyEnabled, maxFileMb: s.maxFileMb };
      }),
  }),

  // ── 系统更新（应用内一键更新；仅管理员）──
  update: router({
    version: adminProcedure.query(async () => {
      return getVersionInfo();
    }),
    // 红点提醒用：带 15 分钟缓存，频繁查询不会频繁 git fetch
    available: adminProcedure.query(async () => {
      return getUpdateAvailable(false);
    }),
    // 手动「检查更新」：强制刷新缓存
    check: adminProcedure.mutation(async () => {
      return getUpdateAvailable(true);
    }),
    status: adminProcedure.query(() => {
      return getUpdateStatus();
    }),
    run: adminProcedure.mutation(async () => {
      return startUpdate();
    }),
  }),
});
