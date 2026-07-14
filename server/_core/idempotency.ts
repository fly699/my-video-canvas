import { createHash } from "node:crypto";

/**
 * In-memory request deduplication for paid mutations.
 *
 * Why this exists: the client guards every paid mutation with `mutation.isPending`,
 * but that's bypassed by devtools, scripts, retried network requests, browsers
 * resuming after sleep, and any non-web client. For mutations that incur real
 * cost on every external API call (LLMs, image gen, audio gen, transcription),
 * we need a server-side last line of defence.
 *
 * Design:
 * - Single in-process Map<key, Promise> — single-process deploy assumed; multi-process
 *   would still cut duplicates 1/N.
 * - Cache the *promise* not the result, so a second concurrent request gets the same
 *   in-flight call rather than starting its own. Both callers receive the same result.
 * - Clear the entry the instant the underlying promise settles. This means
 *     - a legitimate "I want to generate again" right after the previous result lands
 *       proceeds normally (no UX penalty),
 *     - but a double-click during the in-flight window collapses into one charge.
 * - Hard TTL of MAX_TTL_MS guards against hung promises orphaning a key forever.
 * - Mutation handler still runs only once on a dedupe hit — audit logging, DB writes,
 *   etc. all happen exactly once.
 */

type Entry = { promise: Promise<unknown>; expiresAt: number };

const cache = new Map<string, Entry>();
// Hard upper bound — must exceed the longest in-flight mutation we run, otherwise
// concurrent duplicate requests after expiry will both start and double-charge.
// ComfyUI video workflows can poll up to ~10 min (POLL_MAX_ATTEMPTS_VIDEO × 3 s);
// 15 min gives slack for slow Suno/Veo runs and network jitter.
const MAX_TTL_MS = 15 * 60 * 1000;

/** Recursively sort object keys so that equivalent inputs hash identically
 * regardless of property insertion order (different code paths construct the
 * same logical request with fields in different orders — without canonical
 * serialization those would dedupe-miss and double-charge). */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonicalize((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

// Top-level request fields that are purely cosmetic / client-computed (display
// labels, logging hints) and MUST NOT participate in the dedupe key. They can
// differ between otherwise-identical requests — e.g. `estimatedCost` ("≈5 cr") is
// recomputed per render and a one-char difference would silently defeat dedup and
// double-charge. Stripped only at the top level (the request root), never deep.
// `jobId` (#163) is a fresh per-call correlation id for socket 回灌 / poll fallback —
// it differs on every run by design, so including it would give each request a unique
// key and silently defeat dedup (double-submit / double-charge on rapid identical runs).
const IGNORED_KEY_FIELDS = new Set(["estimatedCost", "jobId"]);

function hashKey(bucket: string, userId: number, keyInput: unknown): string {
  let k = keyInput;
  if (k && typeof k === "object" && !Array.isArray(k)) {
    k = Object.fromEntries(
      Object.entries(k as Record<string, unknown>).filter(([key]) => !IGNORED_KEY_FIELDS.has(key)),
    );
  }
  const h = createHash("sha256").update(JSON.stringify(canonicalize(k))).digest("hex");
  return `${bucket}:${userId}:${h}`;
}

/**
 * Deduplicate concurrent identical requests for a paid mutation.
 *
 * `bucket` namespaces by mutation (so `imageGen` vs `generateMusic` never collide).
 * `userId` ensures one user's request never satisfies another's.
 * `keyInput` is the canonical request payload — pass the validated input object.
 */
export function dedupe<T>(
  bucket: string,
  userId: number,
  keyInput: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const key = hashKey(bucket, userId, keyInput);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.promise as Promise<T>;
  }
  const promise = fn().finally(() => {
    cache.delete(key);
  });
  cache.set(key, { promise, expiresAt: now + MAX_TTL_MS });
  return promise;
}

// Test/utility — clears the cache. Not exported for production code paths.
export function _resetDedupeCacheForTests(): void {
  cache.clear();
}
