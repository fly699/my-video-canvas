// 管理员配置的「系统默认模型」（按槽位）——30s 内存缓存，避免每次解析都打 DB。
// 与 modelToggles 同构：管理员改动时经 invalidateSystemDefaultModelsCache() 立即失效。
// 解析优先级（在 shared/nodeDefaultModels）：项目配置 > 系统默认(此处) > 出厂默认。
import * as db from "../db";
import { FACTORY_DEFAULT_MODELS, type ModelSlot, type SystemDefaultModels } from "../../shared/nodeDefaultModels";

let _cached: SystemDefaultModels | null = null;
let _expiresAt = 0;
let _inflight: Promise<SystemDefaultModels> | null = null;
const TTL_MS = 30_000;

export function invalidateSystemDefaultModelsCache(): void {
  _cached = null;
  _expiresAt = 0;
}

export async function getCachedSystemDefaultModels(): Promise<SystemDefaultModels> {
  const now = Date.now();
  if (_cached && now < _expiresAt) return _cached;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const cfg = (await db.getSystemDefaultModels()) as SystemDefaultModels;
      _cached = cfg;
      _expiresAt = Date.now() + TTL_MS;
      return cfg;
    } catch (err) {
      console.warn("[systemDefaultModels] DB read failed:", err);
      return _cached ?? {};
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** 解析某槽位的服务端兜底默认：系统默认（管理员）优先，否则出厂默认。 */
export async function getSystemDefaultModel(slot: ModelSlot): Promise<string> {
  const cfg = await getCachedSystemDefaultModels();
  return cfg[slot] ?? FACTORY_DEFAULT_MODELS[slot];
}
