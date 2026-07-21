// #315 生成结果找回：失败消息里的 RECOVERABLE 结构化标记解析。
//
// 服务端在「任务已提交但等待超时」的错误消息尾部附 `[RECOVERABLE:<provider>:<taskId>]`
// （见 server/_core/imageGeneration.ts Poyo 超时路径）。前端失败红条据此显示「重新检测」
// 按钮——平台侧任务后续完成时免费取回结果，不必重掏钱重生成。显示错误文本时应剥掉
// 标记串（对用户是噪声）。纯函数。
const MARKER_RE = /\s*\[RECOVERABLE:(poyo):([A-Za-z0-9_-]{4,128})\]/;

export function parseRecoverableTask(msg: string | undefined | null): { provider: "poyo"; taskId: string } | null {
  if (!msg) return null;
  const m = MARKER_RE.exec(msg);
  return m ? { provider: m[1] as "poyo", taskId: m[2] } : null;
}

/** 展示用：剥掉标记串（无标记时原样返回）。 */
export function stripRecoverableMarker(msg: string): string {
  return msg.replace(MARKER_RE, "").trim();
}
