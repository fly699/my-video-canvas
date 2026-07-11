// 管理后台权限矩阵（前后端共享单一事实源）。
//
// 管理员级别：0=普通用户 · 1=查看员 · 2=运营 · 3=管理员 · 4=超级管理员 · 5=站长。
// 矩阵记录每个后台页面（tab）的「最低可见/可查级别」，站长(L5) 可在「权限管理」页
// 按级别调整各页面的管理范围；服务端对日志/聊天等敏感页的接口做同口径强制。
// 「权限管理」页自身恒为 L5，不可下放（防止低级别管理员改权限自提升）。

export const ADMIN_LEVEL_LABELS: [number, string][] = [
  [0, "普通用户"], [1, "查看员"], [2, "运营"], [3, "管理员"], [4, "超级管理员"], [5, "站长"],
];

/** 各后台页面的默认最低查看级别。日志三页 + 聊天管理 = L4（超管及以上）；
 *  白名单/下载审批 = L3（沿既有约束）；权限管理恒 L5；其余任意管理员可见（页内写操作
 *  仍受各自接口的静态级别门控约束，矩阵只会收紧、不会放松写权限）。 */
export const DEFAULT_TAB_LEVELS: Record<string, number> = {
  whitelist: 3,
  kie: 1,
  users: 1,
  auth: 1,
  logs: 4,
  comfyLogs: 4,
  llmLogs: 4,
  storage: 1,
  models: 1,
  tunnel: 1,
  chat: 4,
  comfyServers: 1,
  comfyStress: 1,
  comfyOps: 1,
  assets: 1,
  downloads: 3,
  system: 1,
  config: 1,
  report: 1,
  intro: 1,
  perms: 5, // 权限管理页：恒站长，不可下放
};

/** 站长可调整的 tab（perms 自身除外）。 */
export const EDITABLE_TAB_KEYS = Object.keys(DEFAULT_TAB_LEVELS).filter((k) => k !== "perms");

// 少数 sub-router 名 ≠ tab 键的别名（其余 admin sub-router 名与 tab 同名）。
export const ADMIN_SUBROUTER_TAB_ALIAS: Record<string, string> = {
  logEmail: "logs",  // 日志邮送设置在「操作日志」页
  update: "system",  // 系统更新在「系统更新」页
};

// 矩阵后端强制的豁免端点（完整 rpcPath）：这些端点虽挂在 admin.chat/admin.perms 下，
// 但语义不属于「聊天管理」「权限」页的可见性范畴——各自靠静态级别门控，不受页面矩阵约束。
//  - 广播类：聊天室「广播频道」功能（L3 管理员在聊天里用），非后台聊天管理页。
//  - perms.get：任意管理员都要读矩阵以过滤自己可见的 tab（读矩阵无害）。
//  - perms.set：站长(L5)独占，靠 ownerProc 静态门控。
export const MATRIX_EXEMPT_METHODS = new Set<string>([
  "admin.chat.broadcast",
  "admin.chat.broadcastTargets",
  "admin.chat.ensureBroadcastChannel",
  "admin.chat.clearPersistentAnnouncement",
  "admin.perms.get",
  "admin.perms.set",
]);

/** 由 tRPC 路径（admin.<sub>.<method>）解析出受矩阵约束的 tab；非 admin / 豁免端点返回 null。
 *  用于服务端统一门控（adminProcedure/levelProcedure 叠加矩阵），让站长的「管理范围」配置
 *  真实生效到接口层，而非仅前端隐藏。未知 sub-router 的 tab 走默认（getTabMinLevel 回退 1，
 *  即不额外收紧，静态级别仍生效）。 */
export function adminTabFromRpcPath(path: string | undefined | null): string | null {
  if (!path || !path.startsWith("admin.")) return null;
  if (MATRIX_EXEMPT_METHODS.has(path)) return null;
  const seg = path.split(".")[1];
  if (!seg) return null;
  return ADMIN_SUBROUTER_TAB_ALIAS[seg] ?? seg;
}

/** 合并覆盖值 → 全量生效矩阵：非法键丢弃、级别钳制 1~5、perms 恒 5。 */
export function effectiveTabLevels(overrides: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = { ...DEFAULT_TAB_LEVELS };
  if (overrides && typeof overrides === "object") {
    for (const [k, v] of Object.entries(overrides)) {
      if (!(k in DEFAULT_TAB_LEVELS) || k === "perms") continue;
      const n = Number(v);
      if (Number.isInteger(n) && n >= 1 && n <= 5) out[k] = n;
    }
  }
  out.perms = 5;
  return out;
}
