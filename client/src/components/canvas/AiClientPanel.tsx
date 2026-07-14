import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import { Bot, Plus, Minus, X, Send, Loader2, MessageSquare, AtSign, Download } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { useAiClient } from "../../hooks/useAiClient";
import { deriveAiSessions, resolveActiveSession } from "@/lib/aiClientSessions";
import { buildNodeContextContent, isReferableNode, nodeContextLabel, planMessageDrop, type ChatMsgAttachment } from "@/lib/aiClientContext";
import { LLM_MODELS } from "@/lib/models";
import { trpc } from "@/lib/trpc";
import type { NodeType } from "../../../../shared/types";

// ── 全局悬浮「AI 客户端」(综合 Claude/GPT/Grok 取长) ─────────────────────────────
// Cmd/Ctrl+J 呼出/最小化；左侧会话列表「同源」于画布 ai_chat 节点（会话即节点），中间对话流，
// 底部大输入框，顶部模型下拉。收发复用 aiChat.getMessages / sendMessage（与节点同一后端，数据互通）。
// 互通②③（@引用节点上下文 / 回答落成节点 / 素材库）在后续批次接入。

const ACCENT = "oklch(0.70 0.20 300)";

export function AiClientPanel() {
  const reactFlow = useReactFlow();
  const { open, minimized, activeNodeId, close, setMinimized, setActive } = useAiClient();
  const nodes = useCanvasStore((s) => s.nodes);
  const projectId = useCanvasStore((s) => s.projectId);
  const utils = trpc.useUtils();

  const sessions = useMemo(() => deriveAiSessions(nodes), [nodes]);
  // 保持激活会话（若被删则回落到第一个）。
  const active = useMemo(() => resolveActiveSession(sessions, activeNodeId), [sessions, activeNodeId]);
  useEffect(() => { if (active !== activeNodeId) setActive(active); }, [active, activeNodeId, setActive]);

  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>(LLM_MODELS.find((m) => m.tag === "默认")?.id ?? LLM_MODELS[0].id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 当前会话引用的上下文节点（存在 ai_chat 节点 payload.contextNodeIds，与画布对话节点同源）。
  const activeNode = useMemo(() => nodes.find((n) => n.id === active), [nodes, active]);
  const contextIds = useMemo(
    () => ((activeNode?.data.payload as { contextNodeIds?: string[] } | undefined)?.contextNodeIds) ?? [],
    [activeNode],
  );
  // 可引用的画布节点（排除本会话自身与非文本类）。
  const referable = useMemo(() => nodes.filter((n) => n.id !== active && isReferableNode(n)), [nodes, active]);
  const setContextIds = (ids: string[]) => { if (active) useCanvasStore.getState().updateNodeData(active, { contextNodeIds: ids }, true); };
  const toggleContext = (nodeId: string) => setContextIds(contextIds.includes(nodeId) ? contextIds.filter((x) => x !== nodeId) : [...contextIds, nodeId]);

  const msgQuery = trpc.aiChat.getMessages.useQuery(
    { nodeId: active ?? "", projectId: projectId ?? 0 },
    { enabled: open && !minimized && !!active && !!projectId },
  );
  const messages = msgQuery.data ?? [];

  const sendMut = trpc.aiChat.sendMessage.useMutation({
    onSuccess: () => {
      if (active && projectId) void utils.aiChat.getMessages.invalidate({ nodeId: active, projectId });
    },
    onError: (err) => toast.error("发送失败：" + err.message),
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, sendMut.isPending]);

  // 回写节点 payload.messages，让画布上的 ai_chat 节点即时反映服务端权威消息（数据同源）。
  useEffect(() => {
    if (!active || !msgQuery.data) return;
    const stripped = msgQuery.data
      .filter((m): m is typeof m & { role: "user" | "assistant" } => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));
    useCanvasStore.getState().updateNodeData(active, { messages: stripped }, true);
  }, [active, msgQuery.data]);

  const newSession = () => {
    const pos = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const node = useCanvasStore.getState().addNode("ai_chat", pos);
    setActive(node.id);
    toast.success("已新建会话（画布上已生成对应 AI 对话节点）");
  };

  const send = () => {
    const text = input.trim();
    if (!text || sendMut.isPending) return;
    if (!active) { newSession(); toast.info("已建会话，请再次发送"); return; }
    if (!projectId) { toast.error("画布未就绪"); return; }
    setInput("");
    const contextContent = buildNodeContextContent(nodes, contextIds);
    sendMut.mutate({
      nodeId: active, projectId, message: text, model,
      ...(contextContent ? { contextContent } : {}),
      ...(model.startsWith("kie_") ? { kieTempKey: localStorage.getItem("kie:tempKey") || undefined } : {}),
    });
  };

  // 回答一键落成画布节点（文本→便签、图片附件→图像节点）。
  const dropToCanvas = (content: string, attachments?: ChatMsgAttachment[]) => {
    const plans = planMessageDrop(content, attachments);
    if (plans.length === 0) { toast.error("这条回答没有可落成的内容"); return; }
    const base = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2 - 120, y: window.innerHeight / 2 - 80 });
    let created = 0;
    plans.forEach((plan, i) => {
      const node = useCanvasStore.getState().addNode(plan.nodeType as NodeType, { x: base.x + i * 40, y: base.y + i * 40 });
      useCanvasStore.getState().updateNodeData(node.id, plan.payload);
      created++;
    });
    toast.success(`已落成 ${created} 个画布节点`);
  };

  if (!open) return null;

  // 最小化：右下角悬浮小球。
  if (minimized) {
    return createPortal(
      <button
        onClick={() => setMinimized(false)}
        title="展开 AI 客户端（Cmd/Ctrl+J）"
        style={{
          position: "fixed", right: 22, bottom: 22, zIndex: 210, width: 52, height: 52, borderRadius: "50%",
          border: "none", cursor: "pointer", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: `linear-gradient(135deg, ${ACCENT}, oklch(0.66 0.2 320))`, boxShadow: "0 8px 24px oklch(0.66 0.2 300 / 0.45)",
        }}
      >
        <Bot size={24} />
      </button>,
      document.body,
    );
  }

  const modelLabel = LLM_MODELS.find((m) => m.id === model)?.label ?? model;

  return createPortal(
    <div
      className="nodrag"
      style={{
        position: "fixed", right: 22, bottom: 22, zIndex: 210, width: "min(760px, 94vw)", height: "min(600px, 86vh)",
        display: "flex", flexDirection: "column", background: "var(--c-surface)", border: "1px solid var(--c-bd2)",
        borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.45)", overflow: "hidden",
      }}
    >
      {/* 顶栏 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--c-bd1)" }}>
        <span style={{ display: "inline-flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 8, background: `color-mix(in oklch, ${ACCENT} 16%, transparent)`, color: ACCENT }}><Bot size={16} /></span>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--c-t1)" }}>AI 客户端</span>
        <select value={model} onChange={(e) => setModel(e.target.value)} className="nodrag"
          style={{ marginLeft: 6, fontSize: 11.5, padding: "4px 8px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", outline: "none", maxWidth: 200 }}
          title={`当前模型：${modelLabel}`}>
          {LLM_MODELS.filter((m) => !m.hidden).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={() => setMinimized(true)} title="最小化（Cmd/Ctrl+J）" style={iconBtn}><Minus size={16} /></button>
        <button onClick={close} title="关闭" style={iconBtn}><X size={16} /></button>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* 会话侧栏（同源于 ai_chat 节点） */}
        <div style={{ width: 196, flexShrink: 0, borderRight: "1px solid var(--c-bd1)", display: "flex", flexDirection: "column", background: "var(--c-bg, var(--c-surface))" }}>
          <button onClick={newSession} className="nodrag"
            style={{ margin: 10, padding: "8px 10px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: "none", color: "#fff", background: ACCENT }}>
            <Plus size={14} /> 新会话
          </button>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
            {sessions.length === 0 && <div style={{ fontSize: 11.5, color: "var(--c-t4)", padding: "12px 6px", lineHeight: 1.6 }}>还没有会话。点「新会话」开始——每个会话都会在画布上生成一个 AI 对话节点，数据互通。</div>}
            {sessions.map((s) => {
              const on = s.nodeId === active;
              return (
                <button key={s.nodeId} onClick={() => setActive(s.nodeId)} className="nodrag" title={s.title}
                  style={{ width: "100%", textAlign: "left", marginBottom: 4, padding: "8px 9px", borderRadius: 9, cursor: "pointer",
                    border: `1px solid ${on ? ACCENT : "transparent"}`, background: on ? `color-mix(in oklch, ${ACCENT} 10%, transparent)` : "transparent", color: "var(--c-t1)" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <MessageSquare size={12} style={{ flexShrink: 0, color: on ? ACCENT : "var(--c-t4)" }} />
                    <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                  </span>
                  {s.preview && <span style={{ display: "block", fontSize: 10.5, color: "var(--c-t4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{s.preview}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* 对话流 + 输入 */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            {!active && <div style={{ margin: "auto", textAlign: "center", color: "var(--c-t4)", fontSize: 13 }}><Bot size={30} style={{ opacity: 0.5 }} /><div style={{ marginTop: 8 }}>选择或新建一个会话开始对话</div></div>}
            {active && messages.length === 0 && !msgQuery.isLoading && <div style={{ margin: "auto", textAlign: "center", color: "var(--c-t4)", fontSize: 13 }}>开始你的第一句对话吧</div>}
            {active && msgQuery.isLoading && <div style={{ margin: "auto", color: "var(--c-t4)" }}><Loader2 size={20} className="animate-spin" /></div>}
            {messages.map((m, i) => {
              const atts = (m as { attachments?: ChatMsgAttachment[] }).attachments;
              return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: 3 }}>
                <div style={{
                  maxWidth: "82%", padding: "9px 13px", borderRadius: 13, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  background: m.role === "user" ? `color-mix(in oklch, ${ACCENT} 18%, var(--c-input))` : "var(--c-input)",
                  color: "var(--c-t1)", border: "1px solid var(--c-bd2)",
                }}>{m.content}</div>
                {/* 回答一键落成画布节点（仅 AI 回复，且有可落成内容）。 */}
                {m.role === "assistant" && (m.content?.trim() || (atts?.length ?? 0) > 0) && (
                  <button onClick={() => dropToCanvas(m.content, atts)} className="nodrag"
                    title="把这条回答落成画布节点（文本→便签，图片→图像节点）"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--c-t4)", background: "transparent", border: "none", cursor: "pointer", padding: "0 2px" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = ACCENT; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}>
                    <Download size={11} /> 落成节点
                  </button>
                )}
              </div>
              );
            })}
            {sendMut.isPending && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ padding: "9px 13px", borderRadius: 13, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t4)" }}><Loader2 size={15} className="animate-spin" /></div>
              </div>
            )}
          </div>
          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--c-bd1)", position: "relative" }}>
            {/* 已引用的画布节点 chips + @ 添加引用（打通 contextNodeIds，作为对话上下文） */}
            {active && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", marginBottom: 7 }}>
                <button onClick={() => setPickerOpen((v) => !v)} className="nodrag"
                  title="引用画布节点作为上下文"
                  style={{ display: "inline-flex", alignItems: "center", gap: 3, height: 22, padding: "0 8px", borderRadius: 7, fontSize: 11, cursor: "pointer",
                    background: pickerOpen ? `color-mix(in oklch, ${ACCENT} 14%, transparent)` : "var(--c-input)", border: `1px solid ${pickerOpen ? ACCENT : "var(--c-bd2)"}`, color: pickerOpen ? ACCENT : "var(--c-t3)" }}>
                  <AtSign size={11} /> 引用节点
                </button>
                {contextIds.map((cid) => {
                  const n = nodes.find((x) => x.id === cid);
                  if (!n) return null;
                  return (
                    <span key={cid} style={{ display: "inline-flex", alignItems: "center", gap: 3, height: 22, padding: "0 6px 0 8px", borderRadius: 7, fontSize: 11, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", maxWidth: 160 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nodeContextLabel(n)}</span>
                      <button onClick={() => toggleContext(cid)} className="nodrag" style={{ border: "none", background: "transparent", color: "var(--c-t4)", cursor: "pointer", padding: 0, lineHeight: 1 }}><X size={11} /></button>
                    </span>
                  );
                })}
              </div>
            )}
            {/* @ 引用选择器（列出可引用画布节点） */}
            {pickerOpen && active && (
              <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()}
                style={{ position: "absolute", left: 12, right: 12, bottom: "calc(100% - 4px)", maxHeight: 240, overflowY: "auto", zIndex: 5,
                  background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.4)", padding: 6 }}>
                {referable.length === 0 && <div style={{ fontSize: 11.5, color: "var(--c-t4)", padding: "10px 8px" }}>画布上暂无可引用的节点（脚本/分镜/提示词/图像/角色/便签等）。</div>}
                {referable.map((n) => {
                  const on = contextIds.includes(n.id);
                  return (
                    <button key={n.id} onClick={() => toggleContext(n.id)} className="nodrag"
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                        border: "none", background: on ? `color-mix(in oklch, ${ACCENT} 10%, transparent)` : "transparent", color: "var(--c-t1)" }}
                      onMouseEnter={(e) => { if (!on) (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
                      onMouseLeave={(e) => { if (!on) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                      <span style={{ width: 14, flexShrink: 0, color: on ? ACCENT : "var(--c-t4)" }}>{on ? "✓" : ""}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nodeContextLabel(n)}</span>
                      <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--c-t4)", flexShrink: 0 }}>{n.data.nodeType}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 12, padding: "8px 10px" }}>
              <textarea
                className="nodrag nowheel"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={active ? "输入消息，Enter 发送 · Shift+Enter 换行" : "输入消息开始新会话…"}
                rows={1}
                style={{ flex: 1, resize: "none", maxHeight: 140, minHeight: 22, background: "transparent", border: "none", outline: "none", color: "var(--c-t1)", fontSize: 13, lineHeight: 1.5, fontFamily: "inherit" }}
              />
              <button onClick={send} disabled={!input.trim() || sendMut.isPending} className="nodrag"
                style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 9, border: "none", cursor: input.trim() && !sendMut.isPending ? "pointer" : "default", color: "#fff", background: input.trim() && !sendMut.isPending ? ACCENT : "var(--c-bd2)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                {sendMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const iconBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", color: "var(--c-t3)", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
