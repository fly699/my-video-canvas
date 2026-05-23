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
  const priorCached = _cachedEnabled;
  const priorExpiry = _cacheExpiry;
  let postInvalidationGen: number | undefined;
  try {
    const settings = await db.getWhitelistSettings();
    // Only write cache if no invalidation happened while awaiting.
    if (_cacheGeneration === gen) {
      _cachedEnabled = settings?.enabled ?? false;
      _cacheExpiry = Date.now() + 30_000;
      return _cachedEnabled;
    }
    // Generation changed — re-read once for the post-invalidation value and cache it
    // so subsequent callers hit the fast-path rather than repeating this round-trip.
    postInvalidationGen = _cacheGeneration;
    const fresh = await db.getWhitelistSettings();
    if (_cacheGeneration === postInvalidationGen) {
      _cachedEnabled = fresh?.enabled ?? false;
      _cacheExpiry = Date.now() + 30_000;
    }
    return fresh?.enabled ?? false;
  } catch (err) {
    console.error("[Whitelist] DB error in isWhitelistEnabled, treating as disabled:", err);
    // Write the 5-second error-throttle only when:
    //   1. latestGen matches _cacheGeneration (no further invalidation since our last snapshot)
    //   2. _cachedEnabled === priorCached (no concurrent sibling changed the boolean value)
    //   3. _cacheExpiry === priorExpiry (no concurrent sibling refreshed the TTL)
    // Guards 2+3 together prevent the false===false edge case where a sibling wrote the same
    // boolean but a fresh 30-second expiry — without the expiry check we'd overwrite it with 5 s.
    const latestGen = postInvalidationGen ?? gen;
    if (_cacheGeneration === latestGen && _cachedEnabled === priorCached && _cacheExpiry === priorExpiry) {
      _cachedEnabled = false;
      _cacheExpiry = Date.now() + 5_000;
    }
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
