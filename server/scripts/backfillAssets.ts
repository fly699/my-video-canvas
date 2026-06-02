/**
 * One-off backfill: index historical generated media (already in MinIO but never
 * recorded in `assets`) into the unified media library so users can see/retrieve
 * past results. Idempotent — recordGeneratedAsset dedupes by (userId, storageKey).
 *
 * Run with a real DB + MinIO configured:
 *   npx tsx server/scripts/backfillAssets.ts
 *
 * The same logic is also exposed in the admin panel ("素材库(全用户)" → 补历史素材数据),
 * so this CLI is only needed for headless/scripted runs.
 */
import { runBackfillCore } from "../_core/assetBackfill";

async function main() {
  console.log("[backfill] scanning canvas nodes…");
  const { scanned, recorded, skipped } = await runBackfillCore((done, total) => {
    console.log(`[backfill] ${done}/${total} nodes…`);
  });
  console.log(`[backfill] done. scanned ${scanned} nodes, attempted ${recorded} records (dedupe skips silently), ${skipped} without an owner.`);
  process.exit(0);
}

main().catch((err) => { console.error("[backfill] failed:", err); process.exit(1); });
