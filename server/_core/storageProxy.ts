import type { Express } from "express";
import {
  isStorageConfigured,
  storagePresignGet,
  storageFetchStream,
  storageUploadStream,
  canBrowserReachStorageDirectly,
} from "../storage";
import { verifyUploadToken } from "./uploadToken";

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

    try {
      // When the storage host is publicly reachable (Forge, or S3/MinIO behind a
      // public endpoint), 307-redirect the browser straight to the signed URL —
      // cheapest path, no app-server bandwidth.
      if (canBrowserReachStorageDirectly()) {
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
      // storage host — stream the object THROUGH this server instead.
      const { body, contentType, contentLength } = await storageFetchStream(key);
      if (contentType) res.set("Content-Type", contentType);
      if (typeof contentLength === "number") res.set("Content-Length", String(contentLength));
      res.set("Cache-Control", "private, max-age=300");
      // Optional ?download=1 forces a save dialog with the original filename.
      if (req.query.download !== undefined) {
        const name = key.split("/").pop() || "file";
        res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
      }
      body.on("error", (err) => {
        console.error("[StorageProxy] stream error:", err);
        if (!res.headersSent) res.status(502).end();
        else res.destroy();
      });
      body.pipe(res);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      if (!res.headersSent) res.status(502).send("Storage proxy error");
    }
  });
}
