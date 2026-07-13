import { getSuperAgentConfigRaw } from "../../db";
import type { SuperAgentConfig } from "../../../drizzle/schema";

// 「工程智能体」权限（代码任务 / Bash 放行 / ComfyUI 缺件自动安装）现由管理后台存 DB
// （替代 SUPER_AGENT_* 环境变量）。与 bridgeMcp.ts 同款：短 TTL 内存快照 + 后台刷新，让
// isCodeAgentEnabled() 等保持同步、每请求零阻塞读取。
//
// 关键语义：dbOverride 只存「后台显式配置」（getSuperAgentConfigRaw 返回 null 表示从未配置）；
// env 每次实时读取。故——
//   · 后台从未配置（dbOverride=null）→ 完全回退 env，行为与老部署一致，且 env 变更即时生效
//     （单测直接改 process.env 就能验证，不受缓存影响）；
//   · 后台一旦保存（含全 false）→ 以 DB 为准、覆盖 env，可在后台显式关掉 env 已开的项。
function envConfig(): SuperAgentConfig {
  return {
    codeEnabled: process.env.SUPER_AGENT_CODE_ENABLED === "1",
    allowBash: process.env.SUPER_AGENT_CODE_ALLOW_BASH === "1",
    autoInstall: process.env.SUPER_AGENT_AUTO_INSTALL === "1",
  };
}

let dbOverride: SuperAgentConfig | null = null; // 后台显式配置；null=未配置→回退 env
let cachedAt = 0;
const TTL = 30_000;

async function refresh(): Promise<void> {
  try {
    dbOverride = await getSuperAgentConfigRaw();
    cachedAt = Date.now();
  } catch { /* DB 不可用：保留旧值 */ }
}
void refresh(); // 启动即异步预热

/** Current super-agent permission config (sync snapshot; background-refreshed; env fallback). */
export function getSuperAgentConfig(): SuperAgentConfig {
  if (Date.now() - cachedAt > TTL) void refresh(); // 过期则后台刷新，本次仍返回旧值（非阻塞）
  return dbOverride ?? envConfig(); // 后台已配置则以 DB 为准，否则实时读取 env
}

/** Force an immediate cache refresh — call right after an admin save. */
export async function reloadSuperAgentConfig(): Promise<void> { await refresh(); }
