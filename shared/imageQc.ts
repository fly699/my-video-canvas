// A1 生成质检回环（图像）：结构化质检判定的类型 + 解析 + 重试提示词组装。
// 纯函数、前后端共享真相源（服务端解析 LLM 输出；客户端组装带修正意见的重试提示词）。

export interface QcVerdict {
  /** 是否可直接采用（只抓硬伤：畸形/黑屏/乱码水印/严重不符，不苛求风格）。 */
  pass: boolean;
  /** 0-100 综合分（仅供展示排序，pass 才是采纳依据）。 */
  score: number;
  /** 问题清单（pass=true 时为空数组）。 */
  issues: string[];
  /** 一句可直接附加进生成提示词的正向修正指令（pass=true 时为空串）。 */
  suggestion: string;
}

/** 从 LLM 输出文本中解析质检判定。容忍 markdown 代码块/前后杂讯；pass 容忍
 *  字符串 "true"/"false"；字段越界一律夹取/截断。解析不出合法判定返回 null。 */
export function parseQcVerdict(text: string): QcVerdict | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
  let pass: boolean;
  if (typeof parsed.pass === "boolean") pass = parsed.pass;
  else if (parsed.pass === "true") pass = true;
  else if (parsed.pass === "false") pass = false;
  else return null;
  const scoreRaw = typeof parsed.score === "number" ? parsed.score : Number(parsed.score);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : (pass ? 80 : 40);
  const issues = (Array.isArray(parsed.issues) ? parsed.issues : [])
    .map((i) => String(i ?? "").trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 5);
  const suggestion = String(parsed.suggestion ?? "").trim().slice(0, 200);
  // 一致性兜底：未过却没给任何信息时不视为合法判定（无法指导重试/展示）。
  if (!pass && issues.length === 0 && !suggestion) return null;
  return { pass, score, issues, suggestion: pass ? "" : suggestion };
}

/** 质检修正段落的标记。重试时用它替换（而非叠加）上一次的修正意见，避免多轮质检
 *  把提示词越垒越长。 */
export const QC_FIX_TAG = "【质检修正】";

/** 把质检修正意见并进原提示词：剥掉已有的修正段，追加新的一段。suggestion 为空
 *  则原样返回（剥掉旧修正段后的）基础提示词。 */
export function buildQcRetryPrompt(origPrompt: string, suggestion: string): string {
  const base = (origPrompt ?? "").split(QC_FIX_TAG)[0].trimEnd();
  const s = (suggestion ?? "").trim();
  if (!s) return base;
  return `${base}\n${QC_FIX_TAG}${s}`;
}
