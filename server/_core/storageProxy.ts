import type { Express } from "express";
import {
  isStorageConfigured,
  storagePresignGet,
  storageFetchStream,
  storageUploadStream,
  canBrowserReachStorageDirectly,
} from "../storage";
import { verifyUploadToken } from "./uploadToken";
import { authorizeDownload } from "./downloadAuth";
import { isRequestAuthenticated, resolveRequestUser } from "./context";
import { isForceStorageRelayEnabled, isDownloadWatermarkEnabled } from "./storageConfig";
import { serveWatermarkedDownload, watermarkKindFromName, extFromName, buildDownloadWatermarkLabel } from "./downloadWatermark";

/**
 * Streamed upload counterpart to the download proxy. The browser PUTs the raw
 * file here (same origin — always reachable), and we stream it to S3/MinIO. Auth
 * is a short-lived HMAC token (from chat.createUploadUrl) carrying the exact key
 * + size cap, so no internet-reachable S3_PUBLIC_ENDPOINT is required.
 *
 * MUST be registered BEFORE express.json so the body stream isn't consumed.
 */
export function registerStorageUploadProxy(app: Express) {
  app.put("/manus-storage-upload", (req, res) => {
    void (async () => {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const p = verifyUploadToken(token);
      if (!p) { res.status(403).json({ error: "无效或过期的上传凭证" }); return; }
      const len = Number(req.headers["content-length"] || 0);
      if (!Number.isFinite(len) || len <= 0) { res.status(411).json({ error: "缺少 Content-Length" }); return; }
      if (len > p.maxBytes) { res.status(413).json({ error: "文件超过上限" }); return; }
      try {
        const { url } = await storageUploadStream(p.key, p.contentType, req, len);
        res.json({ ok: true, url });
      } catch (err) {
        console.error("[StorageUpload] failed:", err);
        if (!res.headersSent) res.status(502).json({ error: "上传到存储失败" });
      }
    })();
  });
}

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    if (!isStorageConfigured()) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    // Require a logged-in session to read storage objects (matches the image/video
    // proxies). Previously the plain "view" path was completely ungated, so anyone
    // with a storageKey could read any private file anonymously AND the one-time
    // download-authorization could be bypassed by simply omitting ?download.
    if (!await isRequestAuthenticated(req)) {
      res.status(401).send("Unauthorized");
      return;
    }

    // Strict download authorization (when enabled): a ?download=1 request for an
    // original file must be backed by a consumable grant (non-admins). Plain
    // viewing (no download flag) is never gated.
    if (req.query.download !== undefined) {
      const ok = await authorizeDownload(req, res, { paramKey: key });
      if (!ok) return; // 403/401 already sent
    }

    // Anti-leech: burn the downloader's identity into image/video downloads when
    // the admin enabled it. Best-effort — on no-font/fetch failure we fall through
    // to normal serving, and ffmpeg errors still serve the original (never breaks).
    if (req.query.download !== undefined && await isDownloadWatermarkEnabled()) {
      const kind = watermarkKindFromName(key);
      if (kind) {
        const user = await resolveRequestUser(req);
        const name = key.split("/").pop() || "file";
        const served = await serveWatermarkedDownload(res, {
          sourceUrl: `/manus-storage/${key}`,
          kind,
          srcExt: extFromName(key, kind),
          downloadName: name,
          label: buildDownloadWatermarkLabel(user),
        });
        if (served) return;
      }
    }

    try {
      // When the storage host is publicly reachable (Forge, or S3/MinIO behind a
      // public endpoint), 307-redirect the browser straight to the signed URL —
      // cheapest path, no app-server bandwidth. Unless the admin enabled
      // "force relay" (anti-leech): then we always stream through below so the raw
      // presigned URL is never exposed in the browser's network panel.
      if (canBrowserReachStorageDirectly() && !(await isForceStorageRelayEnabled())) {
        const url = await storagePresignGet(key);
        if (!url) {
          res.status(502).send("Empty signed URL from backend");
          return;
        }
        res.set("Cache-Control", "no-store");
        res.redirect(307, url);
        return;
      }

      // Otherwise (typical MinIO on 127.0.0.1) the client cannot reach the
      // storage host — stream the object THROUGH this server instead. Forward the
      // browser's Range header so <video> seeking/scrubbing works (206 Partial
      // Content) instead of re-pulling the whole file from the start.
      const range = typeof req.headers.range === "string" ? req.headers.range : undefined;
      const { body, contentType, contentLength, contentRange, status, acceptRanges } = await storageFetchStream(key, range);
      if (contentType) res.set("Content-Type", contentType);
      if (acceptRanges) res.set("Accept-Ranges", "bytes");
      if (contentRange) res.set("Content-Range", contentRange);
      if (typeof contentLength === "number") res.set("Content-Length", String(contentLength));
      res.set("Cache-Control", "private, max-age=300");
      // Never let the browser MIME-sniff a stored object into an executable type
      // (image/video proxies already do this). Without it, an attachment uploaded
      // with mimeType "text/html"/"image/svg+xml" would render as same-origin HTML
      // → stored XSS for any authenticated viewer opening /manus-storage/<key>.
      res.set("X-Content-Type-Options", "nosniff");
      // Force a download for anything that isn't a safe inline media type, so a
      // stored HTML/SVG/etc. can never execute in this origin even with nosniff.
      const inlineOk = /^(image\/(?!svg)|video\/|audio\/|application\/pdf)/i.test(contentType ?? "");
      if (req.query.download !== undefined || !inlineOk) {
        const name = key.split("/").pop() || "file";
        res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
      }
      res.status(status === 206 ? 206 : 200);
      body.on("error", (err) => {
        console.error("[StorageProxy] stream error:", err);
        if (!res.headersSent) res.status(502).end();
        else res.destroy();
      });
      // If the client disconnects mid-download, tear down the upstream (MinIO)
      // stream too — otherwise its socket/handle leaks until GC.
      res.on("close", () => { body.destroy(); });
      body.pipe(res);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      if (!res.headersSent) res.status(502).send("Storage proxy error");
    }
  });
}
