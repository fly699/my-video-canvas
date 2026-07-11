// 管理后台权限矩阵（前后端共享单一事实源）。
//
// 管理员级别：0=普通用户 · 1=查看员 · 2=运营 · 3=管理员 · 4=超级管理员 · 5=站长。
// 每个后台页面（tab）有两个级别：
//   · view    可见/只读级——达到即可「进入查看」该页（门控所有 query 读接口）。
//   · operate 可操作级——达到才能在该页写操作（门控所有 mutation 写接口）。
// 不变量：view ≤ operate（看不见就不可能操作）。站长(L5) 在「权限管理」页统一配置二者，
// 把 view 降到 operate 以下即启用「可见但只读」层。服务端对所有 admin.* 端点按 query/mutation
// 自动套 view/operate（enforceAdminMatrix），故是真门控而非仅前端隐藏。
//
// 【安全地板】写接口除受本矩阵 operate 约束外，仍各自带静态级别下限（server 的 managerProc 等），
// 二者取严（max）。敏感写（改密/封禁/删数据/管理员管理/系统更新/权限矩阵）的静态地板不可被矩阵
// 下调，杜绝「把 operate 设很低就能降级敏感写」的提权。矩阵 operate 只在静态地板之上进一步收紧。
// 「权限管理」页自身恒为 view=operate=5（站长专属），不可下放。

export const ADMIN_LEVEL_LABELS: [number, string][] = [
  [0, "普通用户"], [1, "查看员"], [2, "运营"], [3, "管理员"], [4, "超级管理员"], [5, "站长"],
];

export interface TabAccess {
  /** 可见/只读级：达到即可进入查看该页（门控 query）。 */
  view: number;
  /** 可操作级：达到才能写操作（门控 mutation）。恒 ≥ view。 */
  operate: number;
}

/** 各后台页面的默认级别（升级前的单级别）。默认 view=operate，行为与升级前完全一致；
 *  站长把 view 降到 operate 以下即启用只读层。日志三页 + 聊天管理 = L4；白名单/下载审批 = L3；
 *  权限管理恒 L5；其余任意管理员可见（其写操作仍受各自静态地板约束）。 */
const DEFAULT_LEVEL: Record<string, number> = {
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

/** 二维默认矩阵（view=operate=单级别默认）。 */
export const DEFAULT_TAB_ACCESS: Record<string, TabAccess> = Object.fromEntries(
  Object.entries(DEFAULT_LEVEL).map(([k, v]) => [k, { view: v, operate: v }]),
);

/** 兼容旧消费方：仅 view 级别的一维映射（前端 fallback / 旧测试用）。 */
export const DEFAULT_TAB_LEVELS: Record<string, number> = Object.fromEntries(
  Object.entries(DEFAULT_LEVEL).map(([k, v]) => [k, v]),
);

/** 站长可调整的 tab（perms 自身除外）。 */
export const EDITABLE_TAB_KEYS = Object.keys(DEFAULT_LEVEL).filter((k) => k !== "perms");

// 少数 sub-router 名 ≠ tab 键的别名（其余 admin sub-router 名与 tab 同名）。
export const ADMIN_SUBROUTER_TAB_ALIAS: Record<string, string> = {
  logEmail: "logs",  // 日志邮送设置在「操作日志」页
  update: "system",  // 系统更新在「系统更新」页
};

// 少数「后台管理功能」不在 admin.* 命名空间下（挂在顶层/共享 router），必须显式登记到对应 tab，
// 否则矩阵无法在后端强制它们的写——而前端却已按矩阵隐藏入口，就成了「前端藏、API 通」的自欺欺人。
//  · 按 router 前缀整体归属（这些顶层 router 的非 admin 端点均为 protectedProcedure，本就不经
//    enforceAdminMatrix，故整体前缀映射不会误伤用户侧只读端点）。
const NON_ADMIN_ROUTER_TAB_PREFIX: [string, string][] = [
  ["comfyStress.", "comfyStress"], // ComfyUI 压测（全部 admin 端点）
  ["comfyOps.", "comfyOps"],       // ComfyUI 运维中心（admin 端点；alerts/dashboard 等用户只读为 protected，自动豁免）
];
//  · 精确路径归属：共享 router 里个别的后台管理写（如全局 ComfyUI 服务器设置，挂在 comfyui.*）。
//    只登记该写端点；同 router 的 serverStatus/globalServers 是画布共享只读(protected)，不登记、不受影响。
const NON_ADMIN_EXACT_PATH_TAB: Record<string, string> = {
  "comfyui.setGlobalServers": "comfyServers",
};

// 矩阵后端强制的豁免端点（完整 rpcPath）：这些端点虽挂在某个 admin 子路由下，但语义不属于
// 该页面的「可见性范畴」——它们是跨页面共享的非敏感状态读，或独立静态门控的功能帧，
// 若被页面矩阵一并收紧就会误伤其他页面。故豁免矩阵、仅保留各自的静态级别门控。
// 注意：这里只豁免「非敏感只读 / 独立功能帧」，任何会暴露敏感数据或写操作的端点绝不豁免，
// 必须继续受页面矩阵强制（否则就成了「前端隐藏、API 仍可绕过」的自欺欺人）。
//  - 广播类：聊天室「广播频道」功能（L3 管理员在聊天里用），非后台聊天管理页。
//  - clearPersistentAnnouncement：聊天室里关公告，非后台聊天管理页。
//  - perms.get：任意管理员都要读矩阵以过滤自己可见的 tab（读矩阵无害）。
//  - perms.set：站长(L5)独占，靠 ownerProc 静态门控。
//  - whitelist.getSettings：只回 4 个功能布尔标志（enabled/comfyuiBypass/llmBypass/kieEnabled），
//    非敏感的白名单条目本身；被 KiePanel(kie 页, L1) 与白名单页共同只读引用。若受 whitelist 页
//    (L3) 矩阵约束，L1/L2 管理员打开 KIE 页就会 403。真正敏感的 listEntries（IP 明细）及所有写
//    开关（setEnabled/setComfyuiBypass/setLlmBypass/setKieEnabled/addEntry/removeEntry）均为
//    managerProc 且不在此豁免，继续受 whitelist 页矩阵强制。
export const MATRIX_EXEMPT_METHODS = new Set<string>([
  "admin.chat.broadcast",
  "admin.chat.broadcastTargets",
  "admin.chat.ensureBroadcastChannel",
  "admin.chat.clearPersistentAnnouncement",
  "admin.perms.get",
  "admin.perms.set",
  "admin.whitelist.getSettings",
]);

/** 由 tRPC 路径（admin.<sub>.<method>）解析出受矩阵约束的 tab；非 admin / 豁免端点返回 null。
 *  用于服务端统一门控（adminProcedure/levelProcedure 叠加矩阵），让站长的「管理范围」配置
 *  真实生效到接口层，而非仅前端隐藏。未知 sub-router 的 tab 走默认（getTabAccess 回退 view=operate=1，
 *  即不额外收紧，静态级别仍生效）。 */
export function adminTabFromRpcPath(path: string | undefined | null): string | null {
  if (!path) return null;
  if (MATRIX_EXEMPT_METHODS.has(path)) return null;
  // 先处理不在 admin.* 命名空间下、但属于某后台页的管理端点（否则矩阵漏管、API 可绕过）。
  const exact = NON_ADMIN_EXACT_PATH_TAB[path];
  if (exact) return exact;
  for (const [prefix, tab] of NON_ADMIN_ROUTER_TAB_PREFIX) if (path.startsWith(prefix)) return tab;
  if (!path.startsWith("admin.")) return null;
  const seg = path.split(".")[1];
  if (!seg) return null;
  return ADMIN_SUBROUTER_TAB_ALIAS[seg] ?? seg;
}

function clampLevel(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : fallback;
}

/** 合并覆盖值 → 全量生效二维矩阵：非法键丢弃、级别钳制 1~5、view ≤ operate、perms 恒 5/5。
 *  兼容旧格式：覆盖值为数字 n 时按 {view:n, operate:n} 解析。 */
export function effectiveTabAccess(
  overrides: Record<string, unknown> | null | undefined,
): Record<string, TabAccess> {
  const out: Record<string, TabAccess> = {};
  for (const [k, def] of Object.entries(DEFAULT_TAB_ACCESS)) out[k] = { ...def };
  if (overrides && typeof overrides === "object") {
    for (const [k, v] of Object.entries(overrides)) {
      if (!(k in DEFAULT_TAB_ACCESS) || k === "perms") continue;
      let view: number, operate: number;
      if (typeof v === "number") {
        view = operate = clampLevel(v, out[k].view);
      } else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        operate = clampLevel(o.operate, out[k].operate);
        view = clampLevel(o.view, out[k].view);
      } else {
        continue;
      }
      if (view > operate) view = operate; // 不变量：可见级 ≤ 可操作级
      out[k] = { view, operate };
    }
  }
  out.perms = { view: 5, operate: 5 };
  return out;
}

/** 兼容旧消费方：返回仅 view 级别的一维映射。 */
export function effectiveTabLevels(
  overrides: Record<string, unknown> | null | undefined,
): Record<string, number> {
  const acc = effectiveTabAccess(overrides);
  return Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, a.view]));
}
