// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.

import { ENV } from "./_core/env";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ── Storage backend selection ───────────────────────────────────────────────
// Self-hosted S3-compatible (MinIO / R2 / AWS) takes precedence over Forge when
// configured. This keeps file data entirely on your own infrastructure.
export function isS3Configured(): boolean {
  return Boolean(ENV.s3Endpoint && ENV.s3Bucket && ENV.s3AccessKey && ENV.s3SecretKey);
}

export function storageBackend(): "s3" | "forge" | "none" {
  if (isS3Configured()) return "s3";
  if (ENV.forgeApiUrl && ENV.forgeApiKey) return "forge";
  return "none";
}

/** Whether persistent storage (S3/MinIO or Forge) is configured for this deployment. */
export function isStorageConfigured(): boolean {
  return storageBackend() !== "none";
}

let _s3: S3Client | null = null;
function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      endpoint: ENV.s3Endpoint,
      region: ENV.s3Region,
      forcePathStyle: ENV.s3ForcePathStyle, // required by MinIO
      credentials: { accessKeyId: ENV.s3AccessKey, secretAccessKey: ENV.s3SecretKey },
    });
  }
  return _s3;
}

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY",
    );
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  if (storageBackend() === "s3") {
    const key = appendHashSuffix(normalizeKey(relKey));
    const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data as Uint8Array);
    await getS3().send(new PutObjectCommand({ Bucket: ENV.s3Bucket, Key: key, Body: body, ContentType: contentType }));
    return { key, url: `/manus-storage/${key}` };
  }
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = appendHashSuffix(normalizeKey(relKey));

  // 1. Get presigned PUT URL from Forge
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);

  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }

  const { url: s3Url } = (await presignResp.json()) as { url: string };
  if (!s3Url) throw new Error("Forge returned empty presign URL");

  // 2. PUT file directly to S3
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });

  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
    signal: AbortSignal.timeout(60_000),
  });

  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }

  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

/** Presigned GET URL for serving a stored object, branching on the active backend. */
export async function storagePresignGet(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);
  if (storageBackend() === "s3") {
    return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: ENV.s3Bucket, Key: key }), { expiresIn: 3600 });
  }
  const { forgeUrl, forgeKey } = getForgeConfig();
  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);
  const resp = await fetch(getUrl, { headers: { Authorization: `Bearer ${forgeKey}` }, signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage presign GET failed (${resp.status}): ${msg.slice(0, 200)}`);
  }
  const { url } = (await resp.json()) as { url: string };
  if (!url) throw new Error("Empty signed GET URL");
  return url;
}

/**
 * Issue a presigned PUT URL so the BROWSER can upload a (potentially huge) file
 * directly to S3 — bypassing this server's request-body limit and avoiding
 * base64 memory bloat. Returns the upload URL plus the final hashed key and the
 * internal `/manus-storage/{key}` path used to serve it afterwards.
 */
export async function storagePresignPut(
  relKey: string,
  contentType = "application/octet-stream",
): Promise<{ uploadUrl: string; key: string; url: string }> {
  if (storageBackend() === "s3") {
    const key = appendHashSuffix(normalizeKey(relKey));
    const uploadUrl = await getSignedUrl(
      getS3(),
      new PutObjectCommand({ Bucket: ENV.s3Bucket, Key: key, ContentType: contentType }),
      { expiresIn: 3600 },
    );
    return { uploadUrl, key, url: `/manus-storage/${key}` };
  }
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = appendHashSuffix(normalizeKey(relKey));
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);
  const resp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage presign failed (${resp.status}): ${msg}`);
  }
  const { url: uploadUrl } = (await resp.json()) as { url: string };
  if (!uploadUrl) throw new Error("Forge returned empty presign URL");
  return { uploadUrl, key, url: `/manus-storage/${key}` };
}

/**
 * Resolve a media URL (which may be an absolute http(s) URL or our internal
 * `/manus-storage/{key}` proxy path) into an ABSOLUTE URL that external
 * services can fetch. Used when handing a reference image off to upstream
 * APIs (Higgsfield, Poyo, …) that cannot resolve relative paths against
 * our domain — they returned 422 with "Input should be a valid URL,
 * relative URL without a base" when we passed `/manus-storage/...` directly.
 *
 * Absolute http(s) URLs pass through unchanged. Internal paths are resolved
 * to a short-lived S3 presigned URL via the same Forge endpoint the proxy
 * uses; the upstream API has minutes (typical signed-URL TTL) to fetch
 * before it expires.
 */
export async function resolveToAbsoluteUrl(urlOrRelPath: string): Promise<string> {
  if (/^https?:\/\//i.test(urlOrRelPath)) return urlOrRelPath;
  if (!urlOrRelPath.startsWith("/manus-storage/")) {
    throw new Error(`无法解析为绝对 URL：${urlOrRelPath.slice(0, 80)}`);
  }
  const key = urlOrRelPath.slice("/manus-storage/".length);
  return storagePresignGet(key);
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  return storagePresignGet(relKey);
}
