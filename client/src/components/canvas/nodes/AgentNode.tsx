import { memo, useState, useRef, useEffect } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { AgentNodeData, AgentMessage, AgentOperation } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Loader2, Send, Check, Plus, Link2, Pencil, Trash2 } from "lucide-react";
import { LLMModelPicker, type LLMModelId } from "../LLMModelPicker";
import { NodeTextArea } from "../NodeTextInput";
import { applyAgentOperations, buildGraphSummary } from "@/lib/agentApply";
import { getNodeConfig } from "../../../lib/nodeConfig";

interface Props {
  id: string;
  selected?: boolean;
  data: { nodeType: "agent"; title: string; payload: AgentNodeData; projectId: number };
}

const accent = "oklch(0.70 0.20 310)";
const accentA = (a: number) => `oklch(0.70 0.20 310 / ${a})`;
const DEFAULT_LLM: LLMModelId = "claude-sonnet-4-5-20250929";

const OP_META: Record<AgentOperation["op"], { Icon: typeof Plus; label: string }> = {
  create: { Icon: Plus, label: "新建" },
  connect: { Icon: Link2, label: "连接" },
  update: { Icon: Pencil, label: "更新" },
  delete: { Icon: Trash2, label: "删除" },
};

function opText(op: AgentOperation): string {
  if (op.op === "create") return `${getNodeConfig(op.nodeType!).label}${op.title ? ` · ${op.title}` : ""}`;
  if (op.op === "connect") return `${op.sourceRef} → ${op.targetRef}`;
  if (op.op === "update") return `${op.targetRef}`;
  return `${op.targetRef}`;
}

export const AgentNode = memo(function AgentNode({ id, selected, data }: Props) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const payload = data.payload;
  const messages = payload.messages ?? [];
  const model = (payload.model as LLMModelId) ?? DEFAULT_LLM;

  const [input, setInput] = useState("");
  const [appliedIdx, setAppliedIdx] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const chat = trpc.agent.chat.useMutation();

  const setMessages = (msgs: AgentMessage[]) => updateNodeData(id, { messages: msgs });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, chat.isPending]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || chat.isPending) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const summary = buildGraphSummary(id);
    const afterUser: AgentMessage[] = [...messages, { role: "user", content: text }];
    setMessages(afterUser);
    setInput("");
    try {
      const r = await chat.mutateAsync({
        projectId: data.projectId, message: text, history,
        graphSummary: summary || undefined, model,
      });
      setMessages([...afterUser, { role: "assistant", content: r.reply, operations: r.operations }]);
    } catch (e) {
      setMessages([...afterUser, { role: "assistant", content: "处理失败：" + (e instanceof Error ? e.message : ""), operations: [] }]);
    }
  };

  const handleApply = (msgIdx: number, ops: AgentOperation[]) => {
    const pos = useCanvasStore.getState().nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
    const r = applyAgentOperations(ops, pos);
    setAppliedIdx((prev) => new Set(prev).add(msgIdx));
    const parts = [r.created && `新建 ${r.created}`, r.connected && `连接 ${r.connected}`, r.updated && `更新 ${r.updated}`, r.deleted && `删除 ${r.deleted}`].filter(Boolean);
    toast.success(parts.length ? `已应用：${parts.join(" · ")}` : "无可应用的操作");
  };

  return (
    <BaseNode id={id} selected={selected} nodeType="agent" title={data.title} minHeight={420} resizable showHandles={false}>
      <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
        {/* Messages */}
        <div ref={scrollRef} className="nodrag nowheel" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.length === 0 && (
            <div style={{ margin: "auto", textAlign: "center", color: "var(--c-t4)", fontSize: 11, lineHeight: 1.7, padding: "20px 8px" }}>
              <Sparkles className="w-5 h-5" style={{ color: accent, margin: "0 auto 8px" }} />
              用一句话描述你想做的视频，<br />我会帮你在画布上搭好节点工作流。<br />
              <span style={{ color: "var(--c-t3)" }}>例：「做一条 15 秒三分镜赛博朋克竖屏宣传片」</span>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "92%" }}>
              <div style={{
                fontSize: 12, lineHeight: 1.6, padding: "7px 10px", borderRadius: 10,
                background: m.role === "user" ? accentA(0.14) : "var(--c-surface)",
                border: `1px solid ${m.role === "user" ? accentA(0.3) : "var(--c-bd1)"}`,
                color: "var(--c-t1)", whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {m.content}
              </div>
              {m.role === "assistant" && m.operations && m.operations.length > 0 && (
                <div style={{ marginTop: 6, border: `1px solid ${accentA(0.28)}`, borderRadius: 10, overflow: "hidden", background: accentA(0.06) }}>
                  <div style={{ padding: "6px 9px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {m.operations.map((op, j) => {
                      const { Icon, label } = OP_META[op.op];
                      return (
                        <div key={j} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--c-t2)" }}>
                          <Icon className="w-3 h-3" style={{ color: accent, flexShrink: 0 }} />
                          <span style={{ color: accent, fontWeight: 600, flexShrink: 0 }}>{label}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={op.note || opText(op)}>{opText(op)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => handleApply(i, m.operations!)}
                    disabled={appliedIdx.has(i)}
                    className="nodrag"
                    style={{
                      width: "100%", padding: "6px", fontSize: 11, fontWeight: 600, cursor: appliedIdx.has(i) ? "default" : "pointer",
                      background: appliedIdx.has(i) ? "var(--c-surface)" : accentA(0.18),
                      color: appliedIdx.has(i) ? "var(--c-t4)" : accent,
                      border: "none", borderTop: `1px solid ${accentA(0.25)}`,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    }}
                  >
                    {appliedIdx.has(i) ? <><Check className="w-3.5 h-3.5" />已应用到画布</> : <><Sparkles className="w-3.5 h-3.5" />应用到画布（{m.operations.length} 步）</>}
                  </button>
                </div>
              )}
            </div>
          ))}
          {chat.isPending && (
            <div style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--c-t3)", padding: "7px 10px" }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accent }} />规划中…
            </div>
          )}
        </div>

        {/* Composer */}
        <div style={{ flexShrink: 0, borderTop: "1px solid var(--c-bd1)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 7 }}>
          <LLMModelPicker value={model} onChange={(m) => updateNodeData(id, { model: m })} disabled={chat.isPending} />
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
            <NodeTextArea
              className="nodrag nowheel"
              placeholder="描述你想做的视频，Ctrl/⌘+Enter 发送"
              value={input}
              onValueChange={setInput}
              rows={2}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleSend(); } }}
              style={{
                flex: 1, fontSize: 12, padding: "7px 10px", background: "var(--c-input)", borderRadius: 8,
                borderWidth: 1, borderStyle: "solid", borderColor: "var(--c-bd2)", color: "var(--c-t1)",
                outline: "none", resize: "none", lineHeight: 1.5,
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = accentA(0.6); }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--c-bd2)"; }}
            />
            <button
              onClick={handleSend}
              disabled={chat.isPending || !input.trim()}
              className="nodrag flex items-center justify-center flex-shrink-0"
              title="发送（Ctrl/⌘+Enter）"
              style={{
                width: 34, height: 34, borderRadius: 8, border: "none",
                background: chat.isPending || !input.trim() ? "var(--c-surface)" : accent,
                color: chat.isPending || !input.trim() ? "var(--c-t4)" : "oklch(0.99 0 0)",
                cursor: chat.isPending || !input.trim() ? "not-allowed" : "pointer",
              }}
            >
              {chat.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </BaseNode>
  );
});
