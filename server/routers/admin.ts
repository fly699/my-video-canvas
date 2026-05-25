import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { invalidateWhitelistCache } from "../_core/whitelist";
import { invalidateStorageSettingsCache } from "../_core/storageConfig";

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
      }))
      .mutation(async ({ input }) => {
        if (input.persistAudio === undefined && input.persistVideo === undefined) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "至少需要指定 persistAudio 或 persistVideo 其中一项" });
        }
        await db.setStorageSettings(input);
        invalidateStorageSettingsCache();
        return { success: true };
      }),
  }),
});
