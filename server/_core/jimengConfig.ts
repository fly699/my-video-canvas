// #328 即梦（dreamina）CLI 配置读取：管理后台 DB 优先、JIMENG_CLI_* env 兜底。
// 与 bridgeMcp.ts / selfHostedLlm 同款：短 TTL 内存快照 + 后台刷新，让 jimengCli.ts 的
// 同步读取零阻塞。后台从未保存过（列 NULL）时回退 env，使「只设环境变量」的老部署行为不变。
import { getJimengCliConfigRaw } from "../db";
import type { JimengCliConfig } from "../../drizzle/schema";

function envConfig(): JimengCliConfig {
  return {
    enabled: (process.env.JIMENG_CLI_ENABLED ?? "") === "1" || (process.env.JIMENG_CLI_ENABLED ?? "").toLowerCase() === "true",
    bin: process.env.JIMENG_CLI_BIN?.trim() ?? "",
    sessionId: process.env.JIMENG_CLI_SESSION?.trim() ?? "",
  };
}

let cache: JimengCliConfig | null = null;
let cachedAt = 0;
const TTL = 30_000;

async function refresh(): Promise<void> {
  try {
    const dbCfg = await getJimengCliConfigRaw(); // null = 后台从未配置 → 回退 env
    cache = dbCfg ?? envConfig();
    cachedAt = Date.now();
  } catch { /* DB 不可用：保留旧缓存 / env 兜底 */ }
}
void refresh(); // 启动即异步预热

/** 当前即梦 CLI 配置（同步快照；后台刷新；env 兜底）。 */
export function getJimengCliConfig(): JimengCliConfig {
  if (Date.now() - cachedAt > TTL) void refresh(); // 过期后台刷新，本次仍返回旧值（非阻塞）
  return cache ?? envConfig();
}

/** 管理后台保存后立即刷新缓存。 */
export async function reloadJimengCliConfig(): Promise<void> { await refresh(); }
