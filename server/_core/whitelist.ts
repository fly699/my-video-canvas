import { TRPCError } from "@trpc/server";
import * as db from "../db";
import type { TrpcContext } from "./context";

interface WhitelistSettingsCache {
  enabled: boolean;
  comfyuiBypass: boolean;
}

let _cachedSettings: WhitelistSettingsCache | null = null;
let _cacheExpiry = 0;
// Incremented on every invalidation so in-flight DB reads don't overwrite with stale data.
let _cacheGeneration = 0;

const DISABLED: WhitelistSettingsCache = { enabled: false, comfyuiBypass: false };

export function invalidateWhitelistCache(): void {
  _cachedSettings = null;
  _cacheExpiry = 0;
  _cacheGeneration++;
}

async function getWhitelistSettingsCached(): Promise<WhitelistSettingsCache> {
  const now = Date.now();
  if (_cachedSettings !== null && now < _cacheExpiry) return _cachedSettings;

  const gen = _cacheGeneration;
  const priorCached = _cachedSettings;
  const priorExpiry = _cacheExpiry;
  let postInvalidationGen: number | undefined;
  try {
    const settings = await db.getWhitelistSettings();
    const value: WhitelistSettingsCache = {
      enabled: settings?.enabled ?? false,
      comfyuiBypass: settings?.comfyuiBypass ?? false,
    };
    // Only write cache if no invalidation happened while awaiting.
    if (_cacheGeneration === gen) {
      _cachedSettings = value;
      _cacheExpiry = Date.now() + 30_000;
      return _cachedSettings;
    }
    // Generation changed — re-read once for the post-invalidation value and cache it
    // so subsequent callers hit the fast-path rather than repeating this round-trip.
    postInvalidationGen = _cacheGeneration;
    const fresh = await db.getWhitelistSettings();
    const freshValue: WhitelistSettingsCache = {
      enabled: fresh?.enabled ?? false,
      comfyuiBypass: fresh?.comfyuiBypass ?? false,
    };
    if (_cacheGeneration === postInvalidationGen) {
      _cachedSettings = freshValue;
      _cacheExpiry = Date.now() + 30_000;
    }
    return freshValue;
  } catch (err) {
    console.error("[Whitelist] DB error in getWhitelistSettingsCached, treating as disabled:", err);
    // Write the 5-second error-throttle only when:
    //   1. latestGen matches _cacheGeneration (no further invalidation since our last snapshot)
    //   2. _cachedSettings === priorCached (no concurrent sibling changed the cached value)
    //   3. _cacheExpiry === priorExpiry (no concurrent sibling refreshed the TTL)
    // Guards 2+3 together prevent the edge case where a sibling wrote a value but a
    // fresh 30-second expiry — without the expiry check we'd overwrite it with 5 s.
    const latestGen = postInvalidationGen ?? gen;
    if (_cacheGeneration === latestGen && _cachedSettings === priorCached && _cacheExpiry === priorExpiry) {
      _cachedSettings = DISABLED;
      _cacheExpiry = Date.now() + 5_000;
    }
    return DISABLED;
  }
}

/** Shared whitelist gate. When the whitelist is disabled, or the caller is an
 * admin / whitelisted user / whitelisted IP, resolves; otherwise throws FORBIDDEN. */
export async function assertWhitelisted(ctx: TrpcContext): Promise<void> {
  const { enabled } = await getWhitelistSettingsCached();
  if (!enabled) return;
  if (ctx.user?.role === "admin") return; // admins always bypass

  const userId = ctx.user?.id;
  if (userId != null && (await db.isWhitelisted("user", String(userId)))) return;
  // Only do IP whitelist lookup for real IP addresses; "unknown" can never be a valid whitelist entry.
  // Normalize IPv4-mapped IPv6 (::ffff:1.2.3.4 → 1.2.3.4) so stored IPv4 entries match dual-stack clients.
  const VALID_IP = /^[0-9a-fA-F.:]+$/;
  const rawIp = ctx.clientIp;
  const clientIp = rawIp?.replace(/^::ffff:/i, "") ?? rawIp;
  if (clientIp && clientIp !== "unknown" && VALID_IP.test(clientIp) && (await db.isWhitelisted("ip", clientIp))) return;

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "您没有使用此功能的权限，请联系管理员加入白名单",
  });
}

/** ComfyUI-specific gate. ComfyUI is the user's own self-hosted server (no cloud
 * quota cost), so admins can exempt it from the whitelist independently. When the
 * bypass is on, ComfyUI is freely usable; otherwise it falls back to the standard
 * whitelist check — so when bypass is off this is byte-for-byte equivalent to the
 * previous assertWhitelisted gate. */
export async function assertComfyuiAllowed(ctx: TrpcContext): Promise<void> {
  const { comfyuiBypass } = await getWhitelistSettingsCached();
  if (comfyuiBypass) return;
  await assertWhitelisted(ctx);
}
