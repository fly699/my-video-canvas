/**
 * Image proxy: forwards external image URLs through the server to avoid CORS issues.
 * Supports download=1 to trigger browser download with Content-Disposition header.
 *
 * Usage: GET /api/image-proxy?url=<encoded-image-url>[&download=1]
 *
 * Security: Only HTTPS URLs are allowed. Private/internal IPs are blocked.
 */
import type { Express } from "express";
import { isRequestAuthenticated } from "./context";

const BLOCKED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254",
  "metadata.google.internal",
];

function isAllowedUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) return false;
    if (/^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export function registerImageProxy(app: Express) {
  app.get("/api/image-proxy", async (req, res) => {
    if (!await isRequestAuthenticated(req)) {
      res.status(401).send("Unauthorized");
      return;
    }

    const rawUrl = req.query.url as string | undefined;
    if (!rawUrl) {
      res.status(400).send("Missing url parameter");
      return;
    }

    let decodedUrl: string;
    try {
      decodedUrl = decodeURIComponent(rawUrl);
    } catch {
      res.status(400).send("Invalid url encoding");
      return;
    }

    if (!isAllowedUrl(decodedUrl)) {
      res.status(403).send("URL not allowed");
      return;
    }

    try {
      const upstream = await fetch(decodedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ImageProxy/1.0)",
          "Accept": "image/*,*/*;q=0.8",
        },
        redirect: "follow",
      });

      const forwardHeaders: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Cache-Control": "public, max-age=3600",
      };

      const contentType = upstream.headers.get("content-type");
      forwardHeaders["Content-Type"] = contentType ?? "image/png";

      const contentLength = upstream.headers.get("content-length");
      if (contentLength) forwardHeaders["Content-Length"] = contentLength;

      // Trigger browser download if download=1
      if (req.query.download === "1") {
        const urlPath = new URL(decodedUrl).pathname;
        const filename = urlPath.split("/").pop() || "image.png";
        forwardHeaders["Content-Disposition"] = `attachment; filename="${filename}"`;
      }

      if (!upstream.ok) {
        res.set(forwardHeaders);
        res.status(upstream.status).send(`Upstream error: ${upstream.status} ${upstream.statusText}`);
        return;
      }

      res.writeHead(upstream.status, forwardHeaders);

      if (!upstream.body) {
        res.end();
        return;
      }

      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        const canContinue = res.write(value);
        if (!canContinue) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
    } catch (err) {
      console.error("[ImageProxy] error:", err);
      if (!res.headersSent) {
        res.set("Access-Control-Allow-Origin", "*");
        res.status(502).send("Image proxy error");
      }
    }
  });
}
