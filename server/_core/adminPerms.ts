// 管理后台权限矩阵（服务端）：读取站长配置的各 tab 二维级别 {view, operate}（30 秒缓存），
// 供 trpc.ts 的 enforceAdminMatrix 动态门控（query→view、mutation→operate）与 admin.perms 路由使用。
// 默认值与合并规则见 shared/adminPerms.ts（前后端共享单一事实源）。
import { effectiveTabAccess, DEFAULT_TAB_ACCESS, type TabAccess } from "../../shared/adminPerms";
import { getAdminPermsJson } from "../db";

let cache: { access: Record<string, TabAccess>; at: number } | null = null;
const TTL = 30_000;

export async function getEffectiveTabAccess(): Promise<Record<string, TabAccess>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL) return cache.access;
  let overrides: Record<string, unknown> | null = null;
  try {
    const json = await getAdminPermsJson();
    if (json) overrides = JSON.parse(json) as Record<string, unknown>;
  } catch { /* 解析失败按默认矩阵 */ }
  const access = effectiveTabAccess(overrides);
  cache = { access, at: now };
  return access;
}

export function invalidateAdminPermsCache(): void {
  cache = null;
}

/** 某 tab 的生效二维级别（未知 tab 回退 view=operate=1）。 */
export async function getTabAccess(tab: string): Promise<TabAccess> {
  const access = await getEffectiveTabAccess();
  return access[tab] ?? DEFAULT_TAB_ACCESS[tab] ?? { view: 1, operate: 1 };
}
