// AI 客户端「进入画布并发送至画布助手」的跨页/跨组件传递通道。
// 用 sessionStorage 承载文本（可跨 wouter 路由切换存活，且不受 URL 长度限制），
// 同时派发一个 window 事件供「已在画布内」的实时场景（嵌入式 AI 客户端）即时消费。
const KEY = "avc:agent-prefill";
// 「进入画布后关闭浮动 AI 客户端」的独立信号（与待填文本分开，避免和画布助手的消费竞态）。
const CLOSE_KEY = "avc:agent-prefill-close-client";
export const AGENT_PREFILL_EVENT = "avc:agent-prefill";

type Pending = { projectId: number; text: string };

/** 请求把 text 填入指定项目画布助手的输入框：写入 sessionStorage（待填文本 + 关闭客户端信号）+ 派发事件。 */
export function requestAgentPrefill(projectId: number, text: string): void {
  const t = (text ?? "").trim();
  if (!projectId || !t) return;
  try { sessionStorage.setItem(KEY, JSON.stringify({ projectId, text: t } satisfies Pending)); } catch { /* storage 受限则仅走事件 */ }
  try { sessionStorage.setItem(CLOSE_KEY, String(projectId)); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(AGENT_PREFILL_EVENT)); } catch { /* SSR/无 window */ }
}

/** 浮动 AI 客户端消费「进入画布后自动关闭」信号（一次性；仅匹配本 projectId）。 */
export function consumeCloseAiClient(projectId: number): boolean {
  try {
    const raw = sessionStorage.getItem(CLOSE_KEY);
    if (raw == null || Number(raw) !== projectId) return false;
    sessionStorage.removeItem(CLOSE_KEY);
    return true;
  } catch { return false; }
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
