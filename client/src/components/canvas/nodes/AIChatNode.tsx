import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { AIChatNodeData } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Send, Loader2, Trash2, Bot, User, Sparkles, ChevronDown } from "lucide-react";

const MODELS = [
  { id: "gemini-2.5-flash",          label: "Gemini 2.5 Flash",  tag: "默认" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5",  tag: "快速" },
  { id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6", tag: "智能" },
  { id: "gpt-5.2",                   label: "GPT-5.2",           tag: "Poyo" },
] as const;
// Streamdown removed — replaced with safe inline markdown renderer to avoid ReactFlow DOM conflicts
function SimpleMarkdown({ children }: { children: string }) {
  // Convert basic markdown to safe HTML
  const html = children
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br/>");
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "ai_chat";
    title: string;
    payload: AIChatNodeData;
    projectId: number;
  };
}

const accentColor = "oklch(0.70 0.18 200)";
const BORDER_DEFAULT = "oklch(0.20 0.008 260)";
const BORDER_FOCUS   = `${accentColor.slice(0, -1)} / 0.5)`;

export const AIChatNode = memo(function AIChatNode({ id, selected, data }: Props) {
  const { updateNodeData, nodes, edges } = useCanvasStore();
  const payload = data.payload;
  const [input, setInput] = useState("");
  const [localMessages, setLocalMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>(
    payload.messages ?? []
  );
  const [model, setModel] = useState<string>(payload.model ?? "gemini-2.5-flash");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { updateNodeData(id, { messages: localMessages }); }, [localMessages]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [localMessages]);

  const sendMutation = trpc.aiChat.sendMessage.useMutation({
    onSuccess: (result) => {
      setLocalMessages((prev) => [...prev, { role: "assistant", content: result.content }]);
    },
    onError: (err) => {
      toast.error("AI 响应失败：" + err.message);
      setLocalMessages((prev) => prev.slice(0, -1));
    },
  });

  const clearMutation = trpc.aiChat.clearMessages.useMutation({
    onSuccess: () => { setLocalMessages([]); toast.success("对话已清除"); },
    onError: (err) => toast.error("清除失败：" + err.message),
  });

  const buildContext = useCallback(() => {
    // Auto-include nodes connected via incoming edges + any explicitly set contextNodeIds
    const edgeSourceIds = edges.filter((e) => e.target === id).map((e) => e.source);
    const contextIds = Array.from(new Set([...(payload.contextNodeIds ?? []), ...edgeSourceIds]));
    if (!contextIds.length) return undefined;
    const parts: string[] = [];
    for (const nodeId of contextIds) {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) continue;
      const p = node.data.payload as Record<string, unknown>;
      const content =
        (p.content as string) ||
        (p.description as string) ||
        (p.positivePrompt as string) ||
        (p.prompt as string) ||
        "";
      if (content) parts.push(`[${node.data.title}]: ${content}`);
    }
    return parts.join("\n\n") || undefined;
  }, [id, nodes, edges, payload.contextNodeIds]);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg || sendMutation.isPending) return;
    setInput("");
    setLocalMessages((prev) => [...prev, { role: "user", content: msg }]);
    sendMutation.mutate({ nodeId: id, projectId: data.projectId, message: msg, systemPrompt: payload.systemPrompt, contextContent: buildContext(), model });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const onFocusInput = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = BORDER_FOCUS; };
  const onBlurInput  = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; };

  return (
    <BaseNode id={id} selected={selected} nodeType="ai_chat" title={data.title} minHeight={320}>
      <div className="flex flex-col h-full" style={{ minHeight: 280 }}>

        {/* ── System prompt ── */}
        <div
          className="px-2.5 py-2 flex-shrink-0"
          style={{ borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: "oklch(0.18 0.008 260)" }}
        >
          <input
            placeholder="系统提示词（可选）"
            value={payload.systemPrompt ?? ""}
            onChange={(e) => updateNodeData(id, { systemPrompt: e.target.value })}
            className="nodrag w-full"
            style={{
              fontSize: 10,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "oklch(0.55 0.008 260)",
            }}
          />
        </div>

        {/* ── Model selector ── */}
        <div
          className="px-2.5 py-1.5 flex items-center gap-1.5 flex-shrink-0 relative"
          style={{ borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: "oklch(0.18 0.008 260)" }}
        >
          <span style={{ fontSize: 9, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: "oklch(0.38 0.006 260)" }}>模型</span>
          <button
            className="nodrag flex items-center gap-1 px-2 py-0.5 rounded-md transition-all"
            style={{
              fontSize: 10, fontWeight: 500,
              background: "oklch(0.13 0.007 260)",
              border: showModelPicker ? "1px solid oklch(0.68 0.22 285 / 0.45)" : "1px solid oklch(0.22 0.008 260)",
              color: "oklch(0.72 0.20 330)",
              cursor: "pointer",
            }}
            onClick={() => setShowModelPicker(!showModelPicker)}
          >
            {MODELS.find((m) => m.id === model)?.label ?? model}
            <ChevronDown style={{ width: 9, height: 9, opacity: 0.7 }} />
          </button>
          {/* Model dropdown */}
          {showModelPicker && (
            <div
              className="absolute left-2.5 top-8 z-50 rounded-xl overflow-hidden animate-scale-in"
              style={{
                background: "oklch(0.12 0.007 260)",
                border: "1px solid oklch(0.22 0.008 260)",
                boxShadow: "0 8px 32px oklch(0 0 0 / 0.55)",
                minWidth: 200,
              }}
            >
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  className="nodrag w-full flex items-center justify-between px-3 py-2 transition-all text-left"
                  style={{
                    background: model === m.id ? "oklch(0.72 0.20 330 / 0.10)" : "transparent",
                    borderBottom: "1px solid oklch(0.17 0.008 260)",
                    cursor: "pointer",
                  }}
                  onClick={() => { setModel(m.id); updateNodeData(id, { model: m.id }); setShowModelPicker(false); }}
                  onMouseEnter={(e) => { if (model !== m.id) (e.currentTarget as HTMLElement).style.background = "oklch(0.16 0.008 260)"; }}
                  onMouseLeave={(e) => { if (model !== m.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <span style={{ fontSize: 11, color: model === m.id ? "oklch(0.72 0.20 330)" : "oklch(0.75 0.006 260)", fontWeight: model === m.id ? 500 : 400 }}>
                    {m.label}
                  </span>
                  <span style={{ fontSize: 9, color: "oklch(0.45 0.008 260)", background: "oklch(0.18 0.008 260)", borderRadius: 99, padding: "1px 6px", letterSpacing: "0.04em" }}>
                    {m.tag}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Messages ── */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-2.5 py-2 nodrag"
          style={{ minHeight: 120, maxHeight: 280 }}
        >
          {localMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-24 gap-2">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{
                  background: `${accentColor.slice(0, -1)} / 0.15)`,
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: `${accentColor.slice(0, -1)} / 0.3)`,
                }}
              >
                <Sparkles className="w-4 h-4" style={{ color: accentColor }} />
              </div>
              <p className="text-[10px] text-center" style={{ color: "oklch(0.38 0.006 260)" }}>
                发送消息开始 AI 对话
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {localMessages.map((msg, i) => (
                <div key={i} className={`flex gap-1.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  {/* Avatar */}
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{
                      background: msg.role === "user"
                        ? "oklch(0.68 0.22 285 / 0.20)"
                        : `${accentColor.slice(0, -1)} / 0.18)`,
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: msg.role === "user"
                        ? "oklch(0.68 0.22 285 / 0.35)"
                        : `${accentColor.slice(0, -1)} / 0.3)`,
                    }}
                  >
                    {msg.role === "user" ? (
                      <User className="w-2.5 h-2.5" style={{ color: "oklch(0.68 0.22 285)" }} />
                    ) : (
                      <Bot className="w-2.5 h-2.5" style={{ color: accentColor }} />
                    )}
                  </div>
                  {/* Bubble */}
                  <div
                    className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed"
                    style={{
                      background: msg.role === "user"
                        ? "oklch(0.68 0.22 285 / 0.10)"
                        : `${accentColor.slice(0, -1)} / 0.04)`,
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: msg.role === "user"
                        ? "oklch(0.68 0.22 285 / 0.20)"
                        : `${accentColor.slice(0, -1)} / 0.18)`,
                      color: "oklch(0.80 0.006 260)",
                    }}
                  >
                    {msg.role === "assistant" ? (
                      <SimpleMarkdown>{msg.content}</SimpleMarkdown>
                    ) : (
                      <span>{msg.content}</span>
                    )}
                  </div>
                </div>
              ))}
              {/* Loading bubble */}
              {sendMutation.isPending && (
                <div className="flex gap-1.5">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      background: `${accentColor.slice(0, -1)} / 0.18)`,
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: `${accentColor.slice(0, -1)} / 0.3)`,
                    }}
                  >
                    <Bot className="w-2.5 h-2.5" style={{ color: accentColor }} />
                  </div>
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                    style={{
                      background: `${accentColor.slice(0, -1)} / 0.04)`,
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: `${accentColor.slice(0, -1)} / 0.18)`,
                    }}
                  >
                    <Loader2 className="w-3 h-3 animate-spin" style={{ color: accentColor }} />
                    <span className="text-[10px]" style={{ color: "oklch(0.50 0.008 260)" }}>思考中...</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Input bar ── */}
        <div
          className="px-2.5 pb-2.5 pt-2 flex gap-1.5 flex-shrink-0"
          style={{ borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: "oklch(0.18 0.008 260)" }}
        >
          <input
            ref={inputRef}
            placeholder="发送消息... (Enter 发送)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sendMutation.isPending}
            className="nodrag flex-1"
            style={{
              fontSize: 11,
              padding: "5px 8px",
              background: "oklch(0.09 0.006 260)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: BORDER_DEFAULT,
              borderRadius: 7,
              color: "oklch(0.80 0.006 260)",
              outline: "none",
              transition: "border-color 120ms ease",
            }}
            onFocus={onFocusInput}
            onBlur={onBlurInput}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sendMutation.isPending}
            className="nodrag w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
            style={{
              background: !input.trim() || sendMutation.isPending
                ? "oklch(0.13 0.007 260)"
                : `${accentColor.slice(0, -1)} / 0.18)`,
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: !input.trim() || sendMutation.isPending
                ? BORDER_DEFAULT
                : `${accentColor.slice(0, -1)} / 0.4)`,
              color: !input.trim() || sendMutation.isPending
                ? "oklch(0.35 0.006 260)"
                : accentColor,
              cursor: !input.trim() || sendMutation.isPending ? "not-allowed" : "pointer",
            }}
          >
            {sendMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          </button>
          <button
            onClick={() => clearMutation.mutate({ nodeId: id, projectId: data.projectId })}
            disabled={localMessages.length === 0}
            className="nodrag w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
            style={{
              background: "transparent",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "transparent",
              color: localMessages.length === 0 ? "oklch(0.28 0.006 260)" : "oklch(0.45 0.008 260)",
              cursor: localMessages.length === 0 ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => {
              if (localMessages.length > 0) {
                (e.currentTarget as HTMLElement).style.background = "oklch(0.62 0.20 25 / 0.10)";
                (e.currentTarget as HTMLElement).style.color = "oklch(0.62 0.20 25)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = localMessages.length === 0 ? "oklch(0.28 0.006 260)" : "oklch(0.45 0.008 260)";
            }}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </BaseNode>
  );
});
