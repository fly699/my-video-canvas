/**
 * Video proxy: forwards external video URLs through the server to avoid CORS
 * and authentication issues when playing videos from poyo.ai or other CDNs.
 *
 * Usage: GET /api/video-proxy?url=<encoded-video-url>
 * Supports range requests for seek/scrub in <video> elements.
 */
import type { Express } from "express";

const ALLOWED_HOSTS = [
  "api.poyo.ai",
  "cdn.poyo.ai",
  "storage.poyo.ai",
  "commondatastorage.googleapis.com",
  "storage.googleapis.com",
  "runwayml.com",
  "p16-capcut-sign-sg.ibyteimg.com",
  "p16-capcut-sign-va.ibyteimg.com",
];

function isAllowedUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function registerVideoProxy(app: Express) {
  app.get("/api/video-proxy", async (req, res) => {
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
      res.status(403).send("URL not in allowed list");
      return;
    }

    try {
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (compatible; VideoProxy/1.0)",
      };

      // Forward Range header for seek support
      if (req.headers.range) {
        headers["Range"] = req.headers.range;
      }

      const upstream = await fetch(decodedUrl, { headers });

      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).send(`Upstream error: ${upstream.statusText}`);
        return;
      }

      // Forward relevant response headers
      const forwardHeaders: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      };

      const contentType = upstream.headers.get("content-type");
      if (contentType) forwardHeaders["Content-Type"] = contentType;

      const contentLength = upstream.headers.get("content-length");
      if (contentLength) forwardHeaders["Content-Length"] = contentLength;

      const contentRange = upstream.headers.get("content-range");
      if (contentRange) forwardHeaders["Content-Range"] = contentRange;

      const acceptRanges = upstream.headers.get("accept-ranges");
      if (acceptRanges) forwardHeaders["Accept-Ranges"] = acceptRanges;

      res.writeHead(upstream.status, forwardHeaders);

      if (!upstream.body) {
        res.end();
        return;
      }

      // Stream the body
      const reader = upstream.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); break; }
          const canContinue = res.write(value);
          if (!canContinue) {
            await new Promise<void>((resolve) => res.once("drain", resolve));
          }
        }
      };
      await pump();
    } catch (err) {
      console.error("[VideoProxy] error:", err);
      if (!res.headersSent) {
        res.status(502).send("Video proxy error");
      }
    }
  });
}
