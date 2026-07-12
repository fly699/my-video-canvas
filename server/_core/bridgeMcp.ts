import { getBridgeMcpConfig as dbGetBridgeMcpConfig } from "../db";
import type { BridgeMcpConfig } from "../../drizzle/schema";

// 桥接 MCP/技能配置现由管理后台存 DB（替代 CLAUDE_BRIDGE_* 环境变量）。
// 与 selfHostedLlm.ts 同款：短 TTL 内存快照 + 后台刷新，让同步的
// resolveBridgeAgenticArgs() 保持同步、每请求零阻塞读取。env 作为兜底，
// 使既有「只设环境变量」的老部署行为完全不变。
function envConfig(): BridgeMcpConfig {
  return {
    mcpConfig: process.env.CLAUDE_BRIDGE_MCP_CONFIG?.trim() ?? "",
    skills: process.env.CLAUDE_BRIDGE_SKILLS === "1",
    // CLAUDE_BRIDGE_MCP_STRICT 默认 true，仅显式设 "0" 才关（与 claudeBridge 旧逻辑一致）。
    strict: process.env.CLAUDE_BRIDGE_MCP_STRICT !== "0",
    permissionMode: process.env.CLAUDE_BRIDGE_PERMISSION_MODE?.trim() ?? "",
    allowedTools: process.env.CLAUDE_BRIDGE_ALLOWED_TOOLS?.trim() ?? "",
    workspace: process.env.CLAUDE_BRIDGE_WORKSPACE === "1",
  };
}

/** DB 里是否存在「实质配置」——任一有意义字段被设过就用 DB，否则回退 env。 */
function hasMeaningfulConfig(c: BridgeMcpConfig): boolean {
  return !!(c.mcpConfig.trim() || c.skills || c.allowedTools.trim() || c.permissionMode.trim() || c.workspace);
}

let cache: BridgeMcpConfig | null = null;
let cachedAt = 0;
const TTL = 30_000;

async function refresh(): Promise<void> {
  try {
    const dbCfg = await dbGetBridgeMcpConfig();
    cache = hasMeaningfulConfig(dbCfg) ? dbCfg : envConfig(); // DB 优先，否则回退 env
    cachedAt = Date.now();
  } catch { /* DB 不可用：保留旧缓存 / env 兜底 */ }
}
void refresh(); // 启动即异步预热

/** Current bridge MCP config (sync snapshot; background-refreshed; env fallback). */
export function getBridgeMcpConfig(): BridgeMcpConfig {
  if (Date.now() - cachedAt > TTL) void refresh(); // 过期则后台刷新，本次仍返回旧值（非阻塞）
  return cache ?? envConfig();
}

/** Force an immediate cache refresh — call right after an admin save. */
export async function reloadBridgeMcpConfig(): Promise<void> { await refresh(); }
