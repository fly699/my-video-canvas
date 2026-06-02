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
import { Readable, Transform } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { storagePutStream, storageBackend } from "../storage";
import { isVideoPersistenceEnabled } from "./storageConfig";

// Streaming multipart upload only buffers one part at a time, so memory is no
// longer the constraint — the cap now just guards against a runaway/huge
// upstream filling storage. 5 GB mirrors the chat attachment ceiling.
const MAX_PERSIST_VIDEO_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const PERSIST_FETCH_TIMEOUT_MS = 180_000; // 3 min — large videos can be slow

// Wrap a stream so it errors out past `maxBytes` (handles upstreams that omit
// Content-Length). lib-storage aborts the in-progress multipart on stream error.
export function capStream(src: Readable, maxBytes: number): Readable {
  let seen = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > maxBytes) { cb(new Error(`stream exceeded ${maxBytes} bytes`)); return; }
      cb(null, chunk);
    },
  });
  src.on("error", (e) => counter.destroy(e));
  return src.pipe(counter);
}

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
  // Streaming multipart is S3/MinIO-only. Per product decision we do NOT
  // re-host videos to the Forge backend — fall back to the upstream URL there.
  if (storageBackend() !== "s3") {
    console.warn(`[persistVideo] non-S3 backend for ${provider}; not persisting (MinIO-only), keeping upstream URL`);
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
    const mime = res.headers.get("content-type") ?? "video/mp4";
    const ext = mime.includes("webm") ? "webm" : mime.includes("quicktime") ? "mov" : "mp4";
    // Stream upstream → S3 multipart: only ~one part is buffered at a time, so
    // multi-GB videos persist without OOM. capStream enforces the size ceiling
    // for upstreams that omit Content-Length.
    const src = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
    const { url } = await storagePutStream(
      `generated-videos/${provider}-${Date.now()}.${ext}`,
      capStream(src, MAX_PERSIST_VIDEO_BYTES),
      mime,
    );
    return url;
  } catch (err) {
    // Log only the error message, never the upstream URL — Poyo/Higgsfield
    // CDN URLs may carry signed query tokens that should not leak to logs.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[persistVideo] persist failed for ${provider}, keeping upstream URL: ${msg.slice(0, 200)}`);
    return upstreamUrl;
  }
}
