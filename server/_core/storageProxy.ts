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
import { isChatMember, getAssetByStorageKey, getProjectAccess } from "../db";

/**
 * 存储对象读取的对象级授权（IDOR 收敛，#93）。返回 true 放行、false 拒绝。纯函数（依赖注入），便于单测。
 * 策略（零回归）：
 *  - 管理员放行（审核）。
 *  - chat/{convId}/：仅该会话成员。
 *  - u/{userId}/ 属主直接放行（覆盖其全部自有对象，含未入库的上传参考图）。
 *  - u/{userId}/ 与 generated-videos/ 的**已入库产物**（assets 表可反查）：非属主时须对其所属项目有访问权，
 *    否则拒绝——堵住「拿到/猜到 key 就跨用户读他人产物」。
 *  - 其余（未入库 key / 其它前缀）保持放行，靠随机不可枚举 key 兜底，避免误伤上传/参考图（不断协作）。
 */
export async function authorizeStorageKeyRead(
  key: string,
  user: { id: number; role?: string | null } | null,
  deps: {
    isChatMember: (conversationId: number, userId: number) => Promise<boolean>;
    getAssetByStorageKey: (k: string) => Promise<{ userId: number; projectId: number | null } | null>;
    getProjectAccess: (projectId: number, userId: number) => Promise<unknown | null | undefined>;
  },
): Promise<boolean> {
  if (!user) return false;
  if (user.role === "admin") return true;
  const chatM = /^chat\/(\d+)\//.exec(key);
  if (chatM) return await deps.isChatMember(Number(chatM[1]), user.id).catch(() => false);
  const uM = /^u\/(\d+)\//.exec(key);
  if (uM || key.startsWith("generated-videos/")) {
    if (uM && Number(uM[1]) === user.id) return true; // 属主
    const asset = await deps.getAssetByStorageKey(key).catch(() => null);
    if (!asset) return true; // 未入库（如上传参考图）→ 保持既有放行
    if (asset.userId === user.id) return true; // 产物属主
    if (asset.projectId != null && (await deps.getProjectAccess(asset.projectId, user.id).catch(() => null))) return true; // 项目协作者
    return false; // 已入库产物、非属主、无项目访问权 → 拒绝
  }
  return true;
}
import { isForceStorageRelayEnabled, isDownloadWatermarkEnabled } from "./storageConfig";
import { isTunnelRequest } from "./tunnelGate";
import { getTunnelListenerPort, getTunnelGate } from "./tunnel";
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

    // 对象级授权（IDOR 收敛，#93）：聊天附件按会话成员、u/{userId}/ 与 generated-videos/ 的已入库
    // 产物按属主/项目访问权收敛；未入库 key 保持放行（随机不可枚举）。详见 authorizeStorageKeyRead。
    {
      const user = await resolveRequestUser(req);
      const ok = await authorizeStorageKeyRead(key, user, { isChatMember, getAssetByStorageKey, getProjectAccess });
      if (!ok) { res.status(403).send("Forbidden"); return; }
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
      // 经隧道进来的请求：绝不下发预签名直链。否则若配了 S3_PUBLIC_ENDPOINT / Forge，
      // 外部访客会被 307 甩到公网存储直连下载，绕过 app 鉴权、隧道白名单与下载门控（且直链
      // 可转发）。强制走下方 app 中转，让所有门控照常生效。局域网仍走快速 307 直链。
      const viaTunnel = isTunnelRequest(req.socket?.localPort, getTunnelListenerPort(), req.headers, getTunnelGate().host);

      // When the storage host is publicly reachable (Forge, or S3/MinIO behind a
      // public endpoint), 307-redirect the browser straight to the signed URL —
      // cheapest path, no app-server bandwidth. Unless the admin enabled
      // "force relay" (anti-leech), or the request came via the tunnel: then we
      // always stream through below so the raw presigned URL is never exposed.
      if (canBrowserReachStorageDirectly() && !viaTunnel && !(await isForceStorageRelayEnabled())) {
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
