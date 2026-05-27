/**
 * Browser-side IndexedDB media cache.
 * Stores Blobs keyed by their online URL so nodes can play/display files
 * locally without hitting the network.
 * All errors are caught silently — callers fall back to normal network URLs.
 */

const DB_NAME = "ai-canvas-media-cache";
const DB_VERSION = 1;
const STORE_NAME = "blobs";

export interface CachedMediaEntry {
  url: string;
  blob: Blob;
  mediaType: "image" | "video" | "audio";
  size: number;
  downloadedAt: number;
}

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "url" });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error);
    };
  });
  return _dbPromise;
}

/** Returns the URL to use when fetching `url` for caching purposes.
 *  Same-origin paths (e.g. /manus-storage/…) are used directly.
 *  External HTTPS URLs are routed through the existing server proxies. */
function fetchUrl(url: string, mediaType: "image" | "video" | "audio"): string {
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (mediaType === "image") return `/api/image-proxy?url=${encodeURIComponent(url)}`;
  return `/api/video-proxy?url=${encodeURIComponent(url)}`;
}

/**
 * Download `url` and store its Blob in IndexedDB.
 * `onProgress(loaded, total)` — total may be 0 if Content-Length is absent.
 */
export async function cacheMedia(
  url: string,
  mediaType: CachedMediaEntry["mediaType"],
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const res = await fetch(fetchUrl(url, mediaType));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) throw new Error("响应体为空");

  const total = parseInt(res.headers.get("content-length") ?? "0", 10) || 0;
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total);
    }
  } finally {
    reader.releaseLock();
  }

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const blob = new Blob(chunks, { type: contentType });

  const entry: CachedMediaEntry = {
    url,
    blob,
    mediaType,
    size: blob.size,
    downloadedAt: Date.now(),
  };

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Read a cached entry by its original URL. Returns null if not found. */
export async function getCachedMedia(url: string): Promise<CachedMediaEntry | null> {
  try {
    const db = await openDb();
    return await new Promise<CachedMediaEntry | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(url);
      req.onsuccess = () => resolve((req.result as CachedMediaEntry | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Quick existence check without loading the Blob data. */
export async function hasCachedMedia(url: string): Promise<boolean> {
  try {
    const db = await openDb();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getKey(url);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/** Remove a single cached entry. */
export async function deleteCachedMedia(url: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).delete(url);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // silent
  }
}
