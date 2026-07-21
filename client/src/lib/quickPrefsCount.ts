// 快捷设置徽标计数：统计「与出厂默认不同」的设置项数。
//
// 历史 bug（用户实报「快速设置 · 11 统计不对」）：旧实现把所有非空/为真的字段都算一项——
// 出厂默认本身就有 8 个真值（16:9、电影感、锁定图像/视频模型、排除分镜、中文对白、锚点
// 压缩、自查清单），什么都没改也显示 8；且手写枚举漏掉了 transitionStyle / summaryMode /
// useComfyMemory / streamEcho 等后加字段——数字既虚高又不全，每加一个新设置都得记得
// 手动补计数（没人记得住）。
//
// 现语义：徽标 = 用户改动数（0 = 全默认，不显示徽标）。按 defaults 的键集合泛型遍历，
// 新增设置字段自动纳入统计，永不再漏；数组（genNodes/workflowTemplateIds）按 JSON 序列化
// 比较（顺序即语义，够用且稳定）。
export function countDiffFromDefaults<T extends Record<string, unknown>>(defaults: T, current: T): number {
  let n = 0;
  for (const k of Object.keys(defaults) as Array<keyof T>) {
    const def = defaults[k];
    const cur = current[k];
    const same = Array.isArray(def) ? JSON.stringify(cur) === JSON.stringify(def) : cur === def;
    if (!same) n++;
  }
  return n;
}
