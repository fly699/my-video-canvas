// 管理后台权限矩阵（服务端）：读取站长配置的各 tab 最低查看级别（30 秒缓存），
// 供 trpc.ts 的 tabLevelProcedure 动态门控与 admin.perms 路由使用。
// 默认值与合并规则见 shared/adminPerms.ts（前后端共享单一事实源）。
import { effectiveTabLevels, DEFAULT_TAB_LEVELS } from "../../shared/adminPerms";
import { getAdminPermsJson } from "../db";

let cache: { levels: Record<string, number>; at: number } | null = null;
const TTL = 30_000;

export async function getEffectiveTabLevels(): Promise<Record<string, number>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL) return cache.levels;
  let overrides: Record<string, unknown> | null = null;
  try {
    const json = await getAdminPermsJson();
    if (json) overrides = JSON.parse(json) as Record<string, unknown>;
  } catch { /* 解析失败按默认矩阵 */ }
  const levels = effectiveTabLevels(overrides);
  cache = { levels, at: now };
  return levels;
}

export function invalidateAdminPermsCache(): void {
  cache = null;
}

/** 某 tab 的生效最低级别（未知 tab 回退 1）。 */
export async function getTabMinLevel(tab: string): Promise<number> {
  const levels = await getEffectiveTabLevels();
  return levels[tab] ?? DEFAULT_TAB_LEVELS[tab] ?? 1;
}
