import type { Request, Response } from "express";
import { resolveRequestUser } from "./context";
import { toInternalStoragePath } from "../storage";
import { writeAuditLog } from "./auditLog";
import { isDownloadAuthEnabled } from "./storageConfig";
import * as db from "../db";

/** Strip the `/manus-storage/` prefix (+ any query) to get the bare storage key. */
function keyFromInternalPath(p: string): string {
  return p.replace(/^\/manus-storage\//, "").split("?")[0];
}

/**
 * Resolve the storage key a download targets. Own-storage URLs / paths → the
 * bare key; external URLs → the raw URL itself (so grants can still be keyed to
 * it). `paramKey` is the already-bare key from the storage proxy route.
 */
export function resolveDownloadKey(opts: { paramKey?: string; rawUrl?: string }): string | null {
  if (opts.paramKey) return opts.paramKey.split("?")[0];
  const raw = opts.rawUrl;
  if (!raw) return null;
  const internal = toInternalStoragePath(raw);
  if (internal) return keyFromInternalPath(internal);
  return raw; // external URL — used verbatim as the grant key
}

/**
 * Gate an original-file download. When DOWNLOAD_AUTH is on, a non-admin may only
 * proceed if they hold a consumable grant for this file; the grant is consumed
 * here (one successful download per file). On block, a 403 JSON response is
 * sent and `false` returned — callers must stop. When the feature is off (or the
 * caller is an admin), returns `true` without touching the DB.
 *
 * Used by the three media-serving routes (storage / image / video proxies) only
 * on the `download=1` path — plain viewing/streaming is never gated.
 */
export async function authorizeDownload(
  req: Request,
  res: Response,
  opts: { paramKey?: string; rawUrl?: string },
): Promise<boolean> {
  if (!(await isDownloadAuthEnabled())) return true;

  const user = await resolveRequestUser(req);
  if (!user) {
    res.status(401).json({ error: "请先登录后再下载", code: "DOWNLOAD_AUTH_REQUIRED" });
    return false;
  }
  if (user.role === "admin") return true; // admins always bypass

  const storageKey = resolveDownloadKey(opts);
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
  if (!storageKey) {
    res.status(403).json({ error: "无法确定文件，已拒绝下载", code: "DOWNLOAD_NOT_AUTHORIZED" });
    return false;
  }

  // Resolve asset/project context so project-scope grants can match.
  let assetId: number | null = null;
  let projectId: number | null = null;
  try {
    const asset = await db.getAssetByStorageKey(storageKey);
    if (asset) { assetId = asset.id; projectId = asset.projectId; }
  } catch { /* best-effort — fall back to asset-scope-by-key matching */ }

  const grant = await db.findUsableDownloadGrant({ userId: user.id, storageKey, assetId, projectId });
  if (!grant) {
    writeAuditLog({ ip, userId: user.id, userEmail: user.email ?? null, userName: user.name ?? null, action: "download:denied", detail: { storageKey } });
    res.status(403).json({ error: "你没有该文件的下载授权，请向管理员申请", code: "DOWNLOAD_NOT_AUTHORIZED" });
    return false;
  }

  const consumed = await db.consumeDownloadGrant(grant.id, user.id, storageKey, assetId);
  if (!consumed) {
    writeAuditLog({ ip, userId: user.id, userEmail: user.email ?? null, userName: user.name ?? null, action: "download:denied", detail: { storageKey, grantId: grant.id, reason: "consumed" } });
    res.status(403).json({ error: "该文件的下载授权已用尽（每次授权仅可下载一次）", code: "DOWNLOAD_CONSUMED" });
    return false;
  }

  writeAuditLog({ ip, userId: user.id, userEmail: user.email ?? null, userName: user.name ?? null, action: "download:served", detail: { storageKey, grantId: grant.id } });
  return true;
}
