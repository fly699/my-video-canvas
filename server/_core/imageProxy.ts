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
import { authorizeDownload } from "./downloadAuth";

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
    // URL.hostname wraps IPv6 in brackets (e.g. "[::1]") — strip them before matching.
    const rawHost = u.hostname.toLowerCase();
    const host = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;
    if (BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) return false;
    if (/^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^::ffff:/i.test(host)) return false;
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

    // Strict download authorization (when enabled) — only on the download path.
    if (req.query.download !== undefined) {
      const ok = await authorizeDownload(req, res, { rawUrl: decodedUrl });
      if (!ok) return;
    }

    const MAX_IMAGE_BYTES = 32 * 1024 * 1024; // 32 MB
    const FETCH_TIMEOUT_MS = 30_000;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const upstream = await fetch(decodedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ImageProxy/1.0)",
          "Accept": "image/*,*/*;q=0.8",
        },
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
      if (contentLengthNum !== null && !isNaN(contentLengthNum) && contentLengthNum > MAX_IMAGE_BYTES) {
        res.status(413).send("Image too large");
        return;
      }

      const forwardHeaders: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      };

      const contentType = upstream.headers.get("content-type");
      const safeImageTypes = ["image/", "application/octet-stream"];
      forwardHeaders["Content-Type"] =
        contentType && safeImageTypes.some((t) => contentType.startsWith(t))
          ? contentType
          : "image/png";

      if (contentLengthNum !== null && !isNaN(contentLengthNum) && contentLengthNum >= 0) {
        forwardHeaders["Content-Length"] = String(contentLengthNum);
      }

      // Trigger browser download if download=1
      if (req.query.download === "1") {
        const urlPath = new URL(decodedUrl).pathname;
        const rawName = urlPath.split("/").pop() || "image.png";
        // Strip characters unsafe in Content-Disposition filename (quotes, CR, LF, semicolons, null bytes)
        const filename = rawName.replace(/["\r\n;\\%\x00]/g, "_");
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
      let bytesReceived = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        bytesReceived += value.byteLength;
        if (bytesReceived > MAX_IMAGE_BYTES) {
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
    } catch (err) {
      console.error("[ImageProxy] error:", err);
      if (!res.headersSent) {
        res.set("Access-Control-Allow-Origin", "*");
        res.status(502).send("Image proxy error");
      }
    }
  });
}
