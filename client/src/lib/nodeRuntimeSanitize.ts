// #313 画布加载时的角色/场景节点运行态清洗。
//
// 用户实报两例「状态与实际产物不符」：①场景图已生成却常驻「生成中」进度条；
// ②定妆照已在却顶着「自动生成失败：[CHARGED?] Poyo 超时」红条。根因：
// - character 节点的 payload.status="processing" 只由【客户端瞬态流程】写入（自动定妆
//   autoPortraits / 运行全部 / 角色卡按钮），这些 fire-and-forget 流程不跨会话存活——
//   页面刷新/关闭后写它的 promise 已死，状态却随画布数据持久化，永远无人清理；
// - fill-only 双路径并行（自动定妆 与 运行全部 同时给同一节点生图）时，快路径先落图
//   并清态，慢路径 5 分钟超时后把 failed+横幅糊到已有成果上（迟到失败竞态——两处
//   catch 已加守卫防新增，这里负责清洗历史遗留）。
//
// 清洗规则（仅 character 节点，其余类型有各自的任务恢复机制绝不触碰）：
// 1. status==="processing" → 清（加载时刻不可能有活跃的本地生成绑定它）；
// 2. status==="failed" 且已有参考图 → 清状态与横幅（fill-only 语义下有图=目标达成，
//    失败横幅必然过时；手动重生成失败的场景当时已有 toast 提示，刷新后不再纠缠旧图）。
// 纯函数：不满足条件时原对象原样返回（引用不变，不打扰加载基线签名）。
export function sanitizeCharacterRuntimeOnLoad(
  nodeType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (nodeType !== "character") return payload;
  const status = payload.status;
  if (status !== "processing" && status !== "failed") return payload;
  const hasImage = typeof payload.referenceImageUrl === "string" && payload.referenceImageUrl.trim().length > 0;
  if (status === "processing") return { ...payload, status: undefined, errorMessage: undefined };
  if (status === "failed" && hasImage) return { ...payload, status: undefined, errorMessage: undefined };
  return payload; // failed 且无图：真实失败，保留给 #304 失败诊断
}
