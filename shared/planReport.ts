// 规划排查报告：把一次「有内容未落地」的回合汇成可复制的纯文本，便于用户反馈/定位。
// 纯函数、framework-free、可单测。仅拼接已有回合数据，不含任何隐私外的额外信息。

export interface PlanReportInput {
  /** 本回合对应的用户请求原文。 */
  request?: string;
  /** 助手回复文本。 */
  reply?: string;
  /** 已落地摘要（applied）。 */
  applied?: string;
  /** 失败/未落地摘要（failed）。 */
  failed?: string;
  /** 掉单原因逐条（服务端 sanitize 丢弃的操作原因）。 */
  dropped?: string[];
  /** 本回合新建节点数。 */
  createdCount?: number;
}

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + "…" : s);

/** 生成可读的排查报告文本。空字段自动省略；掉单原因逐条列出。纯函数。 */
export function buildPlanReport(input: PlanReportInput): string {
  const lines: string[] = ["【画布助手规划排查报告】"];
  const req = input.request?.trim();
  if (req) lines.push(`请求：${clip(req, 500)}`);
  const reply = input.reply?.trim();
  if (reply) lines.push(`回复：${clip(reply, 500)}`);
  const applied = input.applied?.trim();
  lines.push(`已落地：${applied || "无"}`);
  const failed = input.failed?.trim();
  if (failed) lines.push(`未落地/失败：${clip(failed, 500)}`);
  if (typeof input.createdCount === "number") lines.push(`新建节点：${input.createdCount}`);
  const dropped = (input.dropped ?? []).map((d) => d.trim()).filter(Boolean);
  if (dropped.length) {
    lines.push(`掉单原因（${dropped.length} 类）：`);
    for (const d of dropped) lines.push(`- ${clip(d, 300)}`);
  }
  return lines.join("\n");
}
