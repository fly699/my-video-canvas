import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { adminTabFromRpcPath } from "../../shared/adminPerms";

/** 页面权限矩阵的统一后端强制：凡是 admin.* 端点（广播/perms 等豁免除外），
 *  除各自的静态级别门控外，还须满足站长在「权限管理」页为该页设置的最低级别。
 *  这样站长收紧任一页面时，低级管理员既看不到入口、也无法经 API 绕过（深度防御）。
 *  已通过静态门控（role=admin）后才调用；矩阵只会在静态级别之上收紧，不会放松。 */
async function enforceAdminMatrix(ctx: TrpcContext): Promise<void> {
  const tab = adminTabFromRpcPath(ctx.rpcPath);
  if (!tab) return;
  const { getTabMinLevel } = await import("./adminPerms");
  const need = await getTabMinLevel(tab);
  if ((ctx.user?.adminLevel ?? 0) < need) {
    throw new TRPCError({ code: "FORBIDDEN", message: `该页面需管理员级别 L${need} 及以上` });
  }
}

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
    await enforceAdminMatrix(ctx); // 页面权限矩阵后端强制（admin.* 端点，豁免除外）

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/** 管理员分级过程：要求 role='admin' 且 adminLevel >= `minLevel`。
 *  级别：1=查看员 · 2=运营 · 3=管理员 · 4=超级管理员 · 5=站长。
 *  `adminProcedure` 等价于「任意管理员」（level≥1）。 */
export function levelProcedure(minLevel: number) {
  return t.procedure.use(stampPath).use(
    t.middleware(async opts => {
      const { ctx, next } = opts;
      if (!ctx.user || ctx.user.role !== 'admin' || (ctx.user.adminLevel ?? 0) < minLevel) {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
      }
      await enforceAdminMatrix(ctx); // admin.* 端点叠加页面矩阵（非 admin 路径与豁免端点自动跳过）
      return next({ ctx: { ...ctx, user: ctx.user } });
    }),
  );
}

