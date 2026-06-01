/**
 * One-off backfill: index historical generated media (already in MinIO but never
 * recorded in `assets`) into the unified media library so users can see/retrieve
 * past results. Idempotent — recordGeneratedAsset dedupes by (userId, storageKey).
 *
 * Run with a real DB + MinIO configured:
 *   npx tsx server/scripts/backfillAssets.ts
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

async function main() {
  const nodes = await getAllCanvasNodesRaw();
  console.log(`[backfill] scanning ${nodes.length} canvas nodes…`);
  const ownerCache = new Map<number, number | null>();
  let recorded = 0, skipped = 0;
  for (const node of nodes) {
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
  console.log(`[backfill] done. attempted ${recorded} records (dedupe skips silently), ${skipped} without an owner.`);
  process.exit(0);
}

main().catch((err) => { console.error("[backfill] failed:", err); process.exit(1); });
