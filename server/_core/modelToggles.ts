/**
 * In-memory 30s cache of the admin-managed disabled-model set (model value/id
 * strings hidden from the node model pickers). Read on every `config.modelToggles`
 * query; cached to avoid a DB round-trip per page load. Invalidated immediately
 * when the admin mutation runs via `invalidateModelTogglesCache()`.
 *
 * Display-only gate (no billing/security implication), so on DB error we fall
 * back to "nothing disabled" — never accidentally hide every model.
 */
import * as db from "../db";

let _cached: string[] | null = null;
let _expiresAt = 0;
let _inflight: Promise<string[]> | null = null;
const TTL_MS = 30_000;

export function invalidateModelTogglesCache(): void {
  _cached = null;
  _expiresAt = 0;
}

export async function getCachedDisabledModels(): Promise<string[]> {
  const now = Date.now();
  if (_cached && now < _expiresAt) return _cached;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const ids = await db.getDisabledModels();
      _cached = ids;
      _expiresAt = Date.now() + TTL_MS;
      return ids;
    } catch (err) {
      console.warn("[modelToggles] DB read failed:", err);
      return _cached ?? [];
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}
