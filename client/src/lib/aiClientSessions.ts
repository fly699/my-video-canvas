// AI 客户端（全局悬浮）会话推导：会话「同源」于画布上的 ai_chat 节点——每个 ai_chat 节点即一个
// 会话。此处把画布节点列表编译成客户端左侧会话列表所需的摘要（纯函数，便于单测）。
import type { NodeType } from "../../../shared/types";

export interface AiSessionSummary {
  nodeId: string;
  title: string;       // 会话标题：节点 title → 首条用户消息前缀 → 「新会话」
  preview: string;     // 最后一条消息预览（空则空串）
  count: number;       // 消息条数
  model?: string;      // 会话所用模型（节点 payload.model）
}

type MiniMsg = { role: "user" | "assistant"; content?: string };
// 宽松入参：兼容画布 CanvasNode（其 data.payload 是各节点 union，非 ai_chat 的字段结构不同）。
// 只对 ai_chat 节点读取 messages/model，内部做窄化，故 payload 用 unknown。
type MiniNode = {
  id: string;
  data: { nodeType: NodeType; title?: string; payload?: unknown };
};

const firstLine = (s: string, cap = 40) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > cap ? t.slice(0, cap) + "…" : t;
};

/** 把画布节点编译成 ai_chat 会话列表（仅 ai_chat 节点）。标题优先取节点 title，否则取首条用户
 *  消息前缀，都没有则「新会话」。preview 取最后一条消息内容前缀。 */
export function deriveAiSessions(nodes: MiniNode[]): AiSessionSummary[] {
  const out: AiSessionSummary[] = [];
  for (const n of nodes) {
    if (n.data?.nodeType !== "ai_chat") continue;
    const p = (n.data.payload ?? {}) as { messages?: MiniMsg[]; model?: string };
    const msgs = p.messages ?? [];
    const firstUser = msgs.find((m) => m.role === "user")?.content ?? "";
    const title = (n.data.title?.trim() || firstLine(firstUser) || "新会话");
    const last = msgs.length > 0 ? (msgs[msgs.length - 1]?.content ?? "") : "";
    out.push({
      nodeId: n.id,
      title,
      preview: firstLine(last, 60),
      count: msgs.length,
      model: p.model,
    });
  }
  return out;
}

/** 选出「当前应激活」的会话 id：优先保持传入的 preferred（若仍存在），否则取第一个会话。 */
export function resolveActiveSession(sessions: AiSessionSummary[], preferred: string | null): string | null {
  if (preferred && sessions.some((s) => s.nodeId === preferred)) return preferred;
  return sessions[0]?.nodeId ?? null;
}
