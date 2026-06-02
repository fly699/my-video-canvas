/**
 * Backfill core: index historical generated media (already in MinIO but never
 * recorded in `assets`) into the unified media library. Idempotent —
 * recordGeneratedAsset dedupes by (userId, storageKey).
 *
 * Shared by the CLI script (server/scripts/backfillAssets.ts) and the admin
 * one-click "补历史素材数据" action. The admin path runs it in the background
 * and exposes progress via getBackfillStatus().
 */
import { getAllCanvasNodesRaw, getProjectByIdRaw, recordGeneratedAsset } from "../db";

const IMG_EXT = /\.(png|jpe?g|webp|gif|avif|bmp)(\?|#|$)/i;
const VID_EXT = /\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i;
// Only re-hosted, stable storage URLs (upstream temp URLs expire / aren't ours).
const isStable = (v: unknown): v is string => typeof v === "string" && v.startsWith("/manus-storage/");

function collect(data: unknown, out: { url: string; type: "image" | "video" }[]) {
  const walk = (o: unknown) => {
    if (typeof o === "string") {
      if (isStable(o)) {
        if (IMG_EXT.test(o)) out.push({ url: o, type: "image" });
        else if (VID_EXT.test(o)) out.push({ url: o, type: "video" });
      }
    } else if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") Object.values(o as Record<string, unknown>).forEach(walk);
  };
  walk(data);
}

export interface BackfillResult {
  scanned: number;   // canvas nodes scanned
  recorded: number;  // recordGeneratedAsset calls (dedupe skips silently)
  skipped: number;   // media found but project owner unknown
}

/** Run the scan+record pass once. Pure work, no process side effects. */
export async function runBackfillCore(onProgress?: (scanned: number, total: number) => void): Promise<BackfillResult> {
  const nodes = await getAllCanvasNodesRaw();
  const ownerCache = new Map<number, number | null>();
  let recorded = 0, skipped = 0, scanned = 0;
  for (const node of nodes) {
    scanned++;
    if (onProgress && scanned % 50 === 0) onProgress(scanned, nodes.length);
    const found: { url: string; type: "image" | "video" }[] = [];
    collect(node.data, found);
    if (found.length === 0) continue;
    let ownerId = ownerCache.get(node.projectId);
    if (ownerId === undefined) {
      const proj = await getProjectByIdRaw(node.projectId);
      ownerId = proj?.userId ?? null;
      ownerCache.set(node.projectId, ownerId);
    }
    if (!ownerId) { skipped += found.length; continue; }
    const seen = new Set<string>();
    for (const f of found) {
      if (seen.has(f.url)) continue;
      seen.add(f.url);
      await recordGeneratedAsset({
        userId: ownerId, projectId: node.projectId, nodeId: node.id,
        type: f.type, source: "generated", provider: null, model: null,
        url: f.url, name: f.type === "video" ? "历史视频" : "历史图像",
      });
      recorded++;
    }
  }
  return { scanned: nodes.length, recorded, skipped };
}

// ── Admin one-click background runner (status singleton, mirrors selfUpdate) ──
type BackfillState = "idle" | "running" | "success" | "error";
export interface BackfillStatus extends BackfillResult {
  state: BackfillState;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;       // total nodes (known after scan starts)
  error: string | null;
}

const status: BackfillStatus = {
  state: "idle", startedAt: null, finishedAt: null,
  scanned: 0, total: 0, recorded: 0, skipped: 0, error: null,
};

export function getBackfillStatus(): BackfillStatus {
  return { ...status };
}

/** Idempotent: if a run is in progress, returns it instead of starting another. */
export function startBackfill(): { started: boolean; reason?: string } {
  if (status.state === "running") return { started: false, reason: "回填已在进行中" };
  status.state = "running";
  status.startedAt = Date.now();
  status.finishedAt = null;
  status.scanned = 0;
  status.total = 0;
  status.recorded = 0;
  status.skipped = 0;
  status.error = null;

  void (async () => {
    try {
      const res = await runBackfillCore((scanned, total) => {
        status.scanned = scanned;
        status.total = total;
      });
      status.scanned = res.scanned;
      status.total = res.scanned;
      status.recorded = res.recorded;
      status.skipped = res.skipped;
      status.state = "success";
    } catch (e) {
      status.state = "error";
      status.error = e instanceof Error ? e.message : String(e);
    } finally {
      status.finishedAt = Date.now();
    }
  })();

  return { started: true };
}
