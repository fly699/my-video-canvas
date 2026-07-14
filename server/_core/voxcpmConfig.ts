import { getVoxcpmEndpointConfigRaw } from "../db";
import type { VoxcpmEndpointConfig } from "../../drizzle/schema";
import { ENV } from "./env";

// 本地 VoxCPM（Gradio TTS）全局默认地址：管理后台存 DB（替代 VOXCPM_BASE_URL 环境变量）。
// 与 transcribeConfig 同款：短 TTL 内存快照 + 后台刷新，让 resolveVoxcpmBaseUrl() 每请求零阻塞读取。
// 语义：getVoxcpmEndpointConfigRaw 返回 null 表示后台未配置（列 NULL 或 baseUrl 空）→ 回退 env。
let dbOverride: VoxcpmEndpointConfig | null = null; // 后台显式配置；null=未配置→回退 env
let cachedAt = 0;
const TTL = 30_000;

async function refresh(): Promise<void> {
  try {
    dbOverride = await getVoxcpmEndpointConfigRaw();
    cachedAt = Date.now();
  } catch { /* DB 不可用：保留旧值 */ }
}
void refresh(); // 启动即异步预热

/** 后台配置的 VoxCPM 默认地址覆盖（同步快照；后台刷新；null=未配置→回退 env）。 */
export function getVoxcpmOverride(): VoxcpmEndpointConfig | null {
  if (Date.now() - cachedAt > TTL) void refresh(); // 过期则后台刷新，本次仍返回旧值（非阻塞）
  return dbOverride;
}

/** 全站默认 VoxCPM 地址：DB 优先，其次 VOXCPM_BASE_URL env；都没有返回 ""。 */
export function resolveVoxcpmBaseUrl(): string {
  const db = getVoxcpmOverride();
  if (db?.baseUrl?.trim()) return db.baseUrl.trim();
  return ENV.voxcpmBaseUrl.trim();
}

/** 当前默认地址的来源（后台展示用）：db / env / none。 */
export function voxcpmDefaultSource(): "db" | "env" | "none" {
  if (getVoxcpmOverride()?.baseUrl?.trim()) return "db";
  if (ENV.voxcpmBaseUrl.trim()) return "env";
  return "none";
}

/** 保存后立即强制刷新缓存（管理后台 setVoxcpmEndpoint 后调用）。 */
export async function reloadVoxcpmConfig(): Promise<void> { await refresh(); }
