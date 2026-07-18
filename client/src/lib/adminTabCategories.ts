// #243 管理后台标签分类（单一事实源）：
//  - AdminPage 两级导航（一级分类胶囊 → 二级标签行）按此渲染；
//  - PermsPanel 权限矩阵分组同样按此渲染（此前矩阵页手写分组漏掉了 tutorialImgs，
//    收敛到这里后靠单测守卫「每个 tab 恰好归属一个分类」，不再漏）。
// 分类原则：按管理员心智任务分——管人/查日志/管资源/管模型/管算力/管内容/管系统。
// 顺序即展示顺序；分类内 tabs 顺序即标签展示顺序。

export interface AdminTabCategory {
  key: string;
  label: string;
  /** 分类气泡的专属色相（oklch hue），与 #237 标签色相体系同语言。 */
  hue: number;
  tabs: string[];
}

export const ADMIN_TAB_CATEGORIES: AdminTabCategory[] = [
  { key: "access", label: "用户与权限", hue: 245, tabs: ["users", "auth", "whitelist", "perms"] },
  { key: "audit", label: "日志与审计", hue: 60, tabs: ["logs", "comfyLogs", "llmLogs"] },
  { key: "resource", label: "资源与存储", hue: 195, tabs: ["storage", "staging", "assets", "downloads"] },
  { key: "model", label: "模型与密钥", hue: 285, tabs: ["models", "kie"] },
  { key: "comfy", label: "ComfyUI", hue: 265, tabs: ["comfyServers", "comfyStress", "comfyOps"] },
  { key: "content", label: "运营与内容", hue: 350, tabs: ["chat", "tutorialImgs", "report", "intro"] },
  { key: "system", label: "系统与网络", hue: 15, tabs: ["system", "config", "tunnel"] },
];

/** 某 tab 所属分类（未登记的 tab 回退第一个分类——配合单测守卫实际不会发生）。 */
export function categoryOfTab(tab: string): AdminTabCategory {
  return ADMIN_TAB_CATEGORIES.find((c) => c.tabs.includes(tab)) ?? ADMIN_TAB_CATEGORIES[0];
}
