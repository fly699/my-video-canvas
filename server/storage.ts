// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.

import { ENV } from "./_core/env";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
// NOTE: storageConfig imports isS3Configured from this module; both directions
// are used only inside functions (call-time), so the cycle resolves safely.
import { getPresignTtlSec } from "./_core/storageConfig";

/**
 * Whether end-user browsers can reach the storage host directly. MinIO is
 * typically bound to a server-local address (127.0.0.1:9000) that remote
 * browsers cannot connect to — in that case presigned URLs are useless to the
 * client and we must stream files through the app server instead. Direct access
 * is only assumed when an explicit public endpoint is configured, or when the
 * backend is Forge (whose presigned URLs are already public).
 */
export function canBrowserReachStorageDirectly(): boolean {
  if (storageBackend() === "forge") return true;
  if (storageBackend() === "s3") return Boolean(ENV.s3PublicEndpoint);
  return false;
}

/**
 * Whether an absolute URL targets our OWN configured object storage (MinIO/S3).
 * Self-hosted MinIO commonly lives on a private address (e.g. 172.16.x.x), so a
 * generic SSRF guard that blocks private hosts would otherwise reject our own
 * stored reference images.
 *
 * Matches by HOSTNAME (ignoring port) against S3_ENDPOINT / S3_PUBLIC_ENDPOINT —
 * the storage server is often reached on a different port than the internal SDK
 * endpoint (e.g. MinIO behind a reverse proxy on :80 vs S3_ENDPOINT :9000), and a
 * strict host:port match silently misses that. Still narrow: only the storage
 * host itself is exempt; other internal hosts (cloud metadata, etc.) stay blocked.
 * The storage host is trusted infrastructure the operator configured.
 */
export function isOwnStorageUrl(rawUrl: string): boolean {
  let target: URL;
  try { target = new URL(rawUrl); } catch { return false; }
  const host = target.hostname.toLowerCase();
  if (!host) return false;
  for (const ep of [ENV.s3Endpoint, ENV.s3PublicEndpoint]) {
    if (!ep) continue;
    try { if (new URL(ep).hostname.toLowerCase() === host) return true; } catch { /* ignore malformed env */ }
  }
  return false;
}

/**
 * If a URL points at our own `/manus-storage/` proxy path — whether a relative
 * path (`/manus-storage/{key}`) OR an absolute same-origin URL
 * (`https://app-host:3000/manus-storage/{key}`) — return the internal
 * `/manus-storage/{key}` path; otherwise null.
 *
 * The host is intentionally IGNORED: only the storage key is ever used (resolved
 * against our own MinIO), so a crafted host can never redirect the fetch
 * elsewhere. This is what lets the app fetch its own stored reference images
 * without tripping the SSRF guard (the app server commonly lives on a private
 * address like 172.16.x.x:3000).
 */
export function toInternalStoragePath(rawUrl: string): string | null {
  if (typeof rawUrl !== "string" || !rawUrl) return null;
  if (rawUrl.startsWith("/manus-storage/")) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.pathname.startsWith("/manus-storage/")) return u.pathname;
  } catch { /* not an absolute URL — fall through */ }
  return null;
}

/** Rewrite a presigned URL's origin to the public endpoint, when configured. */
function applyPublicEndpoint(signedUrl: string): string {
  if (!ENV.s3PublicEndpoint) return signedUrl;
  try {
    const pub = new URL(ENV.s3PublicEndpoint);
    const u = new URL(signedUrl);
    u.protocol = pub.protocol;
    u.host = pub.host;
    return u.toString();
  } catch {
    return signedUrl;
  }
}

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

// 路径1 写入守卫（用户上传 / 聊天附件 / 画布上传 / 本地剪辑产物）——这些没有
// 各自的持久化开关。当管理员开启「仅允许 MinIO/S3」且未配置 MinIO/S3 时，
// 拒绝写入，而不是回退到 Forge 存储。
// 注意：AI 生成产物（Poyo/Higgsfield/OpenAI）不走此守卫，由 persistAudio/
// Video/Image 三个开关各自控制。
export async function assertObjectStorageWritable(): Promise<void> {
  if (isS3Configured()) return; // 已配 MinIO/S3，永远写本地存储
  const { isMinioOnlyEnabled } = await import("./_core/storageConfig");
  if (await isMinioOnlyEnabled()) {
    throw new Error("仅允许 MinIO/S3：未配置 MinIO/S3，已拒绝写入（不会落 Forge 存储）。请先配置 S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY。");
  }
}

// ComfyUI 等内网节点产物：永久硬锁 MinIO/S3，无视任何开关。出于内网节点的
// 安全考量，未配置 MinIO/S3 时一律拒绝写入（绝不落 Forge 存储）。
export function assertMinioOnlyWrite(): void {
  if (!isS3Configured()) {
    throw new Error("ComfyUI 产物仅允许存储到 MinIO/S3（内网节点安全策略）：未配置 MinIO/S3，已拒绝写入。请配置 S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY。");
  }
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

/** Produce the final hashed storage key from a relative key (exported for the
 *  app-server upload proxy, which must bind the exact key into its auth token). */
export function finalizeStorageKey(relKey: string): string {
  return appendHashSuffix(normalizeKey(relKey));
}

/**
 * Stream a request body straight to S3/MinIO under an already-finalized key —
 * the upload counterpart to the download proxy. Lets the browser upload large
 * files THROUGH this server when the storage host isn't browser-reachable, so
 * no S3_PUBLIC_ENDPOINT (or base64 body-limit) is needed. S3/MinIO only (Forge
 * is browser-reachable and uses presigned PUT directly).
 */
export async function storageUploadStream(
  finalKey: string,
  contentType: string,
  body: NodeJS.ReadableStream,
  contentLength: number,
): Promise<{ key: string; url: string }> {
  if (storageBackend() !== "s3") throw new Error("upload proxy requires the S3/MinIO backend");
  const key = normalizeKey(finalKey);
  await getS3().send(new PutObjectCommand({
    Bucket: ENV.s3Bucket, Key: key, Body: body as unknown as Buffer, ContentType: contentType, ContentLength: contentLength,
  }));
  return { key, url: `/manus-storage/${key}` };
}

/**
 * Permanently remove an object from S3/MinIO by its (already-final) storage key.
 * Used by the admin "彻底删除/hard delete" path. Only the S3/MinIO backend is
 * supported (production); returns false for other backends so the caller can
 * report that the blob wasn't physically removed. The key is the exact value
 * stored in assets.storageKey (no /manus-storage prefix); a leading slash is
 * tolerated.
 */
export async function storageDeleteObject(key: string): Promise<boolean> {
  if (storageBackend() !== "s3") return false;
  const k = normalizeKey(key);
  if (!k) return false;
  await getS3().send(new DeleteObjectCommand({ Bucket: ENV.s3Bucket, Key: k }));
  return true;
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

/**
 * Stream a (potentially very large) body straight to S3/MinIO via multipart
 * upload — only one part (~8 MB) is held in memory at a time, so the whole file
 * never gets buffered. Used to re-host large upstream videos without risking
 * server OOM. MinIO/S3 ONLY: multipart isn't available on the Forge presign
 * path, so callers must fall back to the upstream URL when not on S3.
 */
export async function storagePutStream(
  relKey: string,
  body: Readable,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  if (storageBackend() !== "s3") {
    throw new Error("storagePutStream requires the S3/MinIO backend");
  }
  const key = appendHashSuffix(normalizeKey(relKey));
  const upload = new Upload({
    client: getS3(),
    params: { Bucket: ENV.s3Bucket, Key: key, Body: body, ContentType: contentType },
    partSize: 8 * 1024 * 1024, // 8 MB parts
    queueSize: 4,              // up to 4 parts in flight → ~32 MB peak memory
  });
  await upload.done();
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
    const expiresIn = await getPresignTtlSec();
    const signed = await getSignedUrl(getS3(), new GetObjectCommand({ Bucket: ENV.s3Bucket, Key: key }), { expiresIn });
    return applyPublicEndpoint(signed);
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
    const signed = await getSignedUrl(
      getS3(),
      new PutObjectCommand({ Bucket: ENV.s3Bucket, Key: key, ContentType: contentType }),
      { expiresIn: 3600 },
    );
    return { uploadUrl: applyPublicEndpoint(signed), key, url: `/manus-storage/${key}` };
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

  // ── Additive Poyo stream-upload fallback (off by default) ──
  // Only when: admin enabled it, our storage is NOT publicly reachable, and a
  // Poyo key exists. Stages the file on Poyo and returns its public URL so AI
  // models can fetch it. Any failure falls through to the original behavior —
  // when the toggle is off this whole block is skipped and logic is unchanged.
  if (!canBrowserReachStorageDirectly() && ENV.poyoApiKey) {
    try {
      const { isPoyoUploadFallbackEnabled } = await import("./_core/storageConfig");
      if (await isPoyoUploadFallbackEnabled()) {
        const { uploadStreamToPoyo } = await import("./_core/poyoUpload");
        const { body, contentType } = await storageFetchStream(key);
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        const buf = Buffer.concat(chunks);
        const ct = contentType ?? "application/octet-stream";
        const ext = key.split(".").pop() || "bin";
        const fileName = `ref-${Date.now()}.${ext}`;
        const poyoUrl = await uploadStreamToPoyo(buf, fileName, ct);
        // 暂存到 Poyo 的每个文件都留 log：控制台 + 审计日志（管理后台「系统日志」可查）。
        console.log(`[storage] Poyo 暂存：key=${key} size=${buf.length}B type=${ct} → ${poyoUrl}`);
        try {
          const { writeAuditLog } = await import("./_core/auditLog");
          writeAuditLog({ action: "poyo_stage", detail: { key, sizeBytes: buf.length, contentType: ct, poyoUrl } });
        } catch { /* 审计失败不影响主流程 */ }
        return poyoUrl;
      }
    } catch (err) {
      console.warn("[storage] Poyo upload fallback failed, using presigned URL:", err instanceof Error ? err.message : err);
      // fall through to the original presign behavior
    }
  }

  return storagePresignGet(key);
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  return storagePresignGet(relKey);
}

/**
 * Fetch a stored object so the app server can stream it back to the browser.
 * Used when the storage host isn't reachable by clients (e.g. MinIO on
 * 127.0.0.1). For S3/MinIO we read the object directly; for Forge we fetch the
 * short-lived presigned URL server-side.
 */
export async function storageFetchStream(
  relKey: string,
  range?: string,
): Promise<{ body: Readable; contentType?: string; contentLength?: number; contentRange?: string; status: number; acceptRanges: boolean }> {
  const key = normalizeKey(relKey);
  // Only forward a well-formed byte range; anything else is treated as a full GET
  // (so a malformed header can't turn into a backend 416 / parse error).
  const safeRange = typeof range === "string" && /^bytes=/.test(range) ? range : undefined;
  if (storageBackend() === "s3") {
    const out = await getS3().send(new GetObjectCommand({ Bucket: ENV.s3Bucket, Key: key, Range: safeRange }));
    return {
      body: out.Body as Readable,
      contentType: out.ContentType,
      contentLength: typeof out.ContentLength === "number" ? out.ContentLength : undefined,
      contentRange: out.ContentRange,
      status: out.ContentRange ? 206 : 200,
      acceptRanges: true, // S3/MinIO always honor byte ranges
    };
  }
  const signed = await storagePresignGet(key);
  const resp = await fetch(signed, { headers: safeRange ? { Range: safeRange } : undefined, signal: AbortSignal.timeout(30_000) });
  if (!resp.ok || !resp.body) { // 200 and 206 are both .ok (200–299)
    throw new Error(`Storage fetch failed (${resp.status})`);
  }
  const { Readable: NodeReadable } = await import("node:stream");
  const lenHeader = resp.headers.get("content-length");
  return {
    body: NodeReadable.fromWeb(resp.body as Parameters<typeof NodeReadable.fromWeb>[0]),
    contentType: resp.headers.get("content-type") ?? undefined,
    contentLength: lenHeader ? Number(lenHeader) : undefined,
    contentRange: resp.headers.get("content-range") ?? undefined,
    status: resp.status,
    acceptRanges: resp.status === 206 || (resp.headers.get("accept-ranges") ?? "").includes("bytes"),
  };
}
