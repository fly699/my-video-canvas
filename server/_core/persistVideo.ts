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

export async function persistVideoOrFallback(upstreamUrl: string, provider: string): Promise<string> {
  // Admin-controlled toggle: when video persistence is disabled, skip the
  // download entirely and return the upstream URL straight through.
  if (!(await isVideoPersistenceEnabled())) {
    return upstreamUrl;
  }
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
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_PERSIST_VIDEO_BYTES) {
          await reader.cancel();
          console.warn(`[persistVideo] video stream exceeded ${MAX_PERSIST_VIDEO_BYTES} bytes for ${provider}, keeping upstream URL`);
          return upstreamUrl;
        }
        chunks.push(value);
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
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
