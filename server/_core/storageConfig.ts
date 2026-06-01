/**
 * In-memory 30s cache of the admin-controlled storage persistence toggles
 * (`persistAudio`, `persistVideo`, `persistImage`).
 *
 * Why cache: every generated audio/video/image clip would otherwise add a DB
 * query in the hot path. 30s staleness is acceptable — admin actions to flip
 * a switch propagate within at most 30s, which is fine for a billing-cost
 * toggle (no security implication).
 *
 * Invalidated immediately when the admin mutation runs via
 * `invalidateStorageSettingsCache()`.
 */
import * as db from "../db";
import { isS3Configured } from "../storage";

type Cached = { persistAudio: boolean; persistVideo: boolean; persistImage: boolean; presignTtlSec: number; poyoUploadFallback: boolean; minioOnly: boolean; preferUpstreamRefSource: boolean };

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
      return { persistAudio: false, persistVideo: false, persistImage: false, presignTtlSec: 3600, poyoUploadFallback: false, minioOnly: false, preferUpstreamRefSource: false };
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

// Self-hosted S3/MinIO has no quota concern (local disk), so when it's
// configured we ALWAYS persist generated media to it — prioritising MinIO over
// upstream provider URLs (which expire). The admin toggle only gates the
// limited-quota Forge backend.
export async function isAudioPersistenceEnabled(): Promise<boolean> {
  if (isS3Configured()) return true;
  return (await getCachedStorageSettings()).persistAudio;
}

export async function isVideoPersistenceEnabled(): Promise<boolean> {
  if (isS3Configured()) return true;
  return (await getCachedStorageSettings()).persistVideo;
}

export async function isImagePersistenceEnabled(): Promise<boolean> {
  if (isS3Configured()) return true;
  return (await getCachedStorageSettings()).persistImage;
}

/**
 * Whether the admin enabled "Poyo stream-upload fallback": when our own
 * storage isn't publicly reachable, stage reference media on Poyo to obtain a
 * public URL for AI models. Purely additive — off by default, and when off the
 * original storage resolution logic is unchanged.
 */
export async function isPoyoUploadFallbackEnabled(): Promise<boolean> {
  return (await getCachedStorageSettings()).poyoUploadFallback;
}

/** Whether the admin restricted object storage to MinIO/S3 only (no Forge fallback). */
export async function isMinioOnlyEnabled(): Promise<boolean> {
  return (await getCachedStorageSettings()).minioOnly;
}

/**
 * Admin-configured presigned GET URL validity (seconds), clamped to a sane
 * range. Used by self-hosted S3/MinIO presigning. Falls back to 1h.
 */
export async function getPresignTtlSec(): Promise<number> {
  const ttl = (await getCachedStorageSettings()).presignTtlSec;
  if (!Number.isFinite(ttl)) return 3600;
  return Math.min(Math.max(Math.trunc(ttl), 60), 604_800); // 1 min … 7 days
}
