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
import { isRequestAuthenticated } from "./context";
import { authorizeDownload } from "./downloadAuth";
import { isAllowedExternalUrl as isAllowedUrl } from "./ssrfGuard";

export function registerVideoProxy(app: Express) {
  app.get("/api/video-proxy", async (req, res) => {
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

    // Strict download authorization (when enabled) — only on the download path.
    if (req.query.download !== undefined) {
      const ok = await authorizeDownload(req, res, { rawUrl: decodedUrl });
      if (!ok) return;
    }

    const MAX_VIDEO_BYTES = 5000 * 1024 * 1024; // 5000 MB
    const FETCH_TIMEOUT_MS = 60_000;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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
        signal: controller.signal,
      });
      clearTimeout(timer);

      // Validate final URL after redirect chain to prevent SSRF via open redirect
      if (!isAllowedUrl(upstream.url)) {
        res.status(403).send("URL not allowed after redirect");
        return;
      }

      // Reject oversized responses before streaming; ignore non-numeric / negative Content-Length
      const contentLengthRaw = upstream.headers.get("content-length");
      const contentLengthNum = contentLengthRaw !== null ? parseInt(contentLengthRaw, 10) : null;
      if (contentLengthNum !== null && !isNaN(contentLengthNum) && contentLengthNum > MAX_VIDEO_BYTES) {
        res.status(413).send("Video too large");
        return;
      }

      // Forward relevant response headers
      const forwardHeaders: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
        "X-Content-Type-Options": "nosniff",
      };

      const contentType = upstream.headers.get("content-type");
      const safeVideoTypes = ["video/", "audio/", "application/octet-stream"];
      forwardHeaders["Content-Type"] =
        contentType && safeVideoTypes.some((t) => contentType.startsWith(t))
          ? contentType
          : "video/mp4";

      if (contentLengthNum !== null && !isNaN(contentLengthNum) && contentLengthNum >= 0) {
        forwardHeaders["Content-Length"] = String(contentLengthNum);
      }

      const contentRange = upstream.headers.get("content-range");
      if (contentRange) forwardHeaders["Content-Range"] = contentRange;

      const acceptRanges = upstream.headers.get("accept-ranges");
      if (acceptRanges) forwardHeaders["Accept-Ranges"] = acceptRanges;
      else forwardHeaders["Accept-Ranges"] = "bytes";

      // Cache for 1 hour
      forwardHeaders["Cache-Control"] = "public, max-age=3600";

      // If download=1 is set, add Content-Disposition to trigger browser download
      if (req.query.download === "1") {
        const urlPath = new URL(decodedUrl).pathname;
        const rawName = urlPath.split("/").pop() || "video.mp4";
        // Strip characters unsafe in Content-Disposition filename (quotes, CR, LF, semicolons, null bytes)
        const filename = rawName.replace(/["\r\n;\\%\x00]/g, "_");
        forwardHeaders["Content-Disposition"] = `attachment; filename="${filename}"`;
      }

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

      // Stream the body with a hard byte limit
      const reader = upstream.body.getReader();
      let bytesReceived = 0;
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            break;
          }
          bytesReceived += value.byteLength;
          if (bytesReceived > MAX_VIDEO_BYTES) {
            reader.cancel();
            res.destroy();
            break;
          }
          const canContinue = res.write(value);
          if (!canContinue) {
            // Wait for backpressure to clear. Also listen for 'close' so the
            // Promise resolves immediately if the client disconnects mid-stream
            // instead of hanging forever waiting for a drain that never fires.
            const drained = await new Promise<boolean>((resolve) => {
              const onDrain = () => { res.removeListener("close", onClose); resolve(true); };
              const onClose = () => { res.removeListener("drain", onDrain); resolve(false); };
              res.once("drain", onDrain);
              res.once("close", onClose);
            });
            if (!drained) break;
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
