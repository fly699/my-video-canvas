/**
 * Video proxy: forwards external video URLs through the server to avoid CORS
 * and authentication issues when playing videos from poyo.ai or other CDNs.
 *
 * Usage: GET /api/video-proxy?url=<encoded-video-url>
 * Supports range requests for seek/scrub in <video> elements.
 *
 * Security: Only HTTPS URLs are allowed. Private/internal IPs are blocked.
 */
import type { Express } from "express";

const BLOCKED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254", // AWS metadata
  "metadata.google.internal",
];

function isAllowedUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    // Only allow HTTPS
    if (u.protocol !== "https:") return false;
    // Block internal/private hosts
    const host = u.hostname.toLowerCase();
    if (BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) return false;
    // Block private IP ranges
    if (/^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\./.test(host)) return false;
    return true;
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
      res.status(403).send("URL not allowed");
      return;
    }

    try {
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "video/webm,video/mp4,video/*,*/*;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
      };

      // Forward Range header for seek support
      if (req.headers.range) {
        headers["Range"] = req.headers.range;
      }

      const upstream = await fetch(decodedUrl, {
        headers,
        redirect: "follow",
      });

      // Forward relevant response headers
      const forwardHeaders: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
      };

      const contentType = upstream.headers.get("content-type");
      if (contentType) forwardHeaders["Content-Type"] = contentType;
      else forwardHeaders["Content-Type"] = "video/mp4";

      const contentLength = upstream.headers.get("content-length");
      if (contentLength) forwardHeaders["Content-Length"] = contentLength;

      const contentRange = upstream.headers.get("content-range");
      if (contentRange) forwardHeaders["Content-Range"] = contentRange;

      const acceptRanges = upstream.headers.get("accept-ranges");
      if (acceptRanges) forwardHeaders["Accept-Ranges"] = acceptRanges;
      else forwardHeaders["Accept-Ranges"] = "bytes";

      // Cache for 1 hour
      forwardHeaders["Cache-Control"] = "public, max-age=3600";

      // If upstream fails, return a helpful error but still with CORS headers
      if (!upstream.ok && upstream.status !== 206) {
        res.set(forwardHeaders);
        res.status(upstream.status).send(`Upstream error: ${upstream.status} ${upstream.statusText}`);
        return;
      }

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
          if (done) {
            res.end();
            break;
          }
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
        res.set("Access-Control-Allow-Origin", "*");
        res.status(502).send("Video proxy error");
      }
    }
  });
}
