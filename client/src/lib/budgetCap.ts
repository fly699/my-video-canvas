// 项目预算上限（kie 点）：软上限，按项目存 localStorage（无需 DB 迁移）。
// 写入方：工具栏「预算管控」面板（BudgetButton）；
// 读取方：面板自身 + 智能体 autoRun 的预算闸门（超上限暂停自动执行）。

export const budgetCapKey = (projectId: number | null) => `avc:budget-cap:${projectId ?? "0"}`;

export function readProjectBudgetCap(projectId: number | null): number | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(budgetCapKey(projectId));
  const n = v != null && v !== "" ? Number(v) : null;
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

export function writeProjectBudgetCap(projectId: number | null, cap: number | null): void {
  if (typeof localStorage === "undefined") return;
  if (cap != null && cap > 0) localStorage.setItem(budgetCapKey(projectId), String(cap));
  else localStorage.removeItem(budgetCapKey(projectId));
}
