import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

// 接口路径盖章：把 tRPC path（如 "scripts.generate"）写进 ctx.rpcPath，供 LLM 调用
// 日志当场景标签（invokeLLMWithKie 统一读取）。直接可变写在原 ctx 对象上——后续中间件
// 展开复制（{...ctx}）与后台任务捕获的 ctx 都同引用/同拷贝，天然带上。
const stampPath = t.middleware(async ({ ctx, path, next }) => {
  ctx.rpcPath = path;
  return next();
});

export const publicProcedure = t.procedure.use(stampPath);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(stampPath).use(requireUser);

export const adminProcedure = t.procedure.use(stampPath).use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/** 管理员分级过程：要求 role='admin' 且 adminLevel >= `minLevel`。
 *  级别：1=查看员 · 2=运营 · 3=管理员 · 4=超级管理员。
 *  `adminProcedure` 等价于「任意管理员」（level≥1）。 */
export function levelProcedure(minLevel: number) {
  return t.procedure.use(stampPath).use(
    t.middleware(async opts => {
      const { ctx, next } = opts;
      if (!ctx.user || ctx.user.role !== 'admin' || (ctx.user.adminLevel ?? 0) < minLevel) {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
      }
      return next({ ctx: { ...ctx, user: ctx.user } });
    }),
  );
}
