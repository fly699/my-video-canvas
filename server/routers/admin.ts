import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { invalidateWhitelistCache } from "../_core/whitelist";
import { invalidateStorageSettingsCache } from "../_core/storageConfig";
import { storagePut } from "../storage";
import { ENV } from "../_core/env";
import { randomBytes } from "crypto";

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
      return { enabled: settings?.enabled ?? false };
    }),

    setEnabled: adminProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        await db.setWhitelistEnabled(input.enabled);
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
      }))
      .mutation(async ({ input }) => {
        if (input.persistAudio === undefined && input.persistVideo === undefined && input.persistImage === undefined) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "至少需要指定 persistAudio / persistVideo / persistImage 其中一项" });
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
      if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
        return {
          ok: false as const,
          ms: Date.now() - t0,
          stage: "config" as const,
          error: "BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY 未设置 — Manus 部署需要在环境变量配置这两个值，storagePut 才能工作。",
        };
      }
      try {
        const probeBytes = Buffer.from(`persistence-probe-${Date.now()}`, "utf8");
        const { url } = await storagePut(`probe/probe-${Date.now()}.txt`, probeBytes, "text/plain");
        return {
          ok: true as const,
          ms: Date.now() - t0,
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
          error: msg.slice(0, 500),
        };
      }
    }),
  }),

  // ── LAN chat audit (admin-only cross-network read) ─────────────────────
  // The user-facing lanChatRouter enforces per-network isolation. Admins
  // need to see EVERYTHING across networks for moderation / audit. These
  // endpoints intentionally bypass the network filter — they are behind
  // adminProcedure so only the configured owner can call them.
  lanChat: router({
    listRooms: adminProcedure.query(async () => {
      const rooms = await db.listAllLanChatRooms();
      return rooms.map((r) => ({
        id: r.id,
        name: r.name,
        networkGroupId: r.networkGroupId,
        createdAt: r.createdAt,
      }));
    }),

    listMessages: adminProcedure
      .input(z.object({
        roomId: z.number().int().optional(),
        search: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }))
      .query(async ({ input }) => {
        const { rows, total } = await db.getAllLanChatMessages({
          roomId: input.roomId,
          search: input.search,
          limit: input.limit,
          offset: input.offset,
        });
        return {
          rows: rows.map((r) => ({
            id: r.id,
            roomId: r.roomId,
            nickname: r.nickname,
            color: r.color,
            content: r.content,
            attachments: r.attachments,
            clientIp: r.clientIp,
            createdAt: r.createdAt,
          })),
          total,
        };
      }),

    // ── Invite codes ───────────────────────────────────────────────────
    listInvites: adminProcedure.query(async () => {
      const rows = await db.listLanChatInvites();
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        groupId: r.groupId,
        expiresAt: r.expiresAt,
        usedAt: r.usedAt,
        usedByNickname: r.usedByNickname,
        usedByIp: r.usedByIp,
        createdAt: r.createdAt,
      }));
    }),

    createInvite: adminProcedure
      .input(z.object({
        /** The group to grant access to. Can be any valid groupId; usually
         *  starts with "code-" (server-coined) for the invite path. */
        groupId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).default(""),
        expiresInDays: z.number().int().min(1).max(90).default(7),
      }))
      .mutation(async ({ input }) => {
        // Auto-generate a unique group prefix if admin didn't supply one,
        // so invitees land in a fresh sandbox not colliding with any IP group.
        const code = randomBytes(12).toString("base64url");
        const groupId = input.groupId || `code-${randomBytes(6).toString("base64url")}`;
        const expiresAt = new Date(Date.now() + input.expiresInDays * 86400_000);
        const row = await db.createLanChatInvite({ code, groupId, expiresAt });
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "邀请码创建失败" });
        return { id: row.id, code: row.code, groupId: row.groupId, expiresAt: row.expiresAt };
      }),

    // ── IP whitelist ────────────────────────────────────────────────────
    getIpWhitelistSettings: adminProcedure.query(async () => {
      const settings = await db.getLanChatSettings();
      const ips = await db.listLanChatIpWhitelist();
      return {
        enabled: settings.ipWhitelistEnabled,
        ips: ips.map((r) => ({ id: r.id, ip: r.ip, note: r.note, createdAt: r.createdAt })),
      };
    }),

    setIpWhitelistEnabled: adminProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        await db.setLanChatIpWhitelistEnabled(input.enabled);
        return { success: true };
      }),

    addIpToWhitelist: adminProcedure
      .input(z.object({
        // Same charset guard as the app-wide whitelist (admin.ts: prevent
        // "unknown" / strings that would bypass the IP gate).
        ip: z.string().min(1).max(64).refine(
          (v) => /^[\d.:a-fA-F/]+$/.test(v),
          { message: "IP 格式无效（仅允许数字、点、冒号、十六进制、斜杠）" },
        ),
        note: z.string().max(200).optional(),
      }))
      .mutation(async ({ input }) => {
        const row = await db.addLanChatIpWhitelist({ ip: input.ip, note: input.note ?? null });
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "添加失败" });
        return { id: row.id, ip: row.ip, note: row.note };
      }),

    removeIpFromWhitelist: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        const ok = await db.removeLanChatIpWhitelist(input.id);
        if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "条目不存在" });
        return { success: true };
      }),

    // ── Connection metadata audit ───────────────────────────────────────
    // Replaces the deprecated message-content audit (P2P E2E means server
    // has no message content). Reads from audit_logs filtered to lan_chat
    // events.
    listJoinEvents: adminProcedure
      .input(z.object({
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }))
      .query(async ({ input }) => {
        // Reuse the existing audit log infrastructure — action prefix
        // "lan_chat:" was added in earlier rounds; here we surface them.
        // No dedicated action filter in getAuditLogs, so fetch broad then
        // filter in JS. Since admin page is low-traffic, fine.
        const all = await db.getAuditLogs({ limit: 200, offset: 0 });
        const filtered = all.rows.filter((r) => r.action.startsWith("lan_chat:"));
        return {
          rows: filtered.slice(input.offset, input.offset + input.limit),
          total: filtered.length,
        };
      }),
  }),
});
