import type { Express } from "express";
import { isStorageConfigured, storagePresignGet } from "../storage";

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
      // Backend-aware presigned GET (S3/MinIO or Forge), then 307 redirect.
      const url = await storagePresignGet(key);
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
