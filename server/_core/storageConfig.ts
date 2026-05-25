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
let _inflight: Promise<Cached> | null = null; // dedupe concurrent misses
const TTL_MS = 30_000;

export function invalidateStorageSettingsCache(): void {
  _cached = null;
  _expiresAt = 0;
}

export async function getCachedStorageSettings(): Promise<Cached> {
  const now = Date.now();
  if (_cached && now < _expiresAt) return _cached;
  // Coalesce concurrent misses into one DB read — prevents thundering herd
  // when many videos finish at the same moment.
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const settings = await db.getStorageSettings();
      _cached = settings;
      _expiresAt = Date.now() + TTL_MS;
      return settings;
    } catch (err) {
      console.warn("[storageConfig] DB read failed:", err);
      // Stale-while-error: prefer last-known value over flipping the admin
      // toggle silently. Only when there's no prior cached value at all do
      // we fall back — and we choose **fail-closed** (persistence off) so
      // that DB outages can't silently bypass the admin's explicit "off"
      // intent and burn S3 quota.
      if (_cached) return _cached;
      return { persistAudio: false, persistVideo: false };
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export async function isAudioPersistenceEnabled(): Promise<boolean> {
  return (await getCachedStorageSettings()).persistAudio;
}

export async function isVideoPersistenceEnabled(): Promise<boolean> {
  return (await getCachedStorageSettings()).persistVideo;
}
