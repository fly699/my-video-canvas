import { TRPCError } from "@trpc/server";
import * as db from "../db";
import type { TrpcContext } from "./context";

interface WhitelistSettingsCache {
  enabled: boolean;
  comfyuiBypass: boolean;
  llmBypass: boolean;
  kieEnabled: boolean;
}

let _cachedSettings: WhitelistSettingsCache | null = null;
let _cacheExpiry = 0;
// Incremented on every invalidation so in-flight DB reads don't overwrite with stale data.
let _cacheGeneration = 0;

const DISABLED: WhitelistSettingsCache = { enabled: false, comfyuiBypass: false, llmBypass: false, kieEnabled: false };

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
      llmBypass: settings?.llmBypass ?? false,
      kieEnabled: settings?.kieEnabled ?? false,
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
      llmBypass: fresh?.llmBypass ?? false,
      kieEnabled: fresh?.kieEnabled ?? false,
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

/** 只有「超级管理员」(adminLevel>=4) 不受 AI 资源使用门控（白名单 / kie 公用额度 /
 *  ComfyUI 云）限制，可无限使用。L1 查看员 / L2 运营 / L3 管理员与普通用户一样受门控
 *  （需在白名单内或对应开关开启）——管理后台权限 ≠ AI 资源使用额度。 */
function isUsageUnrestricted(ctx: TrpcContext): boolean {
  return (ctx.user?.adminLevel ?? 0) >= 4;
}

/** Shared whitelist gate. When the whitelist is disabled, or the caller is a
 * super-admin / whitelisted user / whitelisted IP, resolves; otherwise throws FORBIDDEN. */
export async function assertWhitelisted(ctx: TrpcContext): Promise<void> {
  const { enabled } = await getWhitelistSettingsCached();
  if (!enabled) return;
  if (isUsageUnrestricted(ctx)) return; // 仅超级管理员(L4)无条件放行

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

/** LLM-specific gate. Text/vision LLM features are cheap relative to image/video
 * generation, so admins can open them independently while keeping paid media
 * generation whitelist-gated. When the bypass is on, LLM procedures are freely
 * usable; otherwise this falls back to the standard whitelist check — so when
 * the bypass is off it is byte-for-byte equivalent to the previous gate. */
export async function assertLLMAllowed(ctx: TrpcContext): Promise<void> {
  const { llmBypass } = await getWhitelistSettingsCached();
  if (llmBypass) return;
  await assertWhitelisted(ctx);
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

/** Whether the caller may use the shared "house" kie.ai key (KIE_API_KEY env).
 * Admins always may. Otherwise the whitelist kie switch (kieEnabled) must be on
 * AND the caller must pass the standard whitelist (when the global whitelist is
 * off, assertWhitelisted resolves for everyone, so kieEnabled alone gates it). */
export async function assertKieHouseAllowed(ctx: TrpcContext): Promise<void> {
  if (isUsageUnrestricted(ctx)) return; // 仅超级管理员(L4)无条件放行
  const { kieEnabled } = await getWhitelistSettingsCached();
  if (!kieEnabled) {
    throw new TRPCError({ code: "FORBIDDEN", message: "kie.ai 公用额度未开放，请联系管理员分配专属 key 或开启白名单 kie 开关" });
  }
  await assertWhitelisted(ctx);
}

/** Whether the caller may use the official ComfyUI cloud (cloud.comfy.org).
 * Cloud runs on a paid/shared quota, so unlike local self-hosted ComfyUI it is
 * ALWAYS restricted to admins and explicitly whitelisted users — regardless of
 * the global whitelist toggle or the comfyui bypass (those govern local use). */
export async function isComfyuiCloudAllowed(ctx: TrpcContext): Promise<boolean> {
  if (isUsageUnrestricted(ctx)) return true; // 仅超级管理员(L4)无条件放行
  const userId = ctx.user?.id;
  if (userId != null && (await db.isWhitelisted("user", String(userId)))) return true;
  return false;
}

/** Gate for cloud ComfyUI execution — throws FORBIDDEN when not allowed. */
export async function assertComfyuiCloudAllowed(ctx: TrpcContext): Promise<void> {
  if (await isComfyuiCloudAllowed(ctx)) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "ComfyUI 云服务仅向管理员和白名单用户开放，请联系管理员加入白名单",
  });
}
