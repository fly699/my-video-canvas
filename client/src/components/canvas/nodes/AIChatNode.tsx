import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNodeDefaultModels } from "../../../contexts/NodeDefaultModelsContext";
import { BaseNode } from "../BaseNode";
import { MediaImage } from "../MediaImage";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { AIChatNodeData, ChatAttachment, NodeType } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Send, Loader2, Trash2, Bot, User, Sparkles, ChevronDown, ArrowRight, Copy, BookOpen, Paperclip, ImageIcon, FileText, X, PictureInPicture2, ChevronsRight, GripHorizontal, Download, Layers, Slash } from "lucide-react";
import { CHAT_MODELS, platformBadge, modelGroupOrder } from "@/lib/models";
import { safeHref } from "@/lib/safeUrl";
import { useSelfHostedLlmModels } from "@/lib/useSelfHostedModels";
import { useDisabledModels } from "@/lib/useDisabledModels";
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

// Templates are organized by category and imported from a dedicated module so
// the picker can stay rich without bloating this component file. See
// client/src/lib/aiAssistantTemplates.ts for the actual definitions.
import { AI_TEMPLATE_CATEGORIES, type AITemplate } from "@/lib/aiAssistantTemplates";
import { NodeTextArea, NodeInput } from "../NodeTextInput";

export const AIChatNode = memo(function AIChatNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const { resolve } = useNodeDefaultModels();
  const hasDownstream = useCanvasStore(useMemo(() => (s) => s.edges.some(e => e.source === id), [id]));
  const payload = data.payload;
  const [input, setInput] = useState("");
  // Seed from payload.messages; when the node remounts, prefer the store's
  // persisted messages over the stale payload snapshot captured at mount time.
  const [localMessages, setLocalMessages] = useState<Array<{ role: "user" | "assistant"; content: string; attachments?: ChatAttachment[]; _id: string }>>(
    () => ((data.payload as typeof payload).messages ?? []).map(m => ({ ...m, _id: crypto.randomUUID() }))
  );
  const [model, setModel] = useState<string>(payload.model ?? resolve("ai_chat", "llm"));
  const disabledModels = useDisabledModels();
  const _selfHosted = useSelfHostedLlmModels();
  const CHAT_LIST = _selfHosted.length ? [..._selfHosted.filter((x) => !CHAT_MODELS.some((m) => m.id === x.id)), ...CHAT_MODELS] : CHAT_MODELS;
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
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
              // attachments is enriched server-side via raw SQL (see
              // db.getChatMessages) and may not appear on the inferred
              // schema type, so widen via cast.
              attachments: ((m as unknown as { attachments?: ChatAttachment[] | null }).attachments) ?? undefined,
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
    // Cap to the server's contextContent.max(8000) — a connected script with long
    // content would otherwise 400 the whole chat.
    const joined = parts.join("\n\n");
    return (joined.length > 8000 ? joined.slice(0, 8000) : joined) || undefined;
  }, [id, payload.contextNodeIds]);

  // ── Slash commands ─────────────────────────────────────────────────────
  // Type `/<cmd> <text>` to wrap the message in a known prompt template.
  // Aliases (English / Chinese) so the same command is callable in either.
  const SLASH_COMMANDS: Array<{ id: string; aliases: string[]; label: string; wrap: (rest: string) => string }> = useMemo(() => [
    { id: "translate-en", aliases: ["翻译", "translate", "en"],
      label: "翻译为英文 prompt",
      wrap: (s) => `请把以下内容翻译为适合 AI 图像/视频生成的英文 prompt（自然语言段落，80-120 词，无 markdown，无前后解释）：\n\n${s}` },
    { id: "translate-cn", aliases: ["中译", "zh", "cn"],
      label: "翻译为中文",
      wrap: (s) => `请把以下内容翻译为简洁的中文（保留专业术语）：\n\n${s}` },
    { id: "rewrite", aliases: ["重写", "rewrite"],
      label: "更简洁地重写",
      wrap: (s) => `请用更简洁、有力的方式重写以下内容，保持原意：\n\n${s}` },
    { id: "expand", aliases: ["扩展", "expand"],
      label: "扩写为更详细版本",
      wrap: (s) => `请把以下内容扩展为更详细丰富的版本，加上具体细节、画面感、感官描述：\n\n${s}` },
    { id: "summarize", aliases: ["总结", "summarize", "summary", "tldr"],
      label: "总结要点",
      wrap: (s) => `请总结以下内容的核心要点（用项目符号列表，每点 ≤15 字）：\n\n${s}` },
    { id: "json", aliases: ["JSON", "json"],
      label: "转换为 JSON",
      wrap: (s) => `请把以下内容转换为结构化 JSON（推断合理的字段名，输出代码块）：\n\n${s}` },
    { id: "critique", aliases: ["批评", "评审", "critique", "review"],
      label: "挑剔评审",
      wrap: (s) => `请用挑剔的眼光评审以下内容，列出 3-5 个最严重的问题及改进建议：\n\n${s}` },
    { id: "improve", aliases: ["改进", "improve", "enhance"],
      label: "给出改进版",
      wrap: (s) => `请改进以下内容并直接给出改进后版本（保留原始结构）：\n\n${s}` },
    { id: "explain", aliases: ["解释", "explain"],
      label: "深入解释",
      wrap: (s) => `请深入解释以下概念/词语/术语（适合创作者理解）：\n\n${s}` },
    { id: "canvas-context", aliases: ["画布", "canvas", "ctx"],
      label: "注入整个画布摘要",
      wrap: (s) => `${buildCanvasSummary()}\n\n基于以上画布内容，请回答以下问题：\n\n${s || "请审查这个工作流的合理性，指出问题与改进建议。"}` },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Build a compact text snapshot of the current canvas for context injection. */
  const buildCanvasSummary = useCallback((): string => {
    const { nodes, edges } = useCanvasStore.getState();
    const lines: string[] = ["# 当前画布摘要", ""];
    lines.push(`节点 ${nodes.length} 个，连线 ${edges.length} 条。`);
    lines.push("");
    lines.push("## 节点");
    for (const n of nodes) {
      const p = n.data.payload as Record<string, unknown>;
      const summary: string[] = [];
      if (typeof p.prompt === "string" && p.prompt) summary.push(`prompt="${(p.prompt as string).slice(0, 60)}…"`);
      if (typeof p.positivePrompt === "string" && p.positivePrompt) summary.push(`prompt="${(p.positivePrompt as string).slice(0, 60)}…"`);
      if (typeof p.content === "string" && p.content) summary.push(`content="${(p.content as string).slice(0, 60)}…"`);
      if (typeof p.imageUrl === "string" && p.imageUrl) summary.push("[已生成图]");
      if (typeof p.resultVideoUrl === "string" && p.resultVideoUrl) summary.push("[已生成视频]");
      if (typeof p.url === "string" && p.url) summary.push(`url=${(p.url as string).slice(0, 30)}…`);
      if (typeof p.provider === "string") summary.push(`provider=${p.provider}`);
      if (typeof p.model === "string") summary.push(`model=${p.model}`);
      lines.push(`- [${n.id.slice(0, 6)}] ${n.data.nodeType} "${n.data.title ?? ""}"  ${summary.join("  ")}`);
    }
    if (edges.length > 0) {
      lines.push("");
      lines.push("## 连接");
      for (const e of edges) {
        lines.push(`- ${e.source.slice(0, 6)} → ${e.target.slice(0, 6)}`);
      }
    }
    return lines.join("\n");
  }, []);

  /** Detect leading `/<cmd>` in the input and expand to its prompt wrapper. */
  const expandSlashCommand = (raw: string): string => {
    const m = raw.match(/^\/(\S+)\s*([\s\S]*)$/);
    if (!m) return raw;
    const [, name, rest] = m;
    const cmd = SLASH_COMMANDS.find((c) =>
      c.aliases.some((a) => a.toLowerCase() === name.toLowerCase()),
    );
    if (!cmd) return raw;
    return cmd.wrap(rest.trim());
  };

  /** 以编程方式写入输入框：优先用 NodeTextArea 暴露的 commitValue（聚焦时也即时生效），否则回退 setInput。 */
  const insertInputText = (next: string) => {
    const el = inputRef.current as (HTMLTextAreaElement & { commitValue?: (v: string) => void }) | null;
    if (el?.commitValue) el.commitValue(next);
    else setInput(next);
  };

  const handleSend = () => {
    const msgRaw = input.trim();
    if ((!msgRaw && pendingAttachments.length === 0) || sendMutation.isPending) return;
    const msg = expandSlashCommand(msgRaw);
    setInput("");
    const attachmentsToSend = pendingAttachments;
    setPendingAttachments([]);
    setLocalMessages((prev) => [...prev, {
      role: "user",
      // Preserve what the user typed (`/翻译 ...`) in the visible message
      // but send the expanded version to the LLM.
      content: msgRaw,
      attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
      _id: crypto.randomUUID(),
    }]);
    sendMutation.mutate({
      nodeId: id,
      projectId: data.projectId,
      // Clamp to server zod caps (message max 10000, systemPrompt max 2000) so a long
      // paste or a /canvas summary on a big graph can't 400 the request.
      message: msg.length > 10_000 ? msg.slice(0, 10_000) : msg,
      systemPrompt: payload.systemPrompt && payload.systemPrompt.length > 2000 ? payload.systemPrompt.slice(0, 2000) : payload.systemPrompt,
      contextContent: buildContext(),
      model,
      attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
      // kie chat models auth with their own key (临时 > 分配 > 公用).
      ...(model.startsWith("kie_") ? { kieTempKey: localStorage.getItem("kie:tempKey") || undefined } : {}),
    });
  };

  // 键入「/」即视为在打 AI 命令：自动弹出命令菜单并按已输入文本过滤（与点「/」按钮一致）。
  // 仅当输入以「/」开头且其后无空格（仍在打命令名）时触发。
  const slashMatch = input.match(/^\/([^\s]*)$/);
  const slashTyping = !!slashMatch;
  const slashQuery = (slashMatch?.[1] ?? "").toLowerCase();
  const filteredSlash = slashQuery
    ? SLASH_COMMANDS.filter((c) => c.aliases.some((a) => a.toLowerCase().includes(slashQuery)) || c.label.toLowerCase().includes(slashQuery))
    : SLASH_COMMANDS;
  const slashMenuOpen = (showSlashMenu || slashTyping) && filteredSlash.length > 0;

  /** 应用一个斜杠命令：去掉正在输入的「/命令」词，再以「/别名 + 剩余内容」写回输入框。 */
  const applySlashCommand = (c: { aliases: string[] }) => {
    const cur = inputRef.current?.value ?? input;
    const rest = cur.replace(/^\/\S*\s*/, ""); // 去掉开头的「/命令」token（按钮场景无 / 前缀则原样保留）
    insertInputText(`/${c.aliases[0]} ${rest}`.trim() + " ");
    setShowSlashMenu(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && showSlashMenu) { setShowSlashMenu(false); return; }
    if (e.key === "Enter" && !e.shiftKey) {
      // 命令菜单开着（键入 / 触发）→ Enter 选中首个命令，而不是直接发送。
      if (slashTyping && filteredSlash.length > 0) { e.preventDefault(); applySlashCommand(filteredSlash[0]); return; }
      e.preventDefault(); handleSend();
    }
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
    if (files.length > 0) {
      await attachFiles(files);
      return;
    }
    // Drop from the filmstrip/timeline (or any image URL) — they expose a
    // structured payload via dataTransfer instead of a File. Treat the URL
    // as an already-uploaded image attachment (no need to re-upload).
    const structured = e.dataTransfer.getData("application/x-avc-attachment");
    if (structured) {
      try {
        const parsed = JSON.parse(structured) as ChatAttachment;
        if (pendingAttachments.length >= 8) { toast.error("最多 8 个附件"); return; }
        setPendingAttachments((prev) => [...prev, parsed]);
        toast.success("已添加 1 个附件");
        return;
      } catch { /* fall through to plain URL */ }
    }
    // Priority 3 — bare URL. Distinguish image vs video by extension so a
    // video URL doesn't go in as type:"image" (the model would render a
    // broken thumbnail + the LLM would silently fail on the image_url).
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (!url || !/^(https?:|data:|\/)/i.test(url)) return;
    if (pendingAttachments.length >= 8) { toast.error("最多 8 个附件"); return; }
    const isImageUrl = /\.(jpe?g|png|gif|webp|bmp|svg|avif)(\?|#|$)/i.test(url) || url.startsWith("data:image/");
    const isVideoUrl = /\.(mp4|mov|webm|m4v|avi|mkv)(\?|#|$)/i.test(url) || url.startsWith("data:video/");
    const name = url.startsWith("data:") ? "media" : (url.split("/").pop()?.split("?")[0] || "media");
    if (isVideoUrl) {
      setPendingAttachments((prev) => [...prev, {
        type: "file", url: "", mimeType: "video/mp4", name,
        textContent: `[Video reference] url="${url}"`,
      }]);
      toast.success("已添加视频引用（文本形式）");
    } else if (isImageUrl) {
      setPendingAttachments((prev) => [...prev, { type: "image", url, mimeType: "image/*", name }]);
      toast.success("已添加 1 个附件");
    } else {
      toast.error("仅支持图片或视频拖入");
    }
  }, [attachFiles, pendingAttachments.length]);

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
    <div
      className="flex flex-col h-full nodrag nopan nowheel"
      style={{ minHeight: 280 }}
      // Whole-node drop target so users can drag from the filmstrip /
      // timeline straight onto any part of the chat node, not just the
      // input strip at the bottom.
      //
      // Always preventDefault on dragover — without it, the browser refuses
      // to fire the subsequent drop event, no matter what we set on
      // dataTransfer. The earlier "only preventDefault for recognized
      // payloads" gate was the reason drops from filmstrip / timeline
      // weren't landing on the chat node.
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Visual highlight only when we recognize something attachable.
        const types = e.dataTransfer.types;
        const recognized = !!types && (
          types.includes("Files") ||
          types.includes("application/x-avc-attachment") ||
          types.includes("text/uri-list") ||
          types.includes("text/plain")
        );
        if (recognized) setIsDraggingOver(true);
      }}
      onDragLeave={(e) => {
        // Only flip off when leaving the outer container, not crossing into children
        if (e.currentTarget === e.target) setIsDraggingOver(false);
      }}
      onDrop={handleDrop}
    >

        {/* ── System prompt ── */}
        <div
          ref={templateRef}
          className="px-3.5 py-2 flex items-center gap-1.5 flex-shrink-0 relative"
          style={{ borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: "var(--c-bd1)" }}
        >
          <NodeInput
            placeholder="系统提示词（可选）"
            value={payload.systemPrompt ?? ""}
            onValueChange={(v) => updateNodeData(id, { systemPrompt: v })}
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
              className="absolute left-0 right-0 z-50 rounded-xl overflow-hidden nodrag nopan nowheel"
              style={{
                top: "calc(100% + 4px)",
                background: "var(--c-base)",
                border: "1px solid var(--c-bd2)",
                boxShadow: "0 8px 32px oklch(0 0 0 / 0.55)",
                maxHeight: 380,
                overflowY: "auto",
              }}
            >
              {AI_TEMPLATE_CATEGORIES.map((cat, idx) => (
                <div key={cat.id}>
                  <div
                    className="px-3 py-1.5 sticky top-0 z-10"
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      color: "var(--c-t3)",
                      background: "color-mix(in oklch, var(--c-base) 92%, transparent)",
                      backdropFilter: "blur(8px)",
                      borderTop: idx > 0 ? "1px solid var(--c-bd1)" : "none",
                      borderBottom: "1px solid var(--c-bd1)",
                    }}
                  >
                    {cat.label}
                  </div>
                  {cat.templates.map((t: AITemplate) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        className="nodrag w-full flex items-center gap-2 px-3 py-2 transition-all text-left"
                        style={{ borderBottom: "1px solid var(--c-bd1)", cursor: "pointer" }}
                        onClick={() => {
                          updateNodeData(id, { systemPrompt: t.prompt });
                          setShowTemplates(false);
                          toast.success(`已应用模板：${t.label}`);
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                      >
                        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentColor }} />
                        <div className="flex flex-col flex-1 min-w-0">
                          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--c-t1)" }}>{t.label}</span>
                          <span style={{ fontSize: 9.5, color: "var(--c-t4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.blurb}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
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
            {CHAT_LIST.find((m) => m.id === model)?.label ?? model}
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
                maxHeight: "min(60vh, 420px)",
                overflowY: "auto",
              }}
            >
              {CHAT_LIST
                .filter((m) => !m.hidden && (!disabledModels.has(m.id) || m.id === model))
                .slice()
                .sort((a, b) => modelGroupOrder(a.provider) - modelGroupOrder(b.provider))
                .map((m) => (
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
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: model === m.id ? "oklch(0.72 0.20 330)" : "var(--c-t2)", fontWeight: model === m.id ? 500 : 400 }}>
                      {m.label}
                    </span>
                    {m.costNote && (
                      <span style={{ fontSize: 8.5, color: "var(--c-t3)", fontWeight: 600 }}>{m.costNote} 点/百万tokens</span>
                    )}
                  </div>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {/* 上游平台（Forge / Poyo / Kie）— 统一分色标签 */}
                    <span style={{
                      fontSize: 9, fontWeight: 700, borderRadius: 99, padding: "1px 6px", letterSpacing: "0.04em",
                      background: platformBadge(m.provider).bg,
                      color: platformBadge(m.provider).fg,
                    }}>
                      {m.provider}
                    </span>
                    <span style={{ fontSize: 9, color: "var(--c-t4)", background: "var(--c-bd1)", borderRadius: 99, padding: "1px 6px", letterSpacing: "0.04em" }}>
                      {m.tag}
                    </span>
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
            className="nodrag w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
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
          {/* Slash commands popup trigger */}
          <button
            onClick={() => setShowSlashMenu((v) => !v)}
            disabled={sendMutation.isPending}
            className="nodrag w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
            style={{
              background: showSlashMenu ? accentA(0.18) : "transparent",
              border: `1px solid ${showSlashMenu ? accentA(0.4) : "var(--c-bd2)"}`,
              color: showSlashMenu ? accentColor : "var(--c-t3)",
            }}
            title="斜杠命令（/翻译 /重写 /扩展 /JSON 等）"
          >
            <Slash className="w-3 h-3" />
          </button>
          {/* Inject whole-canvas summary */}
          <button
            onClick={() => {
              const cur = inputRef.current?.value ?? input;
              insertInputText((cur.startsWith("/画布") ? cur : `/画布 ${cur}`).trimEnd() + " ");
              inputRef.current?.focus();
            }}
            disabled={sendMutation.isPending}
            className="nodrag w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
            style={{ background: "transparent", border: "1px solid var(--c-bd2)", color: "var(--c-t3)" }}
            title="注入整个画布摘要作为上下文"
          >
            <Layers className="w-3 h-3" />
          </button>
          <NodeTextArea
            ref={inputRef}
            noSlash
            placeholder={pendingAttachments.length > 0 ? "添加说明（可选）" : "发送消息或粘贴图片… (Enter 发送 / Shift+Enter 换行)"}
            value={input}
            onValueChange={(v) => setInput(v)}
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
            className="nodrag w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
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
            className="nodrag w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
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
          {/* Export conversation to markdown */}
          {localMessages.length > 0 && (
            <button
              onClick={() => {
                const lines: string[] = [
                  `# AI 对话导出 — ${data.title || "未命名"}`,
                  `_导出时间：${new Date().toLocaleString("zh-CN")}_`,
                  "",
                  payload.systemPrompt ? `> **系统提示词**：${payload.systemPrompt}\n` : "",
                ];
                for (const m of localMessages) {
                  lines.push(`## ${m.role === "user" ? "🧑 用户" : "🤖 助手"}\n`);
                  if (m.attachments && m.attachments.length > 0) {
                    lines.push(m.attachments.map((a) => `![${a.name}](${a.url})`).join("\n"));
                    lines.push("");
                  }
                  lines.push(m.content || "_(无文本)_");
                  lines.push("");
                }
                const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = `${data.title || "ai-chat"}-${Date.now()}.md`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("已导出对话为 Markdown");
              }}
              className="nodrag w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
              title="导出对话为 Markdown"
              style={{ background: "transparent", border: "1px solid transparent", color: "var(--c-t4)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}
            >
              <Download className="w-3 h-3" />
            </button>
          )}
          {hasDownstream && localMessages.some(m => m.role === "assistant") && (
            <button
              onClick={() => {
                const lastAI = [...localMessages].reverse().find(m => m.role === "assistant");
                if (lastAI) pushToDownstream(lastAI.content);
              }}
              className="nodrag w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
              title="推送最新 AI 回复到连接的下游节点"
              style={{ background: "transparent", border: "1px solid transparent", color: "var(--c-t3)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.70 0.18 200 / 0.12)"; (e.currentTarget as HTMLElement).style.color = accentColor; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
            >
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
          </div>

          {/* Slash command picker popup */}
          {slashMenuOpen && (
            <div
              className="absolute left-3 right-3 bottom-full mb-1 rounded-xl overflow-hidden z-40 nodrag nopan nowheel"
              style={{
                background: "var(--c-base)",
                border: "1px solid var(--c-bd2)",
                boxShadow: "0 8px 32px oklch(0 0 0 / 0.55)",
                maxHeight: 280,
                overflowY: "auto",
              }}
            >
              {filteredSlash.map((c, idx) => (
                <button
                  key={c.id}
                  // 键入 / 时高亮首项（Enter 选中），与「按 / 按钮」一致的命令列表。
                  className="nodrag w-full flex items-center gap-2 px-3 py-2 text-left transition-all"
                  style={{ borderBottom: "1px solid var(--c-bd1)", cursor: "pointer", background: slashTyping && idx === 0 ? "var(--c-elevated)" : "transparent" }}
                  onMouseDown={(e) => { e.preventDefault(); applySlashCommand(c); }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = slashTyping && idx === 0 ? "var(--c-elevated)" : "transparent"; }}
                >
                  <span style={{ fontSize: 10, fontFamily: "monospace", color: accentColor, minWidth: 70 }}>/{c.aliases[0]}</span>
                  <span style={{ fontSize: 11, color: "var(--c-t2)", flex: 1 }}>{c.label}</span>
                </button>
              ))}
            </div>
          )}
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
        href={safeHref(att.url)}
        target="_blank"
        rel="noreferrer"
        className="block rounded overflow-hidden"
        style={{ width: 80, height: 80, border: "1px solid var(--c-bd2)" }}
        title={att.name}
        onClick={(e) => e.stopPropagation()}
      >
        <MediaImage src={att.url} alt={att.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
        <MediaImage src={att.url} alt={att.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
