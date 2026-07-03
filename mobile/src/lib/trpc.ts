import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers"; // 复用服务端路由类型（type-only，不打包服务端代码）
import { getBaseUrlSync } from "./config";
import { getToken } from "./auth";

export const trpc = createTRPCReact<AppRouter>();

/** 创建 tRPC 客户端：与 Web 端同配置（superjson + /api/trpc），但用 Authorization: Bearer 传会话令牌，
 *  而不是 Cookie。base 每次从 config 读，令牌每次从内存读，切换服务器/登录态即时生效。 */
export function makeTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getBaseUrlSync()}/api/trpc`,
        transformer: superjson,
        headers() {
          const t = getToken();
          return t ? { authorization: `Bearer ${t}` } : {};
        },
      }),
    ],
  });
}
