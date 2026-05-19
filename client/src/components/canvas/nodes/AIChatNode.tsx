import { memo, useState, useRef, useEffect, useCallback } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { AIChatNodeData } from "../../../../../shared/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Send, Loader2, Trash2, Bot, User, Sparkles } from "lucide-react";
import { Streamdown } from "streamdown";
import { ScrollArea } from "@/components/ui/scroll-area";

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

export const AIChatNode = memo(function AIChatNode({ id, selected, data }: Props) {
  const { updateNodeData, nodes } = useCanvasStore();
  const payload = data.payload;
  const [input, setInput] = useState("");
  const [localMessages, setLocalMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >(payload.messages ?? []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync local messages to node data
  useEffect(() => {
    updateNodeData(id, { messages: localMessages });
  }, [localMessages]);

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [localMessages]);

  const sendMutation = trpc.aiChat.sendMessage.useMutation({
    onSuccess: (result) => {
      setLocalMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.content },
      ]);
    },
    onError: (err) => {
      toast.error("AI 响应失败：" + err.message);
      setLocalMessages((prev) => prev.slice(0, -1));
    },
  });

  const clearMutation = trpc.aiChat.clearMessages.useMutation({
    onSuccess: () => {
      setLocalMessages([]);
      toast.success("对话已清除");
    },
  });

  // Build context from connected/selected nodes
  const buildContext = useCallback(() => {
    const contextIds = payload.contextNodeIds ?? [];
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
        "";
      if (content) parts.push(`[${node.data.title}]: ${content}`);
    }
    return parts.join("\n\n") || undefined;
  }, [nodes, payload.contextNodeIds]);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg || sendMutation.isPending) return;
    setInput("");
    setLocalMessages((prev) => [...prev, { role: "user", content: msg }]);
    sendMutation.mutate({
      nodeId: id,
      projectId: data.projectId,
      message: msg,
      systemPrompt: payload.systemPrompt,
      contextContent: buildContext(),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <BaseNode id={id} selected={selected} nodeType="ai_chat" title={data.title} minHeight={320}>
      <div className="flex flex-col h-full" style={{ minHeight: 280 }}>
        {/* System prompt */}
        <div className="px-3 pt-2 pb-1 border-b border-border/30">
          <Input
            placeholder="系统提示词（可选）"
            value={payload.systemPrompt ?? ""}
            onChange={(e) => updateNodeData(id, { systemPrompt: e.target.value })}
            className="h-6 text-[10px] bg-transparent border-border/30 nodrag placeholder:text-muted-foreground/30"
          />
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-3 py-2 space-y-2 nodrag"
          style={{ minHeight: 120, maxHeight: 260 }}
        >
          {localMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-20 text-center gap-1">
              <Sparkles className="w-5 h-5 text-muted-foreground/30" />
              <p className="text-[10px] text-muted-foreground/40">
                发送消息开始 AI 对话
              </p>
            </div>
          ) : (
            localMessages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    msg.role === "user"
                      ? "bg-primary/20"
                      : "bg-[oklch(0.70_0.18_200/0.2)]"
                  }`}
                >
                  {msg.role === "user" ? (
                    <User className="w-2.5 h-2.5 text-primary" />
                  ) : (
                    <Bot className="w-2.5 h-2.5 text-[oklch(0.70_0.18_200)]" />
                  )}
                </div>
                <div
                  className={`flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-xs leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary/10 text-foreground/90"
                      : "bg-[oklch(0.70_0.18_200/0.08)] text-foreground/90"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <Streamdown className="prose prose-invert prose-xs max-w-none">
                      {msg.content}
                    </Streamdown>
                  ) : (
                    <span>{msg.content}</span>
                  )}
                </div>
              </div>
            ))
          )}
          {sendMutation.isPending && (
            <div className="flex gap-2">
              <div className="w-5 h-5 rounded-full bg-[oklch(0.70_0.18_200/0.2)] flex items-center justify-center flex-shrink-0">
                <Bot className="w-2.5 h-2.5 text-[oklch(0.70_0.18_200)]" />
              </div>
              <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[oklch(0.70_0.18_200/0.08)]">
                <Loader2 className="w-3 h-3 animate-spin text-[oklch(0.70_0.18_200)]" />
                <span className="text-[10px] text-muted-foreground">思考中...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-3 pb-3 pt-2 border-t border-border/30 flex gap-2">
          <Input
            ref={inputRef}
            placeholder="发送消息... (Enter 发送)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sendMutation.isPending}
            className="flex-1 h-7 text-xs bg-transparent border-border/40 nodrag"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || sendMutation.isPending}
            className="w-7 h-7 bg-[oklch(0.70_0.18_200/0.2)] hover:bg-[oklch(0.70_0.18_200/0.3)] border border-[oklch(0.70_0.18_200/0.4)] nodrag"
            variant="ghost"
          >
            {sendMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3 text-[oklch(0.70_0.18_200)]" />
            )}
          </Button>
          <Button
            size="icon"
            onClick={() => clearMutation.mutate({ nodeId: id, projectId: data.projectId })}
            disabled={localMessages.length === 0}
            className="w-7 h-7 nodrag"
            variant="ghost"
          >
            <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
          </Button>
        </div>
      </div>
    </BaseNode>
  );
});
