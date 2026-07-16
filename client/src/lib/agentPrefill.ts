// AI 客户端「进入画布并发送至画布助手」的跨页/跨组件传递通道。
// 用 sessionStorage 承载文本（可跨 wouter 路由切换存活，且不受 URL 长度限制），
// 同时派发一个 window 事件供「已在画布内」的实时场景（嵌入式 AI 客户端）即时消费。
const KEY = "avc:agent-prefill";
export const AGENT_PREFILL_EVENT = "avc:agent-prefill";

type Pending = { projectId: number; text: string };

/** 请求把 text 填入指定项目画布助手的输入框：写入 sessionStorage + 派发事件。 */
export function requestAgentPrefill(projectId: number, text: string): void {
  const t = (text ?? "").trim();
  if (!projectId || !t) return;
  try { sessionStorage.setItem(KEY, JSON.stringify({ projectId, text: t } satisfies Pending)); } catch { /* storage 受限则仅走事件 */ }
  try { window.dispatchEvent(new CustomEvent(AGENT_PREFILL_EVENT)); } catch { /* SSR/无 window */ }
}

function read(projectId: number): Pending | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Pending>;
    if (typeof p.projectId !== "number" || p.projectId !== projectId) return null; // 非本画布：保留待其消费
    if (typeof p.text !== "string" || !p.text.trim()) return null;
    return { projectId: p.projectId, text: p.text };
  } catch { return null; }
}

/** 是否有属于该项目的待填内容（不消费）——供画布页决定是否自动打开画布助手。 */
export function hasAgentPrefill(projectId: number): boolean {
  return read(projectId) !== null;
}

/** 取出并清除属于该项目的待填内容（消费一次）。 */
export function consumeAgentPrefill(projectId: number): string | null {
  const p = read(projectId);
  if (!p) return null;
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  return p.text;
}
