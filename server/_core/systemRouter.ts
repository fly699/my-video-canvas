import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc";
import { isWatermarkEnabled, isDevtoolsBlockEnabled } from "./storageConfig";
import { getVersionInfo } from "./selfUpdate";

// 部署标识(git 短哈希)：进程内缓存——同一次部署里恒定，重新部署(git pull+重启)后变。
// 前端轮询比对，变化即提示用户按 F5 刷新载入新版。
let cachedBuildId: string | null = null;

export const systemRouter = router({
  // 面向所有访客的构建标识,用于「应用已更新，请刷新」横幅(公开、极轻量)。
  buildId: publicProcedure.query(async () => {
    if (cachedBuildId === null) {
      try { cachedBuildId = (await getVersionInfo()).commit || "unknown"; } catch { cachedBuildId = "unknown"; }
    }
    return { buildId: cachedBuildId };
  }),

  // App-wide media-protection flags readable by any logged-in user (the watermark
  // overlay / devtools deterrent need to know whether to act). Admin-only settings
  // stay in the admin router; this exposes ONLY the booleans clients must act on.
  mediaProtection: protectedProcedure.query(async () => ({
    watermarkEnabled: await isWatermarkEnabled(),
    devtoolsBlock: await isDevtoolsBlockEnabled(),
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
