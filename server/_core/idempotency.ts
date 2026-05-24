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
const MAX_TTL_MS = 5 * 60 * 1000; // hard upper bound — long enough for slow Suno/Veo runs

function hashKey(bucket: string, userId: number, keyInput: unknown): string {
  const h = createHash("sha256").update(JSON.stringify(keyInput)).digest("hex");
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
