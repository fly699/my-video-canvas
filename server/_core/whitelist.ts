import { TRPCError } from "@trpc/server";
import * as db from "../db";
import type { TrpcContext } from "./context";

let _cachedEnabled: boolean | null = null;
let _cacheExpiry = 0;
// Incremented on every invalidation so in-flight DB reads don't overwrite with stale data.
let _cacheGeneration = 0;

export function invalidateWhitelistCache(): void {
  _cachedEnabled = null;
  _cacheExpiry = 0;
  _cacheGeneration++;
}

async function isWhitelistEnabled(): Promise<boolean> {
  const now = Date.now();
  if (_cachedEnabled !== null && now < _cacheExpiry) return _cachedEnabled;

  const gen = _cacheGeneration;
  try {
    const settings = await db.getWhitelistSettings();
    // Only write to cache if no invalidation happened while awaiting the DB.
    // If generation changed, skip the write — the next caller will re-read and pick up the
    // fresh value; a second eager read here would cause an unbounded concurrent query storm.
    if (_cacheGeneration === gen) {
      _cachedEnabled = settings?.enabled ?? false;
      _cacheExpiry = now + 30_000;
    }
    return settings?.enabled ?? false;
  } catch (err) {
    console.error("[Whitelist] DB error in isWhitelistEnabled, treating as disabled:", err);
    // Always write the throttle cache (no generation check) so every caller backs off for
    // 5 s regardless of concurrent invalidations — prevents hammering a downed DB.
    // Use Date.now() here (not the stale `now`) so the TTL is always 5 s from now.
    _cachedEnabled = false;
    _cacheExpiry = Date.now() + 5_000;
    return false;
  }
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
