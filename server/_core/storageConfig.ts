/**
 * In-memory 30s cache of the admin-controlled storage persistence toggles
 * (`persistAudio`, `persistVideo`).
 *
 * Why cache: every generated audio/video clip would otherwise add a DB query
 * in the hot path. 30s staleness is acceptable — admin actions to flip a
 * switch propagate within at most 30s, which is fine for a billing-cost
 * toggle (no security implication).
 *
 * Invalidated immediately when the admin mutation runs via
 * `invalidateStorageSettingsCache()`.
 */
import * as db from "../db";

type Cached = { persistAudio: boolean; persistVideo: boolean };

let _cached: Cached | null = null;
let _expiresAt = 0;
const TTL_MS = 30_000;

export function invalidateStorageSettingsCache(): void {
  _cached = null;
  _expiresAt = 0;
}

export async function getCachedStorageSettings(): Promise<Cached> {
  const now = Date.now();
  if (_cached && now < _expiresAt) return _cached;
  try {
    const settings = await db.getStorageSettings();
    _cached = settings;
    _expiresAt = Date.now() + TTL_MS;
    return settings;
  } catch (err) {
    console.warn("[storageConfig] DB read failed, defaulting to persistence ON:", err);
    // Fail-open: persist by default if DB is briefly unavailable.
    // This matches the row's default and matches pre-feature behaviour.
    return { persistAudio: true, persistVideo: true };
  }
}

export async function isAudioPersistenceEnabled(): Promise<boolean> {
  return (await getCachedStorageSettings()).persistAudio;
}

export async function isVideoPersistenceEnabled(): Promise<boolean> {
  return (await getCachedStorageSettings()).persistVideo;
}
