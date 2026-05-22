import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { AIChatNodeData, NodeType } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Send, Loader2, Trash2, Bot, User, Sparkles, ChevronDown, ArrowRight, Copy, BookOpen } from "lucide-react";
import { CHAT_MODELS } from "@/lib/models";
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
const accentA = (a: number) => `oklch(0.70 0.18 200 / ${a})`;
const BORDER_DEFAULT = "var(--c-bd2)";
const BORDER_FOCUS   = accentA(0.5);

const FIELD_MAP: Partial<Record<NodeType, string>> = {
  script: "content",
  storyboard: "promptText",
  prompt: "positivePrompt",
  image_gen: "prompt",
  video_task: "prompt",
  note: "content",
};

const SYSTEM_PROMPT_TEMPLATES = [
  { label: "导演助手", icon: "🎬", prompt: "你是一位专业的电影导演助手，擅长分析剧本、提出视觉化建议和分镜构思。请用简洁专业的中文回答。" },
  { label: "分镜生成", icon: "🖼️", prompt: "你是专业的分镜师。根据场景描述，生成详细的分镜描述，包括：镜头类型、运镜方式、景深、灯光氛围、构图要点。每个分镜用编号列出。" },
  { label: "提示词优化", icon: "✨", prompt: "你是专业的 AI 图像提示词工程师。用户输入中文描述，你将其转化为高质量的英文 Stable Diffusion 提示词（100词以内），聚焦于视觉细节、光影、风格、构图。只输出提示词，无需解释。" },
  { label: "视频脚本", icon: "📝", prompt: "你是专业的视频脚本创作者。根据主题创作简洁有力的视频脚本，包括旁白文字、配乐建议和镜头切换节奏。" },
  { label: "角色设计", icon: "👤", prompt: "你是角色设计专家。根据描述生成详细的角色外观描述，包括：年龄体型、服装风格、表情神态、标志性特征，用于 AI 图像生成。" },
] as const;

export const AIChatNode = memo(function AIChatNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const hasDownstream = useCanvasStore(useMemo(() => (s) => s.edges.some(e => e.source === id), [id]));
  const payload = data.payload;
  const [input, setInput] = useState("");
  const [localMessages, setLocalMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>(
    payload.messages ?? []
  );
  const [model, setModel] = useState<string>(payload.model ?? "gemini-2.5-flash");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);

  useEffect(() => { updateNodeData(id, { messages: localMessages }); }, [localMessages, id, updateNodeData]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [localMessages]);

  useEffect(() => {
    if (!showModelPicker) return;
    const handler = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node))
        setShowModelPicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showModelPicker]);

  useEffect(() => {
    if (!showTemplates) return;
    const handler = (e: MouseEvent) => {
      if (templateRef.current && !templateRef.current.contains(e.target as Node))
        setShowTemplates(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTemplates]);

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

  const pushToDownstream = useCallback((content: string) => {
    const { nodes: currentNodes, edges: currentEdges, batchUpdateNodeData } = useCanvasStore.getState();
    const updates = currentEdges
      .filter(e => e.source === id)
      .flatMap(edge => {
        const targetNode = currentNodes.find(n => n.id === edge.target);
        const field = targetNode ? FIELD_MAP[targetNode.data.nodeType] : undefined;
        return field ? [{ id: edge.target, payload: { [field]: content } }] : [];
      });
    if (updates.length > 0) {
      batchUpdateNodeData(updates);
      toast.success(`已推送到 ${updates.length} 个节点`);
    } else {
      toast.error("没有可接收的下游节点");
    }
  }, [id]);

  const buildContext = useCallback(() => {
    const { nodes, edges } = useCanvasStore.getState();
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
  }, [id, payload.contextNodeIds]);

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
    <BaseNode id={id} selected={selected} nodeType="ai_chat" title={data.title} minHeight={320} resizable>
      <div className="flex flex-col h-full" style={{ minHeight: 280 }}>

        {/* ── System prompt ── */}
        <div
          ref={templateRef}
          className="px-3.5 py-2 flex items-center gap-1.5 flex-shrink-0 relative"
          style={{ borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: "var(--c-bd1)" }}
        >
          <input
            placeholder="系统提示词（可选）"
            value={payload.systemPrompt ?? ""}
            onChange={(e) => updateNodeData(id, { systemPrompt: e.target.value })}
            className="nodrag flex-1"
            style={{
              fontSize: 11,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--c-t3)",
            }}
          />
          <button
            onClick={() => setShowTemplates((v) => !v)}
            className="nodrag flex items-center gap-1 px-1.5 py-1 rounded transition-all flex-shrink-0"
            style={{
              fontSize: 9,
              background: showTemplates ? accentA(0.12) : "transparent",
              border: `1px solid ${showTemplates ? accentA(0.35) : "var(--c-bd2)"}`,
              color: showTemplates ? accentColor : "var(--c-t4)",
              cursor: "pointer",
            }}
            title="模板库"
          >
            <BookOpen style={{ width: 10, height: 10 }} />
            模板
          </button>
          {showTemplates && (
            <div
              className="absolute left-0 right-0 z-50 rounded-xl overflow-hidden"
              style={{
                top: "calc(100% + 4px)",
                background: "var(--c-base)",
                border: "1px solid var(--c-bd2)",
                boxShadow: "0 8px 32px oklch(0 0 0 / 0.55)",
              }}
            >
              {SYSTEM_PROMPT_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  className="nodrag w-full flex items-center gap-2 px-3 py-2 transition-all text-left"
                  style={{
                    borderBottom: "1px solid var(--c-bd1)",
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    updateNodeData(id, { systemPrompt: t.prompt });
                    setShowTemplates(false);
                    toast.success(`已应用模板：${t.label}`);
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <span style={{ fontSize: 14 }}>{t.icon}</span>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span style={{ fontSize: 11, fontWeight: 500, color: "var(--c-t1)" }}>{t.label}</span>
                    <span style={{ fontSize: 9.5, color: "var(--c-t4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.prompt.slice(0, 50)}...</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Model selector ── */}
        <div
          ref={modelPickerRef}
          className="px-3.5 py-2 flex items-center gap-2 flex-shrink-0 relative"
          style={{ borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: "var(--c-bd1)" }}
        >
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)" }}>模型</span>
          <button
            className="nodrag flex items-center gap-1 px-2 py-0.5 rounded-md transition-all"
            style={{
              fontSize: 10, fontWeight: 500,
              background: "var(--c-surface)",
              border: showModelPicker ? "1px solid oklch(0.68 0.22 285 / 0.45)" : "1px solid var(--c-bd2)",
              color: "oklch(0.72 0.20 330)",
              cursor: "pointer",
            }}
            onClick={() => setShowModelPicker(!showModelPicker)}
          >
            {CHAT_MODELS.find((m) => m.id === model)?.label ?? model}
            <ChevronDown style={{ width: 9, height: 9, opacity: 0.7 }} />
          </button>
          {/* Model dropdown */}
          {showModelPicker && (
            <div
              className="absolute left-2.5 top-8 z-50 rounded-xl overflow-hidden animate-scale-in"
              style={{
                background: "var(--c-base)",
                border: "1px solid var(--c-bd2)",
                boxShadow: "0 8px 32px oklch(0 0 0 / 0.55)",
                minWidth: 200,
              }}
            >
              {CHAT_MODELS.map((m) => (
                <button
                  key={m.id}
                  className="nodrag w-full flex items-center justify-between px-3 py-2 transition-all text-left"
                  style={{
                    background: model === m.id ? "oklch(0.72 0.20 330 / 0.10)" : "transparent",
                    borderBottom: "1px solid var(--c-bd1)",
                    cursor: "pointer",
                  }}
                  onClick={() => { setModel(m.id); updateNodeData(id, { model: m.id }); setShowModelPicker(false); }}
                  onMouseEnter={(e) => { if (model !== m.id) (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
                  onMouseLeave={(e) => { if (model !== m.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <span style={{ fontSize: 11, color: model === m.id ? "oklch(0.72 0.20 330)" : "var(--c-t2)", fontWeight: model === m.id ? 500 : 400 }}>
                    {m.label}
                  </span>
                  <span style={{ fontSize: 9, color: "var(--c-t4)", background: "var(--c-bd1)", borderRadius: 99, padding: "1px 6px", letterSpacing: "0.04em" }}>
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
          className="flex-1 overflow-y-auto px-3.5 py-3 nodrag"
          style={{ minHeight: 0 }}
        >
          {localMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-24 gap-2">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{
                  background: accentA(0.15),
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: accentA(0.3),
                }}
              >
                <Sparkles className="w-4 h-4" style={{ color: accentColor }} />
              </div>
              <p className="text-[10px] text-center" style={{ color: "var(--c-t4)" }}>
                发送消息开始 AI 对话
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {localMessages.map((msg, i) => (
                <div key={i} className={`group/msg flex gap-1.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  {/* Avatar */}
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{
                      background: msg.role === "user"
                        ? "oklch(0.68 0.22 285 / 0.20)"
                        : accentA(0.18),
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: msg.role === "user"
                        ? "oklch(0.68 0.22 285 / 0.35)"
                        : accentA(0.3),
                    }}
                  >
                    {msg.role === "user" ? (
                      <User className="w-2.5 h-2.5" style={{ color: "oklch(0.68 0.22 285)" }} />
                    ) : (
                      <Bot className="w-2.5 h-2.5" style={{ color: accentColor }} />
                    )}
                  </div>
                  {/* Bubble + copy button */}
                  <div className="flex flex-col flex-1 min-w-0">
                    <div
                      className="rounded-lg px-3 py-2 text-xs leading-relaxed"
                      style={{
                        background: msg.role === "user"
                          ? "oklch(0.68 0.22 285 / 0.10)"
                          : accentA(0.04),
                        borderWidth: 1,
                        borderStyle: "solid",
                        borderColor: msg.role === "user"
                          ? "oklch(0.68 0.22 285 / 0.20)"
                          : accentA(0.18),
                        color: "var(--c-t1)",
                      }}
                    >
                      {msg.role === "assistant" ? (
                        <SimpleMarkdown>{msg.content}</SimpleMarkdown>
                      ) : (
                        <span>{msg.content}</span>
                      )}
                    </div>
                    {msg.role === "assistant" && (
                      <button
                        onClick={() => navigator.clipboard.writeText(msg.content).then(() => toast.success("已复制", { duration: 1200 }))}
                        className="nodrag opacity-0 group-hover/msg:opacity-100 transition-opacity mt-1 flex items-center gap-1 text-[10px] self-start"
                        style={{ color: "var(--c-t4)" }}
                        title="复制消息"
                      >
                        <Copy style={{ width: 10, height: 10 }} />
                        复制
                      </button>
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
                      background: accentA(0.18),
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: accentA(0.3),
                    }}
                  >
                    <Bot className="w-2.5 h-2.5" style={{ color: accentColor }} />
                  </div>
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                    style={{
                      background: accentA(0.04),
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: accentA(0.18),
                    }}
                  >
                    <Loader2 className="w-3 h-3 animate-spin" style={{ color: accentColor }} />
                    <span className="text-[10px]" style={{ color: "var(--c-t3)" }}>思考中...</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Input bar ── */}
        <div
          className="px-3.5 pb-3.5 pt-2.5 flex gap-2 flex-shrink-0"
          style={{ borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: "var(--c-bd1)" }}
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
              fontSize: 12,
              padding: "7px 10px",
              background: "var(--c-input)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: BORDER_DEFAULT,
              borderRadius: 8,
              color: "var(--c-t1)",
              outline: "none",
              transition: "border-color 150ms ease",
            }}
            onFocus={onFocusInput}
            onBlur={onBlurInput}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sendMutation.isPending}
            className="nodrag w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
            style={{
              background: !input.trim() || sendMutation.isPending
                ? "var(--c-surface)"
                : accentA(0.18),
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: !input.trim() || sendMutation.isPending
                ? BORDER_DEFAULT
                : accentA(0.4),
              color: !input.trim() || sendMutation.isPending
                ? "var(--c-t4)"
                : accentColor,
              cursor: !input.trim() || sendMutation.isPending ? "not-allowed" : "pointer",
            }}
          >
            {sendMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          </button>
          <button
            onClick={() => clearMutation.mutate({ nodeId: id, projectId: data.projectId })}
            disabled={localMessages.length === 0}
            className="nodrag w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
            style={{
              background: "transparent",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "transparent",
              color: localMessages.length === 0 ? "var(--c-bd3)" : "var(--c-t4)",
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
              (e.currentTarget as HTMLElement).style.color = localMessages.length === 0 ? "var(--c-bd3)" : "var(--c-t4)";
            }}
          >
            <Trash2 className="w-3 h-3" />
          </button>
          {hasDownstream && localMessages.some(m => m.role === "assistant") && (
            <button
              onClick={() => {
                const lastAI = [...localMessages].reverse().find(m => m.role === "assistant");
                if (lastAI) pushToDownstream(lastAI.content);
              }}
              className="nodrag w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
              title="推送最新 AI 回复到连接的下游节点"
              style={{ background: "transparent", border: "1px solid transparent", color: "var(--c-t3)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.70 0.18 200 / 0.12)"; (e.currentTarget as HTMLElement).style.color = accentColor; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
            >
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </BaseNode>
  );
});
