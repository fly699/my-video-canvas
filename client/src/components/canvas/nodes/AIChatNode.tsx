import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { AIChatNodeData, ChatAttachment, NodeType } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Send, Loader2, Trash2, Bot, User, Sparkles, ChevronDown, ArrowRight, Copy, BookOpen, Clapperboard, LayoutGrid, Wand2, ScrollText, UserRound, Paperclip, ImageIcon, FileText, X, PictureInPicture2, ChevronsRight, GripHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
  { label: "导演助手", icon: "Clapperboard", prompt: "你是一位专业的电影导演助手，擅长分析剧本、提出视觉化建议和分镜构思。请用简洁专业的中文回答。" },
  { label: "分镜生成", icon: "LayoutGrid", prompt: "你是专业的分镜师。根据场景描述，生成详细的分镜描述，包括：镜头类型、运镜方式、景深、灯光氛围、构图要点。每个分镜用编号列出。" },
  { label: "提示词优化", icon: "Wand2", prompt: "你是专业的 AI 图像提示词工程师。用户输入中文描述，你将其转化为高质量的英文 Stable Diffusion 提示词（100词以内），聚焦于视觉细节、光影、风格、构图。只输出提示词，无需解释。" },
  { label: "视频脚本", icon: "ScrollText", prompt: "你是专业的视频脚本创作者。根据主题创作简洁有力的视频脚本，包括旁白文字、配乐建议和镜头切换节奏。" },
  { label: "角色设计", icon: "UserRound", prompt: "你是角色设计专家。根据描述生成详细的角色外观描述，包括：年龄体型、服装风格、表情神态、标志性特征，用于 AI 图像生成。" },
] as const;

const PRESET_ICONS: Record<string, LucideIcon> = { Clapperboard, LayoutGrid, Wand2, ScrollText, UserRound };

export const AIChatNode = memo(function AIChatNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const hasDownstream = useCanvasStore(useMemo(() => (s) => s.edges.some(e => e.source === id), [id]));
  const payload = data.payload;
  const [input, setInput] = useState("");
  // Seed from payload.messages; when the node remounts, prefer the store's
  // persisted messages over the stale payload snapshot captured at mount time.
  const [localMessages, setLocalMessages] = useState<Array<{ role: "user" | "assistant"; content: string; attachments?: ChatAttachment[]; _id: string }>>(
    () => ((data.payload as typeof payload).messages ?? []).map(m => ({ ...m, _id: crypto.randomUUID() }))
  );
  const [model, setModel] = useState<string>(payload.model ?? "gemini-2.5-flash");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  // Attachments currently composed for the *next* user message. Cleared on send.
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  // ── Floating mode (per-tab, not synced via payload to keep each user's
  //    chat window position independent). Persisted to sessionStorage so the
  //    state survives node remounts (e.g. when scrolling out of viewport).
  //    One object key per node — earlier we used three separate keys, which
  //    produced three race windows on tab close and three partial-restore
  //    states if one key was cleared.
  const floatKey = `avc:chat-float:${id}`;
  interface FloatState { floating: boolean; pos: { x: number; y: number }; size: { w: number; h: number } }
  const [floatState, setFloatState] = useState<FloatState>(() => {
    const defaults: FloatState = {
      floating: false,
      pos: { x: typeof window !== "undefined" ? Math.max(40, window.innerWidth - 460) : 800, y: 80 },
      size: { w: 420, h: 560 },
    };
    try {
      const raw = sessionStorage.getItem(floatKey);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<FloatState>;
      return {
        floating: typeof parsed.floating === "boolean" ? parsed.floating : defaults.floating,
        pos: parsed.pos && typeof parsed.pos.x === "number" ? parsed.pos as FloatState["pos"] : defaults.pos,
        size: parsed.size && typeof parsed.size.w === "number" ? parsed.size as FloatState["size"] : defaults.size,
      };
    } catch { return defaults; }
  });
  const floating = floatState.floating;
  const floatPos = floatState.pos;
  const floatSize = floatState.size;
  const setFloating = (v: boolean | ((p: boolean) => boolean)) =>
    setFloatState((s) => ({ ...s, floating: typeof v === "function" ? v(s.floating) : v }));
  const setFloatPos = (v: { x: number; y: number }) => setFloatState((s) => ({ ...s, pos: v }));
  const setFloatSize = (v: { w: number; h: number }) => setFloatState((s) => ({ ...s, size: v }));
  // Debounce sessionStorage writes so a 60fps drag stream doesn't spam
  // JSON.stringify + setItem on every mousemove. Float toggle, drag-end,
  // resize-end all get flushed via the trailing 200ms timer.
  useEffect(() => {
    const t = setTimeout(() => {
      try { sessionStorage.setItem(floatKey, JSON.stringify(floatState)); } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(t);
  }, [floatState, floatKey]);

  // Drag state — pointer offset relative to window origin at drag start
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
  const onFloatHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // ignore clicks on header buttons
    e.preventDefault();
    dragOffsetRef.current = { dx: e.clientX - floatPos.x, dy: e.clientY - floatPos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragOffsetRef.current) return;
      const nx = Math.min(window.innerWidth - 120, Math.max(0, ev.clientX - dragOffsetRef.current.dx));
      const ny = Math.min(window.innerHeight - 60, Math.max(0, ev.clientY - dragOffsetRef.current.dy));
      setFloatPos({ x: nx, y: ny });
    };
    const onUp = () => {
      dragOffsetRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  // Resize handle (bottom-right corner)
  const resizeRef = useRef<{ sw: number; sh: number; sx: number; sy: number } | null>(null);
  const onFloatResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { sw: floatSize.w, sh: floatSize.h, sx: e.clientX, sy: e.clientY };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const w = Math.max(320, Math.min(900, resizeRef.current.sw + (ev.clientX - resizeRef.current.sx)));
      const h = Math.max(360, Math.min(900, resizeRef.current.sh + (ev.clientY - resizeRef.current.sy)));
      setFloatSize({ w, h });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);
  // Track what we last persisted so we can detect real changes without
  // relying on reference equality (which breaks after the _id .map()).
  const lastSavedRef = useRef(JSON.stringify((data.payload as typeof payload).messages ?? []));

  useEffect(() => {
    // Persist localMessages → store only when content actually changes.
    // Comparing via JSON avoids the loop where every render of the parent gives us a
    // new `data.payload` reference even when nothing relevant changed.
    const stripped = localMessages.map(({ _id: _, ...m }) => m);
    const serialized = JSON.stringify(stripped);
    if (serialized === lastSavedRef.current) return;
    lastSavedRef.current = serialized;
    updateNodeData(id, { messages: stripped });
  }, [localMessages, id, updateNodeData]);
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

  const utils = trpc.useUtils();
  const uploadMutation = trpc.upload.uploadImage.useMutation();
  const sendMutation = trpc.aiChat.sendMessage.useMutation({
    onSuccess: (result) => {
      setLocalMessages((prev) => [...prev, { role: "assistant", content: result.content, _id: crypto.randomUUID() }]);
    },
    onError: (err) => {
      // Roll back the optimistic user message appended in handleSend, then
      // re-sync from the server in case the DB write succeeded but the response
      // was lost — this prevents silent divergence between client and DB state.
      setLocalMessages((prev) => prev.slice(0, -1));
      utils.aiChat.getMessages.fetch({ nodeId: id, projectId: data.projectId })
        .then((msgs) => {
          if (msgs.length > 0) {
            const synced = msgs.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
              attachments: (m.attachments as ChatAttachment[] | null) ?? undefined,
              _id: crypto.randomUUID(),
            }));
            setLocalMessages(synced);
          }
        })
        .catch(() => { /* best-effort sync; ignore fetch errors */ });
      toast.error("AI 响应失败：" + err.message);
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
    if ((!msg && pendingAttachments.length === 0) || sendMutation.isPending) return;
    setInput("");
    const attachmentsToSend = pendingAttachments;
    setPendingAttachments([]);
    setLocalMessages((prev) => [...prev, {
      role: "user",
      content: msg,
      attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
      _id: crypto.randomUUID(),
    }]);
    sendMutation.mutate({
      nodeId: id,
      projectId: data.projectId,
      message: msg,
      systemPrompt: payload.systemPrompt,
      contextContent: buildContext(),
      model,
      attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Attachment handling ─────────────────────────────────────────────────
  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const fileToText = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

  const attachFiles = useCallback(async (files: FileList | File[]) => {
    if (pendingAttachments.length + files.length > 8) {
      toast.error("最多 8 个附件");
      return;
    }
    setIsUploadingAttachment(true);
    try {
      const additions: ChatAttachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name} 超过 10MB`);
          continue;
        }
        if (file.type.startsWith("image/")) {
          const base64 = await fileToBase64(file);
          const { url } = await uploadMutation.mutateAsync({
            base64,
            mimeType: file.type,
            filename: file.name,
          });
          additions.push({ type: "image", url, mimeType: file.type, name: file.name });
        } else if (
          file.type.startsWith("text/") ||
          /\.(md|txt|json|csv|tsv|log)$/i.test(file.name) ||
          !file.type // browser unknown — try as text
        ) {
          const text = await fileToText(file);
          if (text.length > 50_000) {
            toast.error(`${file.name} 超过 50K 字符`);
            continue;
          }
          additions.push({ type: "file", url: "", mimeType: file.type || "text/plain", name: file.name, textContent: text });
        } else {
          toast.error(`不支持的文件类型：${file.type || file.name}`);
        }
      }
      if (additions.length > 0) {
        setPendingAttachments((prev) => [...prev, ...additions]);
        toast.success(`已添加 ${additions.length} 个附件`);
      }
    } catch (e) {
      toast.error("附件上传失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsUploadingAttachment(false);
    }
  }, [pendingAttachments.length, uploadMutation]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const files = items
      .filter((i) => i.kind === "file")
      .map((i) => i.getAsFile())
      .filter((f): f is File => f != null);
    if (files.length > 0) {
      e.preventDefault();
      await attachFiles(files);
    }
  }, [attachFiles]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) await attachFiles(files);
  }, [attachFiles]);

  const removeAttachment = (idx: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  // The floating-mode toggle in the header. Visible in both canvas and float modes.
  const floatToggle = (
    <button
      onClick={(e) => { e.stopPropagation(); setFloating((v) => !v); }}
      className="nodrag w-6 h-6 rounded flex items-center justify-center transition-all"
      style={{
        background: floating ? accentA(0.18) : "transparent",
        border: `1px solid ${floating ? accentA(0.45) : "transparent"}`,
        color: floating ? accentColor : "var(--c-t4)",
      }}
      title={floating ? "收回到画布" : "悬浮窗口（始终可见，可拖动）"}
    >
      <PictureInPicture2 style={{ width: 12, height: 12 }} />
    </button>
  );

  const chatBody = (
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
                  {(() => { const I = PRESET_ICONS[t.icon]; return I ? <I className="w-3.5 h-3.5 flex-shrink-0" /> : null; })()}
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
              {localMessages.map((msg) => (
                <div key={msg._id} className={`group/msg flex gap-1.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
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
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {msg.attachments.map((att, i) => (
                            <AttachmentChip key={i} att={att} />
                          ))}
                        </div>
                      )}
                      {msg.role === "assistant" ? (
                        <SimpleMarkdown>{msg.content}</SimpleMarkdown>
                      ) : (
                        msg.content ? <span>{msg.content}</span> : null
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
          className="px-3.5 pb-3.5 pt-2 flex flex-col gap-1.5 flex-shrink-0 relative"
          style={{
            borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: "var(--c-bd1)",
            background: isDraggingOver ? accentA(0.06) : "transparent",
            transition: "background 120ms ease",
          }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); }}
          onDrop={handleDrop}
        >
          {isDraggingOver && (
            <div
              className="absolute inset-0 flex items-center justify-center text-xs pointer-events-none z-10"
              style={{ background: accentA(0.10), border: `2px dashed ${accentA(0.45)}`, color: accentColor, borderRadius: 8 }}
            >
              松开以添加附件
            </div>
          )}

          {/* Pending attachments preview */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pendingAttachments.map((att, i) => (
                <PendingAttachmentChip key={i} att={att} onRemove={() => removeAttachment(i)} />
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept="image/*,text/*,.md,.txt,.json,.csv,.tsv,.log"
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) {
                attachFiles(e.target.files);
                e.target.value = "";
              }
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sendMutation.isPending || isUploadingAttachment}
            className="nodrag w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
            style={{
              background: "transparent",
              border: "1px solid var(--c-bd2)",
              color: "var(--c-t3)",
              cursor: sendMutation.isPending ? "not-allowed" : "pointer",
            }}
            title="添加附件（图片/文本文件，可粘贴/拖入）"
          >
            {isUploadingAttachment ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
          </button>
          <textarea
            ref={inputRef}
            placeholder={pendingAttachments.length > 0 ? "添加说明（可选）" : "发送消息或粘贴图片… (Enter 发送 / Shift+Enter 换行)"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={sendMutation.isPending}
            rows={1}
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
              resize: "none",
              maxHeight: 100,
              minHeight: 32,
              fontFamily: "inherit",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_FOCUS; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
          />
          <button
            onClick={handleSend}
            disabled={(!input.trim() && pendingAttachments.length === 0) || sendMutation.isPending}
            className="nodrag w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
            style={{
              background: (!input.trim() && pendingAttachments.length === 0) || sendMutation.isPending
                ? "var(--c-surface)"
                : accentA(0.18),
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: (!input.trim() && pendingAttachments.length === 0) || sendMutation.isPending
                ? BORDER_DEFAULT
                : accentA(0.4),
              color: (!input.trim() && pendingAttachments.length === 0) || sendMutation.isPending
                ? "var(--c-t4)"
                : accentColor,
              cursor: (!input.trim() && pendingAttachments.length === 0) || sendMutation.isPending ? "not-allowed" : "pointer",
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
      </div>
  );

  return (
    <>
      <BaseNode
        id={id}
        selected={selected}
        nodeType="ai_chat"
        title={data.title}
        minHeight={floating ? 120 : 320}
        resizable={!floating}
        headerRight={floatToggle}
      >
        {floating ? (
          <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
            <PictureInPicture2 className="w-5 h-5" style={{ color: accentColor }} />
            <p className="text-xs" style={{ color: "var(--c-t2)" }}>
              已悬浮 — 浮窗中查看对话
            </p>
            <button
              onClick={() => setFloating(false)}
              className="nodrag mt-1 px-3 py-1.5 rounded-lg text-[11px] font-medium"
              style={{
                background: accentA(0.10),
                border: `1px solid ${accentA(0.40)}`,
                color: accentColor,
              }}
            >
              收回到画布
            </button>
          </div>
        ) : chatBody}
      </BaseNode>

      {floating && createPortal(
        <div
          className="fixed z-[60] flex flex-col rounded-xl overflow-hidden"
          style={{
            left: floatPos.x,
            top: floatPos.y,
            width: floatSize.w,
            height: floatSize.h,
            background: "var(--c-base)",
            border: `1px solid ${accentA(0.45)}`,
            boxShadow: "0 24px 80px oklch(0 0 0 / 0.40), 0 0 0 1px " + accentA(0.20),
          }}
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div
            onMouseDown={onFloatHeaderMouseDown}
            className="flex items-center gap-2 px-3 py-2 flex-shrink-0 select-none"
            style={{
              cursor: "move",
              background: accentA(0.08),
              borderBottom: `1px solid ${accentA(0.25)}`,
            }}
          >
            <GripHorizontal style={{ width: 14, height: 14, color: accentColor }} />
            <span className="text-xs font-medium flex-1" style={{ color: "var(--c-t1)" }}>
              {data.title || "AI 助手"} · 悬浮
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setFloating(false); }}
              className="w-6 h-6 rounded flex items-center justify-center"
              style={{ color: "var(--c-t3)" }}
              title="收回到画布"
            >
              <ChevronsRight style={{ width: 12, height: 12 }} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setFloating(false); }}
              className="w-6 h-6 rounded flex items-center justify-center"
              style={{ color: "var(--c-t3)" }}
              title="关闭浮窗（节点保留）"
            >
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">{chatBody}</div>
          <div
            onMouseDown={onFloatResizeMouseDown}
            className="absolute bottom-1 right-1 w-3 h-3 cursor-se-resize"
            style={{ color: "var(--c-t4)" }}
            title="拖动调整大小"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <line x1="2" y1="11" x2="11" y2="2" stroke="currentColor" strokeWidth="1.2" />
              <line x1="6" y1="11" x2="11" y2="6" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
});

// ── Attachment rendering helpers ─────────────────────────────────────────
function AttachmentChip({ att }: { att: ChatAttachment }) {
  if (att.type === "image") {
    return (
      <a
        href={att.url}
        target="_blank"
        rel="noreferrer"
        className="block rounded overflow-hidden"
        style={{ width: 80, height: 80, border: "1px solid var(--c-bd2)" }}
        title={att.name}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={att.url} alt={att.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </a>
    );
  }
  return (
    <div
      className="inline-flex items-center gap-1 px-2 py-1 rounded"
      style={{ fontSize: 10, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}
      title={att.name}
    >
      <FileText style={{ width: 10, height: 10 }} />
      <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name}</span>
    </div>
  );
}

function PendingAttachmentChip({ att, onRemove }: { att: ChatAttachment; onRemove: () => void }) {
  if (att.type === "image") {
    return (
      <div className="relative rounded overflow-hidden" style={{ width: 56, height: 56, border: "1px solid var(--c-bd2)" }}>
        <img src={att.url} alt={att.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <button
          onClick={onRemove}
          className="nodrag absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
          style={{ background: "oklch(0 0 0 / 0.65)", color: "white" }}
          title="移除"
        >
          <X style={{ width: 9, height: 9 }} />
        </button>
      </div>
    );
  }
  return (
    <div
      className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded"
      style={{ fontSize: 10, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}
    >
      <FileText style={{ width: 10, height: 10 }} />
      <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name}</span>
      <span style={{ color: "var(--c-t4)", fontSize: 9 }}>{((att.textContent?.length ?? 0) / 1000).toFixed(1)}K</span>
      <button
        onClick={onRemove}
        className="nodrag w-4 h-4 rounded flex items-center justify-center ml-0.5"
        style={{ color: "var(--c-t4)" }}
        title="移除"
      >
        <X style={{ width: 9, height: 9 }} />
      </button>
    </div>
  );
}

// Suppress unused imports warning for icons reserved for future use
void ImageIcon;
