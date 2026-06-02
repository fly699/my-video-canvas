// True when a media URL points at our own durable object storage (MinIO/S3),
// served via the `/manus-storage/` proxy path. Such URLs are long-lived and
// won't expire — unlike upstream provider URLs (Poyo / Higgsfield CDN signed
// links), which are short-lived (~24–72h). Used to drive the "已存储到 MinIO"
// indicator on media nodes. Detection is URL-shape only — no network request.
export function isOwnStorageUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url.startsWith("/manus-storage/")) return true;
  try {
    const u = new URL(url, window.location.origin);
    return u.pathname.startsWith("/manus-storage/");
  } catch {
    return false;
  }
}
