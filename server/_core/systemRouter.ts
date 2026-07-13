import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc";
import { isWatermarkEnabled, isDevtoolsBlockEnabled } from "./storageConfig";
import { getVersionInfo } from "./selfUpdate";
import { listTutorialImages, setTutorialImage, deleteTutorialImage } from "../db";

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

  // ── #116 教程截图自定义：正文引用 slug，管理员可随时替换（前端优先取此处 URL）──
  tutorialImages: protectedProcedure.query(async () => ({ images: await listTutorialImages() })),
  setTutorialImage: adminProcedure
    .input(z.object({
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$/, "slug 仅限小写字母/数字/连字符"),
      url: z.string().min(1).max(2000).refine((u) => u.startsWith("/") || /^https?:\/\//i.test(u), "仅支持站内路径或 http(s) URL"),
    }))
    .mutation(async ({ input }) => { await setTutorialImage(input.slug, input.url); return { ok: true }; }),
  resetTutorialImage: adminProcedure
    .input(z.object({ slug: z.string().min(1).max(120) }))
    .mutation(async ({ input }) => { await deleteTutorialImage(input.slug); return { ok: true }; }),

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
