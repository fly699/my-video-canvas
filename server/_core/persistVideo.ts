/**
 * Shared helper for persisting upstream provider video URLs (Poyo / Higgsfield)
 * to our own Manus S3 so the URL doesn't die after the upstream CDN's 24h TTL.
 *
 * Used by BOTH:
 * - `server/videoTaskPoller.ts` background poller (runs every 10s server-side)
 * - `server/routers/canvas.ts` `videoTasks.poll` client-driven poll
 *
 * Either path can race the other to a "finished" upstream status, so both
 * must persist or we get a 50/50 chance of saving the upstream URL straight
 * through (silently bypassing the admin toggle and the 24h-fix).
 *
 * Failure mode: returns the upstream URL on any failure so users can at
 * least view within the 24h window. Logs but never blocks the task from
 * being marked succeeded.
 */
import { storagePut } from "../storage";
import { isVideoPersistenceEnabled } from "./storageConfig";

const MAX_PERSIST_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB hard cap
const PERSIST_FETCH_TIMEOUT_MS = 180_000; // 3 min — large videos can be slow

// In-flight dedupe: client-driven videoTasks.poll and the server-side
// background videoTaskPoller can both observe upstream "finished" within
// the same second. Without coalescing they'd each fetch ~100 MB and
// storagePut to different S3 keys, leaving an orphan and racing on which
// URL ends up in DB. Key by upstream URL since that's the unique resource.
const _inflight = new Map<string, Promise<string>>();

/** Batch variant — preserves order and de-dupes upstream URLs. Used by
 * multi-shot providers (Wan 2.6 `multi_shots: true`) that return multiple
 * video files for a single task. Each URL gets its own persistence attempt
 * (or fallback to upstream) and the resulting array is the same length as
 * the input, minus duplicates. */
export async function persistVideosOrFallback(upstreamUrls: string[], provider: string): Promise<string[]> {
  const unique: string[] = [];
  for (const u of upstreamUrls) {
    if (typeof u === "string" && u && !unique.includes(u)) unique.push(u);
  }
  // Run in parallel — _inflight dedupe inside persistVideoOrFallback already
  // coalesces concurrent calls for the same URL.
  return Promise.all(unique.map((u) => persistVideoOrFallback(u, provider)));
}

export async function persistVideoOrFallback(upstreamUrl: string, provider: string): Promise<string> {
  // Dedupe BEFORE any await so two concurrent callers can't both pass the
  // toggle check and both start the 100 MB download. Toggle check goes
  // inside the IIFE so it's part of the shared inflight Promise.
  const existing = _inflight.get(upstreamUrl);
  if (existing) return existing;
  const p = (async () => {
    if (!(await isVideoPersistenceEnabled())) {
      return upstreamUrl;
    }
    return persistImpl(upstreamUrl, provider);
  })().finally(() => {
    _inflight.delete(upstreamUrl);
  });
  _inflight.set(upstreamUrl, p);
  return p;
}

async function persistImpl(upstreamUrl: string, provider: string): Promise<string> {
  try {
    const res = await fetch(upstreamUrl, { signal: AbortSignal.timeout(PERSIST_FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[persistVideo] fetch ${res.status} for ${provider}, falling back to upstream URL`);
      return upstreamUrl;
    }
    const declared = res.headers.get("content-length");
    if (declared) {
      const n = parseInt(declared, 10);
      if (!isNaN(n) && n > MAX_PERSIST_VIDEO_BYTES) {
        console.warn(`[persistVideo] video too large (${n} bytes) for ${provider}, keeping upstream URL`);
        return upstreamUrl;
      }
    }
    if (!res.body) return upstreamUrl;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let completed = false;
    let overflowed = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { completed = true; break; }
        total += value.byteLength;
        if (total > MAX_PERSIST_VIDEO_BYTES) {
          overflowed = true;
          console.warn(`[persistVideo] video stream exceeded ${MAX_PERSIST_VIDEO_BYTES} bytes for ${provider}, keeping upstream URL`);
          break;
        }
        chunks.push(value);
      }
    } finally {
      // Cancel on any non-completion exit (byte-cap, network error mid-stream)
      // so the underlying HTTP/TCP socket is released to the connection pool;
      // without this, bursty concurrent persistence can starve the pool.
      if (!completed) {
        try { await reader.cancel(); } catch { /* ignore */ }
      }
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
    if (overflowed) return upstreamUrl;
    // Buffer.concat accepts Uint8Array[] directly — no need for an extra
    // chunks.map(Buffer.from) pass (was doubling peak memory ~2x).
    const buf = Buffer.concat(chunks, total);
    const mime = res.headers.get("content-type") ?? "video/mp4";
    const ext = mime.includes("webm") ? "webm" : mime.includes("quicktime") ? "mov" : "mp4";
    const { url } = await storagePut(`generated-videos/${provider}-${Date.now()}.${ext}`, buf, mime);
    return url;
  } catch (err) {
    // Log only the error message, never the upstream URL — Poyo/Higgsfield
    // CDN URLs may carry signed query tokens that should not leak to logs.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[persistVideo] persist failed for ${provider}, keeping upstream URL: ${msg.slice(0, 200)}`);
    return upstreamUrl;
  }
}
