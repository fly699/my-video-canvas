import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc";
import { isWatermarkEnabled } from "./storageConfig";

export const systemRouter = router({
  // App-wide media-protection flags readable by any logged-in user (the watermark
  // overlay needs to know whether to render). Admin-only settings stay in the
  // admin router; this exposes ONLY the booleans clients must act on.
  mediaProtection: protectedProcedure.query(async () => ({
    watermarkEnabled: await isWatermarkEnabled(),
  })),

  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
