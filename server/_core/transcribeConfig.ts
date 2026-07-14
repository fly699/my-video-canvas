import { getTranscribeEndpointConfigRaw } from "../db";
import type { TranscribeEndpointConfig } from "../../drizzle/schema";

// 语音/转写端点现由管理后台存 DB（替代 TRANSCRIBE_* 环境变量）。与 superAgent/config.ts 同款：
// 短 TTL 内存快照 + 后台刷新，让 resolveTranscribeEndpoint() 每请求零阻塞读取。
// 语义：getTranscribeEndpointConfigRaw 返回 null 表示后台未配置（列 NULL 或 url 空）→ 回退 env。
let dbOverride: TranscribeEndpointConfig | null = null; // 后台显式配置；null=未配置→回退 env
let cachedAt = 0;
const TTL = 30_000;

async function refresh(): Promise<void> {
  try {
    dbOverride = await getTranscribeEndpointConfigRaw();
    cachedAt = Date.now();
  } catch { /* DB 不可用：保留旧值 */ }
}
void refresh(); // 启动即异步预热

/** 后台配置的转写端点覆盖（同步快照；后台刷新；null=未配置→上层回退 env）。 */
export function getTranscribeOverride(): TranscribeEndpointConfig | null {
  if (Date.now() - cachedAt > TTL) void refresh(); // 过期则后台刷新，本次仍返回旧值（非阻塞）
  return dbOverride;
}

/** 保存后立即强制刷新缓存（管理后台 setTranscribeEndpoint 后调用）。 */
export async function reloadTranscribeConfig(): Promise<void> { await refresh(); }
