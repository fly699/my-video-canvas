import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { fetchKieCredit, resolveKieKeyOrNull } from "../_core/kie";
import { assertWhitelisted } from "../_core/whitelist";
import { insertKieBalanceSnapshotThrottled, getRecentKieBalanceSnapshots } from "../db";

const tempKeyInput = z.object({ tempKey: z.string().trim().min(1).max(256).optional() }).optional();

export const kieRouter = router({
  // Balance of the caller's *effective* kie key (temp > assigned > house). The
  // toolbar badge polls this; pass a tempKey to check/use a user-entered key.
  balance: protectedProcedure.input(tempKeyInput).query(async ({ ctx, input }) => {
    const resolved = await resolveKieKeyOrNull(ctx, input?.tempKey);
    if (!resolved) {
      return { configured: false, source: null as string | null, label: null as string | null, creditsAmount: null as number | null };
    }
    const creditsAmount = await fetchKieCredit(resolved.key);
    // Snapshot only the shared house key (admin trend); never user/temp keys.
    if (resolved.source === "house" && typeof creditsAmount === "number") {
      try { await insertKieBalanceSnapshotThrottled(creditsAmount); } catch { /* non-fatal */ }
    }
    return { configured: true, source: resolved.source, label: resolved.label, creditsAmount };
  }),

  // Recent HOUSE balance snapshots (newest first) for the admin consumption trend.
  history: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ ctx, input }) => {
      // 公用（house）余额历史属平台敏感信息，非白名单用户返回空（与 kie balance 的 house 门槛一致）。
      try { await assertWhitelisted(ctx); } catch { return [] as { creditsAmount: number; at: string }[]; }
      const rows = await getRecentKieBalanceSnapshots(input?.limit ?? 30);
      return rows.map((r) => ({ creditsAmount: r.creditsAmount, at: r.at.toISOString() }));
    }),
});
