// #315/#317 生成结果找回：失败消息里的 RECOVERABLE 结构化标记解析。
//
// 服务端在「任务已提交但等待超时」的错误消息尾部附标记（Poyo/kie 图像超时路径）：
//   [RECOVERABLE:poyo:<taskId>]            —— Poyo 图像
//   [RECOVERABLE:kie:<endpoint>:<taskId>]  —— kie 图像（三种 record 端点形态之一）
// 前端失败红条据此显示「重新检测」按钮——平台侧任务后续完成时免费取回结果，不必
// 重掏钱重生成。显示错误文本时应剥掉标记串（对用户是噪声）。纯函数。
const MARKER_RE = /\s*\[RECOVERABLE:(poyo|kie):(?:([a-z0-9-]{2,24}):)?([A-Za-z0-9_-]{4,128})\]/;

export function parseRecoverableTask(msg: string | undefined | null): { provider: "poyo" | "kie"; taskId: string; endpoint?: string } | null {
  if (!msg) return null;
  const m = MARKER_RE.exec(msg);
  if (!m) return null;
  return { provider: m[1] as "poyo" | "kie", taskId: m[3], ...(m[2] ? { endpoint: m[2] } : {}) };
}

/** 展示用：剥掉标记串（无标记时原样返回）。 */
export function stripRecoverableMarker(msg: string): string {
  return msg.replace(MARKER_RE, "").trim();
}
