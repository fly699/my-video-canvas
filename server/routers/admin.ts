import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { invalidateWhitelistCache } from "../_core/whitelist";

const AUDIT_ACTIONS = [
  "login_email", "login_oauth",
  "image_gen", "video_gen",
  "audio_music", "audio_dubbing",
  "subtitle_transcribe",
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

    clear: adminProcedure.mutation(async () => {
      await db.clearAuditLogs();
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
      ))
      .mutation(async ({ ctx, input }) => {
        await db.addWhitelistEntry(input.type, input.value, input.note ?? null, ctx.user.id);
        return { success: true };
      }),

    removeEntry: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await db.removeWhitelistEntry(input.id);
        return { success: true };
      }),
  }),
});
