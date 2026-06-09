import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./context";
import { ENV } from "./env";
import * as db from "../db";
import { decryptKieKey } from "./kieCrypto";
import { assertKieHouseAllowed } from "./whitelist";

export const KIE_BASE_URL = "https://api.kie.ai";

/** GET /api/v1/chat/credit → remaining credits (integer) or null on failure. */
export async function fetchKieCredit(apiKey: string): Promise<number | null> {
  let res: Response;
  try {
    res = await fetch(`${KIE_BASE_URL}/api/v1/chat/credit`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch { return null; }
  if (!res.ok) return null;
  let body: { code?: number; data?: unknown };
  try { body = (await res.json()) as { code?: number; data?: unknown }; } catch { return null; }
  if (body.code !== undefined && body.code !== 200) return null;
  return typeof body.data === "number" ? body.data : null;
}

export type KieKeySource = "temp" | "assigned" | "house";
export interface ResolvedKieKey { key: string; source: KieKeySource; label: string }

/**
 * Resolve the effective kie key for the caller, by priority:
 *   1. tempKey (a key the user typed in the toolbar popup) — always allowed (own key)
 *   2. an admin-assigned key whose binding AND key are both enabled (decrypted)
 *   3. the shared house key (KIE_API_KEY) — only if assertKieHouseAllowed passes
 * Throws FORBIDDEN/INTERNAL when no usable key is available.
 */
export async function resolveKieKey(ctx: TrpcContext, tempKey?: string | null): Promise<ResolvedKieKey> {
  const t = tempKey?.trim();
  if (t) return { key: t, source: "temp", label: "临时" };

  const userId = ctx.user?.id;
  if (userId != null) {
    const assigned = await db.getEffectiveKieKeyForUser(userId);
    if (assigned) {
      let plain: string;
      try { plain = decryptKieKey(assigned.encryptedKey); }
      catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "分配的 kie 密钥解密失败（KIE_KEY_SECRET 可能已变更）" }); }
      return { key: plain, source: "assigned", label: `分配·${assigned.name}` };
    }
  }

  // House key — gated by the whitelist kie switch (admins always pass).
  await assertKieHouseAllowed(ctx);
  if (!ENV.kieApiKey) throw new TRPCError({ code: "FORBIDDEN", message: "kie.ai 公用 key 未配置（KIE_API_KEY）" });
  return { key: ENV.kieApiKey, source: "house", label: "公用" };
}

/** Non-throwing variant for balance display — returns null when no key is usable. */
export async function resolveKieKeyOrNull(ctx: TrpcContext, tempKey?: string | null): Promise<ResolvedKieKey | null> {
  try { return await resolveKieKey(ctx, tempKey); } catch { return null; }
}
