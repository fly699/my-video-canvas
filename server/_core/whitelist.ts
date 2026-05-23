import { TRPCError } from "@trpc/server";
import * as db from "../db";
import type { TrpcContext } from "./context";

let _cachedEnabled: boolean | null = null;
let _cacheExpiry = 0;

export function invalidateWhitelistCache(): void {
  _cachedEnabled = null;
  _cacheExpiry = 0;
}

async function isWhitelistEnabled(): Promise<boolean> {
  const now = Date.now();
  if (_cachedEnabled !== null && now < _cacheExpiry) return _cachedEnabled;
  const settings = await db.getWhitelistSettings();
  _cachedEnabled = settings?.enabled ?? false;
  _cacheExpiry = now + 30_000;
  return _cachedEnabled;
}

export async function assertWhitelisted(ctx: TrpcContext): Promise<void> {
  const enabled = await isWhitelistEnabled();
  if (!enabled) return;
  if (ctx.user?.role === "admin") return; // admins always bypass

  const userId = ctx.user?.id;
  if (userId != null && (await db.isWhitelisted("user", String(userId)))) return;
  if (ctx.clientIp && (await db.isWhitelisted("ip", ctx.clientIp))) return;

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "您没有使用此功能的权限，请联系管理员加入白名单",
  });
}
