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
} from "./routers/canvas";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
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
});

export type AppRouter = typeof appRouter;
