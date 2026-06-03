import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  projectsRouter,
  nodesRouter,
  edgesRouter,
  assetsRouter,
  videoTasksRouter,
  aiChatRouter,
  imageGenRouter,
  scriptsRouter,
  audioGenRouter,
  clipRouter,
  aiEnhanceRouter,
  mergeRouter,
  subtitleRouter,
  overlayRouter,
  subtitleMotionRouter,
  voiceCloneRouter,
  lipSyncRouter,
  avatarRouter,
  comfyuiRouter,
  configRouter,
} from "./routers/canvas";
import { uploadRouter } from "./routers/upload";
import { comfyStressRouter } from "./routers/comfyStress";
import { adminRouter } from "./routers/admin";
import { collaborationRouter } from "./routers/collaboration";
import { chatRouter } from "./routers/chat";
import { poyoRouter } from "./routers/poyo";
import { downloadsRouter } from "./routers/downloads";
import { editorRouter } from "./routers/editor";
import { comfyTemplatesRouter } from "./routers/comfyTemplates";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => {
      if (!opts.ctx.user) return null;
      const { passwordHash: _omit, ...safeUser } = opts.ctx.user;
      return safeUser;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  projects: projectsRouter,
  nodes: nodesRouter,
  edges: edgesRouter,
  assets: assetsRouter,
  videoTasks: videoTasksRouter,
  aiChat: aiChatRouter,
  imageGen: imageGenRouter,
  scripts: scriptsRouter,
  audioGen: audioGenRouter,
  clip: clipRouter,
  aiEnhance: aiEnhanceRouter,
  merge: mergeRouter,
  subtitle: subtitleRouter,
  overlay: overlayRouter,
  subtitleMotion: subtitleMotionRouter,
  voiceClone: voiceCloneRouter,
  lipSync: lipSyncRouter,
  avatar: avatarRouter,
  comfyui: comfyuiRouter,
  comfyStress: comfyStressRouter,
  config: configRouter,
  upload: uploadRouter,
  admin: adminRouter,
  collaboration: collaborationRouter,
  chat: chatRouter,
  poyo: poyoRouter,
  downloads: downloadsRouter,
  editor: editorRouter,
  comfyTemplates: comfyTemplatesRouter,
});

export type AppRouter = typeof appRouter;
