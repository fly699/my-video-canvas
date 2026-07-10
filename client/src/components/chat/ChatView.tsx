import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Lock, Paperclip, Send, ShieldCheck, Users, Trash2, LogOut, X, FileIcon, ImageIcon, Film, FolderOpen, Download, Crop, HardDriveUpload, Sparkles, BookOpen, Copy, Server, Mic, Radio, ChevronDown } from "lucide-react";
import { BroadcastComposer } from "./BroadcastComposer";
import { captureScreen, CropSelectOverlay, ScreenshotEditor } from "./ScreenshotEditor";
import { ComfyServerStatusIndicator } from "../canvas/ComfyServerStatusIndicator";
import { useChat, SERVERLESS_ENCRYPT_PROMPT_BYTES } from "@/hooks/useChat";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { CHAT_MODELS } from "@/lib/models";
import { useSelfHostedLlmModels } from "@/lib/useSelfHostedModels";
import { useSystemDefaultModels } from "@/lib/useSystemDefaultModels";
import { useBridgeSkills } from "@/lib/useBridgeSkills";
import { MiniSelect } from "@/components/ui/MiniSelect";
import { useDisabledModels } from "@/lib/useDisabledModels";
import { AI_TEMPLATE_CATEGORIES, ALL_AI_TEMPLATES, BLANK_TEMPLATE_ID, BLANK_TEMPLATE_LABEL, NO_PERSONA_PROMPT } from "@/lib/aiAssistantTemplates";
import { goToAdminTab } from "@/lib/adminNav";
import type { ChatWireMessage, ChatFileRef } from "@shared/types";
import { toast } from "sonner";
import { C, avatarGrad, initials } from "./chatTheme";
import { copyTextWithToast } from "@/lib/clipboard";
import { MessageContent } from "./MessageContent";
import { openLightbox } from "./chatLightbox";

/** Read a File as a bare base64 string (no data: prefix) for chat.uploadFile. */
const fileToBase64 = (f: File): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
  r.onerror = () => reject(r.error ?? new Error("读取文件失败"));
  r.readAsDataURL(f);
});

export function ChatView({ membersOpen: _m, narrow = false }: { membersOpen?: boolean; narrow?: boolean }) {
  const { activeConv, messages, presence, typingUsers, sendText, sendFile, emitTyping, connected, loadingMessages, maxFileMb, serverlessAllowed, e2eAvailable, myUserId, deleteRoom, leaveRoom, reloadActiveMessages, loadEarlierMessages, hasMoreMessages, loadingEarlier } = useChat();
  const [text, setText] = useState("");
  // 移动端：ComfyUI 服务器监控条（GVM）对手机聊天用户是噪音——默认收起，需要时点开。
  const [staged, setStaged] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  // ── 语音消息录制（MediaRecorder → 音频文件 → 走 sendFile 发送）──
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<BlobPart[]>([]);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recSecRef = useRef(0);
  const recCancelRef = useRef(false);
  const recStartingRef = useRef(false);      // B-3：同步守卫，防 await 期间双击起双流
  const recConvIdRef = useRef<number | null>(null); // B-1：录音起始会话 id 快照
  const recStartMsRef = useRef(0);           // 计时按开始时间戳算，避免 setInterval 被节流/丢帧时不走字
  const curConvIdRef = useRef<number | null>(null); // 实时当前会话 id（供 onstop 闭包读「当前」而非冻结值）
  useEffect(() => () => {
    // 卸载时清理录音（关麦克风、停计时器），避免离开聊天后麦克风仍占用。
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    (recStreamRef.current?.getTracks() ?? []).forEach((t) => t.stop());
    try { mediaRecRef.current?.stop(); } catch { /* ignore */ }
  }, []);
  curConvIdRef.current = activeConv?.id ?? null; // 每次 render 同步「当前」会话 id，供 onstop 闭包读取
  // B-1：录音中切换会话 → 立即取消录音；onstop 再用 curConvIdRef（当前会话）与起始会话比对兜底。
  useEffect(() => {
    if (recording && recConvIdRef.current != null && activeConv?.id !== recConvIdRef.current) {
      recCancelRef.current = true;
      try { mediaRecRef.current?.stop(); } catch { /* ignore */ }
    }
    // 仅在会话 id 变化时判断
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv?.id]);
  const [dragOver, setDragOver] = useState(false);
  const [askEncrypt, setAskEncrypt] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  // Screenshots → annotate → stage as an attachment. Both capture via
  // getDisplayMedia (so they work cross-screen / cross-window — the browser
  // requires its share-screen picker once):
  //  • 截图: annotate the whole captured screen/window/tab.
  //  • 框选: then drag a box on the frozen capture to crop to a region first.
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  async function screenshot() {
    if (capturing) return;
    setCapturing(true);
    try {
      const url = await captureScreen();
      if (!url) { toast.info("已取消，或当前浏览器/环境不支持屏幕截图（需 HTTPS）"); return; }
      setCropSrc(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "截图失败");
    } finally { setCapturing(false); }
  }
  const filesQuery = trpc.chat.listFiles.useQuery({ conversationId: activeConv?.id ?? 0 }, { enabled: showFiles && !!activeConv });
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Latest addFiles (defined after the early-return, so reached via a ref).
  const addFilesRef = useRef<(files: File[]) => void>(() => {});
  const utils = trpc.useUtils();
  const setModeMut = trpc.chat.setMode.useMutation();
  const detailQuery = trpc.chat.getConversation.useQuery({ conversationId: activeConv?.id ?? 0 }, { enabled: !!activeConv && activeConv.type === "group" });
  const isOwner = !!detailQuery.data && myUserId != null && detailQuery.data.createdBy === myUserId;

  // ── 内建 AI 助手对话 ────────────────────────────────────────────────────────
  const aiQuery = trpc.chat.assistantUserId.useQuery(undefined, { staleTime: 60 * 60_000, refetchOnWindowFocus: false });
  const isAI = !!activeConv && activeConv.type === "dm" && aiQuery.data?.userId != null && activeConv.peer?.id === aiQuery.data.userId;
  const isBroadcast = !!activeConv?.isBroadcast; // 管理员共享「广播频道」——头部显示「发起广播」，隐藏无关操作
  const disabledModels = useDisabledModels();
  // 聊天 AI 可选模型：受「模型管理 · 聊天」分组开关过滤（独立于 LLM 节点的开关，键加 "chat:" 前缀）。
  const _selfHostedChat = useSelfHostedLlmModels();
  const _chatPool = _selfHostedChat.length ? [..._selfHostedChat.filter((x) => !CHAT_MODELS.some((m) => m.id === x.id)), ...CHAT_MODELS] : CHAT_MODELS;
  const chatModels = _chatPool.filter((m) => !m.hidden && !disabledModels.has("chat:" + m.id));
  const [chatModel, setChatModel] = useState<string>(() => localStorage.getItem("chat:aiModel") || "");
  // 默认模型：用户显式选过的优先；否则用管理员「系统默认」的 LLM（若可用且未被停用）；再否则列表第一个。
  const sysDefaultLlm = useSystemDefaultModels().llm;
  const effModel = chatModels.find((m) => m.id === chatModel)?.id
    ?? chatModels.find((m) => m.id === sysDefaultLlm)?.id
    ?? chatModels[0]?.id;

  // 「/ 唤起技能」：仅本机 Claude 桥接模型（技能是 Claude 能力）且服务端放行了 Skill 时启用。
  // 输入以 / 开头且后面是技能名片段（无空白）时，弹出可选技能列表。
  const isClaudeLocalModel = !!effModel && effModel.toLowerCase().startsWith("claude-local");
  const bridgeSkills = useBridgeSkills(isAI && isClaudeLocalModel);
  const [skillHi, setSkillHi] = useState(0);
  const [skillDismiss, setSkillDismiss] = useState("");
  const slashFrag = /^\/([^\s/]*)$/.exec(text)?.[1];
  const skillMatches = useMemo(() => {
    if (slashFrag === undefined) return [];
    const q = slashFrag.toLowerCase();
    return bridgeSkills.skills
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      .slice(0, 8);
  }, [slashFrag, bridgeSkills.skills]);
  const showSkillPicker = isAI && isClaudeLocalModel && bridgeSkills.enabled
    && slashFrag !== undefined && text !== skillDismiss && skillMatches.length > 0;
  useEffect(() => { setSkillHi(0); }, [slashFrag]);
  const pickSkill = (name: string) => { setText(`用 ${name} 技能：`); setSkillDismiss(""); };
  // AI 助手「模板」人设：复用 ai_chat 节点的同一套模板（ALL_AI_TEMPLATES）。存模板 id，
  // 发送时解析为其 prompt 作为 systemPrompt 传给后端。默认「空模板」（无人设）；?? 只在从未选过
  // 时生效——老用户显式选过的「默认助手」("" 空串) 仍保留。
  const [chatTemplate, setChatTemplate] = useState<string>(() => localStorage.getItem("chat:aiTemplate") ?? BLANK_TEMPLATE_ID);
  const effSystemPrompt = chatTemplate === BLANK_TEMPLATE_ID ? NO_PERSONA_PROMPT : ALL_AI_TEMPLATES.find((t) => t.id === chatTemplate)?.prompt;
  const sendToAssistantMut = trpc.chat.sendToAssistant.useMutation();
  const clearAssistantMut = trpc.chat.clearAssistant.useMutation();
  const uploadFileMut = trpc.chat.uploadFile.useMutation();
  const pickChatModel = (id: string) => { setChatModel(id); localStorage.setItem("chat:aiModel", id); };
  const pickChatTemplate = (id: string) => {
    setChatTemplate(id);
    localStorage.setItem("chat:aiTemplate", id);
    const name = id === BLANK_TEMPLATE_ID ? BLANK_TEMPLATE_LABEL : id ? (ALL_AI_TEMPLATES.find((t) => t.id === id)?.label ?? id) : "默认助手";
    // 已有历史时，旧角色可能因对话惯性残留——提示用「新对话」彻底切换。
    if (id && isAI && messages.length > 0) {
      toast.success(`已切换模板：${name}。若 AI 仍沿用旧角色，点右上角「新对话」清空历史即可彻底切换`, { duration: 4000 });
    } else {
      toast.success(`已切换 AI 助手模板：${name}`, { duration: 1500 });
    }
  };

  // 前插「更早消息」时不要自动滚到底（否则视口会跳走）；由 onLoadEarlier 用锚点恢复位置。
  const prependingRef = useRef(false);
  // 仅当用户已在底部附近时，新消息才自动置底——否则用户正在回看历史会被强行拽回底部。
  const nearBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const onListScroll = () => {
    const el = scrollRef.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    nearBottomRef.current = near;
    setShowJumpToBottom(!near);
  };
  const jumpToBottom = () => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; nearBottomRef.current = true; setShowJumpToBottom(false); };
  useEffect(() => {
    if (prependingRef.current) return;
    if (!nearBottomRef.current) return; // 用户在回看历史 → 不打断
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);
  // 切换会话时重置为「在底部」，确保新会话首屏落到最新消息。
  useEffect(() => { nearBottomRef.current = true; setShowJumpToBottom(false); }, [activeConv?.id]);

  // 加载更早消息并保持滚动锚点：记录加载前的 scrollHeight/scrollTop，前插后按高度差回补 scrollTop。
  const onLoadEarlier = async () => {
    const el = scrollRef.current;
    const prevH = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    prependingRef.current = true;
    await loadEarlierMessages();
    requestAnimationFrame(() => {
      const el2 = scrollRef.current;
      if (el2) el2.scrollTop = prevTop + (el2.scrollHeight - prevH);
      prependingRef.current = false;
    });
  };

  // Document-level paste so Ctrl+V works even when the textarea isn't focused —
  // notably in a standalone PWA window where focus often sits on <body>. Skips
  // when another editable element OUTSIDE the chat is focused (let it paste) and
  // when the textarea handler already consumed the event (defaultPrevented).
  useEffect(() => {
    const onDocPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || !e.clipboardData) return;
      const ae = document.activeElement as HTMLElement | null;
      const insideChat = !!rootRef.current && !!ae && rootRef.current.contains(ae);
      const editableOutside = !!ae && !insideChat &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable);
      if (editableOutside) return;
      const files = Array.from(e.clipboardData.items)
        .filter((it) => it.kind === "file")
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length > 0) { e.preventDefault(); addFilesRef.current(files); }
    };
    document.addEventListener("paste", onDocPaste);
    return () => document.removeEventListener("paste", onDocPaste);
  }, []);

  if (!activeConv) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: C.bg }}>
        <PersistentAnnounceBanner narrow={narrow} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <img src="/chat-icon.svg" width={72} height={72} alt="" style={{ opacity: 0.5, borderRadius: 18 }} />
          <div style={{ color: C.t3, fontSize: 14 }}>选择一个会话开始聊天</div>
        </div>
      </div>
    );
  }

  const title = activeConv.type === "dm" ? (activeConv.peer?.name ?? "私聊") : activeConv.type === "lobby" ? "大厅" : (activeConv.title ?? "群聊");

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const tooBig = arr.find((f) => f.size > maxFileMb * 1024 * 1024);
    if (tooBig) { toast.error(`「${tooBig.name}」超过上限 ${maxFileMb}MB`); }
    setStaged((prev) => [...prev, ...arr.filter((f) => f.size <= maxFileMb * 1024 * 1024)]);
  }
  addFilesRef.current = addFiles;

  async function doSend(encrypt?: boolean) {
    if (busy) return;
    if (!text.trim() && staged.length === 0) return;
    // AI 助手会话：把输入（文本 + 图片附件）发给 LLM，用户消息与 AI 回复经广播实时回灌到列表。
    if (isAI) {
      if (!text.trim() && staged.length === 0) return;
      if (!effModel) { toast.error("没有可用的聊天 AI 模型（管理员可能已全部停用）"); return; }
      if (busy || sendToAssistantMut.isPending) return;
      const content = text.trim();
      const files = staged;
      setText(""); setStaged([]);
      setBusy(true);
      try {
        let attachmentIds: number[] | undefined;
        if (files.length > 0) {
          attachmentIds = await Promise.all(files.map(async (f) => {
            const base64 = await fileToBase64(f);
            const r = await uploadFileMut.mutateAsync({ conversationId: activeConv!.id, base64, mimeType: f.type || "application/octet-stream", filename: f.name });
            return r.attachmentId;
          }));
        }
        await sendToAssistantMut.mutateAsync({
          conversationId: activeConv!.id, content, model: effModel,
          kieTempKey: localStorage.getItem("kie:tempKey") || undefined, attachmentIds,
          systemPrompt: effSystemPrompt,
        });
        // 兜底：发完直接从服务器权威重载，确保「用户消息 + AI 回复」立刻显示，不必等
        // socket 广播（隧道/弱网下广播可能丢，否则就出现「回答不显示、刷新才有」）。
        reloadActiveMessages();
      } catch (e) { toast.error(e instanceof Error ? e.message : "AI 回复失败"); setText(content); setStaged(files); }
      finally { setBusy(false); }
      return;
    }
    // serverless large file → ask encrypt vs fast (once for the batch)
    if (activeConv!.mode === "serverless" && encrypt === undefined && staged.some((f) => f.size > SERVERLESS_ENCRYPT_PROMPT_BYTES)) {
      setAskEncrypt(true); return;
    }
    setBusy(true);
    try {
      if (text.trim()) { await sendText(text); setText(""); }
      for (const f of staged) {
        await sendFile(f, activeConv!.mode === "serverless" ? { encrypt: encrypt ?? true } : undefined);
      }
      setStaged([]);
    } catch (e) { toast.error(e instanceof Error ? e.message : "发送失败"); }
    finally { setBusy(false); }
  }

  // ── 语音消息 ──
  function pickRecMime(): string {
    const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    for (const m of cands) { try { if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m; } catch { /* ignore */ } }
    return "";
  }
  async function startRec() {
    // B-3：recording 是 state，getUserMedia await 期间还是 false，双击会起两条流。
    // 用同步 ref + 现存实例双重守卫。
    if (recording || recStartingRef.current || mediaRecRef.current || recStreamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { toast.error("当前浏览器不支持录音"); return; }
    recStartingRef.current = true;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStreamRef.current = stream;
      recConvIdRef.current = activeConv?.id ?? null; // B-1：快照录音起始会话
      const mime = pickRecMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recChunksRef.current = [];
      recCancelRef.current = false;
      rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunksRef.current.push(e.data); };
      rec.onstop = () => {
        (recStreamRef.current?.getTracks() ?? []).forEach((t) => t.stop());
        recStreamRef.current = null;
        mediaRecRef.current = null; // 释放实例，否则并发守卫会挡住下一次录音
        if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
        setRecording(false);
        const secs = recSecRef.current;
        recSecRef.current = 0; setRecSec(0);
        const startConvId = recConvIdRef.current; recConvIdRef.current = null;
        const chunks = recChunksRef.current; recChunksRef.current = [];
        if (recCancelRef.current) return;
        // B-1：若录音期间切走了会话，绝不把语音发到「当前」的另一个会话（可能是另一群人 / 明文）。
        // 读 curConvIdRef（实时当前会话），而非 onstop 闭包里被冻结的 activeConv——否则此守卫恒 false。
        if (startConvId != null && curConvIdRef.current !== startConvId) { toast.info("已切换会话，语音未发送"); return; }
        const type = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks, { type });
        if (blob.size < 800 || secs < 1) { toast.info("录音太短，已取消"); return; }
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `语音-${Date.now()}.${ext}`, { type });
        // 不读 onstop 闭包里冻结的 activeConv：sendFile 内部按「当前会话」的 mode 自行判定，
        // serverless 缺省即加密（encrypt !== false），server 模式忽略此项——无明文泄露风险。
        void sendFile(file);
      };
      mediaRecRef.current = rec;
      rec.start();
      setRecording(true);
      recStartMsRef.current = Date.now();
      recSecRef.current = 0; setRecSec(0);
      recTimerRef.current = setInterval(() => {
        // 按真实经过时间计算，节流/丢帧也不会「不走字」或偏慢。
        const sec = Math.max(0, Math.floor((Date.now() - recStartMsRef.current) / 1000));
        recSecRef.current = sec; setRecSec(sec);
        if (sec >= 300) stopRec(true); // 5 分钟上限自动发送
      }, 500);
    } catch {
      // B-2：MediaRecorder 构造/start 抛错等路径必须关掉已拿到的麦克风流，否则麦克风常亮。
      (stream?.getTracks() ?? recStreamRef.current?.getTracks() ?? []).forEach((t) => t.stop());
      recStreamRef.current = null;
      mediaRecRef.current = null;
      toast.error("无法录音：请在浏览器授予麦克风权限");
    } finally {
      recStartingRef.current = false;
    }
  }
  function stopRec(send: boolean) {
    recCancelRef.current = !send;
    try { mediaRecRef.current?.stop(); } catch { /* ignore */ }
  }
  const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  async function toggleMode() {
    if (activeConv!.type === "lobby") { toast.error("大厅模式不可更改"); return; }
    const next = activeConv!.mode === "server" ? "serverless" : "server";
    if (next === "serverless" && !serverlessAllowed) { toast.error("管理员已禁用端到端加密模式"); return; }
    if (next === "serverless" && !e2eAvailable) { toast.error("端到端加密需在 HTTPS 或 localhost 环境下使用"); return; }
    try {
      await setModeMut.mutateAsync({ conversationId: activeConv!.id, mode: next });
      utils.chat.listConversations.invalidate();
      toast.success(next === "serverless" ? "已切换为端到端加密（无服务器）" : "已切换为服务器模式");
    } catch (e) { toast.error(e instanceof Error ? e.message : "切换失败"); }
  }
  async function onDelete() { if (confirm("确定删除该群聊？所有消息将被清除，且对所有成员生效。")) { try { await deleteRoom(activeConv!.id); toast.success("群聊已删除"); } catch (e) { toast.error(e instanceof Error ? e.message : "删除失败"); } } }
  async function onLeave() { if (confirm("确定退出该群聊？")) { try { await leaveRoom(activeConv!.id); toast.success("已退出群聊"); } catch (e) { toast.error(e instanceof Error ? e.message : "退出失败"); } } }
  async function onDeleteDm() { if (confirm("确定删除该私聊？将清除聊天记录，且对双方生效。")) { try { await deleteRoom(activeConv!.id); toast.success("私聊已删除"); } catch (e) { toast.error(e instanceof Error ? e.message : "删除失败"); } } }

  return (
    <div ref={rootRef} style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: C.bg, position: "relative" }}
         onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
         onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
         onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
      {/* 持续公告：顶部常驻横幅（全员可见、间隔闪烁），管理员可关闭，到期自动消失 */}
      <PersistentAnnounceBanner narrow={narrow} />
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: narrow ? "9px 12px" : "12px 18px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: narrow ? 8 : 11 }}>
          <span style={{ width: narrow ? 32 : 38, height: narrow ? 32 : 38, borderRadius: narrow ? 9 : 11, fontSize: narrow ? 13 : 14, background: avatarGrad(activeConv.type === "dm" ? `u${activeConv.peer?.id}` : `c${activeConv.id}`), color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>{initials(title)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 7 }}>
              {title}{activeConv.isPrivate && <Lock size={13} style={{ color: C.t3 }} />}
            </div>
            <div style={{ fontSize: 12, color: C.t3, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? C.online : C.offline, display: "inline-block" }} />
              <Users size={12} /> {presence.length} 在线 · {connected ? "已连接" : "连接中…"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: narrow ? 4 : 6, flexShrink: 0 }}>
          {/* 复制整段对话（含发言人标注）到剪贴板 */}
          {messages.length > 0 && (
            <button
              onClick={() => {
                const text = messages
                  .map((m) => ({ name: m.senderName || (m.senderId === myUserId ? "我" : "对方"), content: (m.content || "").replace(/^\[#DLREQ:\d+\]\n?/, "").trim() }))
                  .filter((m) => m.content)
                  .map((m) => `${m.name}：${m.content}`)
                  .join("\n\n");
                void copyTextWithToast(text, "已复制整段对话", { duration: 1400 });
              }}
              title="复制整段对话"
              style={{ ...pill, ...(narrow ? pillIcon : {}), border: `1px solid ${C.borderStrong}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1 }}
            ><Copy size={13} />{!narrow && " 复制全部"}</button>
          )}
          {/* AI 助手「新对话」：清空共享历史 → 换人设后从零开始，彻底摆脱旧角色惯性 */}
          {isAI && (
            <button
              onClick={() => {
                if (clearAssistantMut.isPending) return;
                clearAssistantMut.mutate({ conversationId: activeConv!.id }, {
                  onSuccess: () => {
                    // 从服务器权威重载（清空后 DB 为空）→ 不依赖 socket 广播，
                    // 隧道/弱网下也能立即清掉本地消息列表。先失效缓存再重载，避免取到旧缓存。
                    void utils.chat.getMessages.invalidate({ conversationId: activeConv!.id });
                    reloadActiveMessages();
                    toast.success("已清空，开启新对话（下一条消息将以当前模板人设回复）", { duration: 2200 });
                  },
                  onError: (e) => toast.error("清空失败：" + e.message),
                });
              }}
              title="新对话（清空 AI 助手历史，换人设后从零开始）"
              style={{ ...pill, ...(narrow ? pillIcon : {}), border: `1px solid ${C.borderStrong}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1 }}
            ><Sparkles size={13} />{!narrow && " 新对话"}</button>
          )}
          {/* 广播频道：管理员专属，头部主操作是「发起广播」（多选收件人） */}
          {isBroadcast && (
            <button onClick={() => setShowBroadcast(true)} title="发起广播（可复选收件人：全体 / 成员 / 房间群组）" style={{ ...pill, ...(narrow ? pillIcon : {}), border: `1px solid ${C.accent}`, background: C.accentSoft, color: C.accent, fontWeight: 600 }}><Radio size={13} />{!narrow && " 发起广播"}</button>
          )}
          {/* AI 助手会话：不是真人/群聊，隐藏 文件/中转站/删除/模式切换等无关按钮 */}
          {!isAI && !isBroadcast && <button onClick={() => setShowFiles(true)} title="文件" style={{ ...pill, ...(narrow ? pillIcon : {}), border: `1px solid ${C.borderStrong}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1 }}><FolderOpen size={13} />{!narrow && " 文件"}</button>}
          {!isAI && !isBroadcast && !narrow && <button onClick={() => window.open("/relay", "_blank", "noopener")} title="局域网大文件中转站（几十 GB 大文件传输，支持断点续传）" style={{ ...pill, border: `1px solid ${C.borderStrong}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1 }}><HardDriveUpload size={13} /> 中转站</button>}
          {activeConv.type === "group" && !isBroadcast && (isOwner
            ? <button onClick={onDelete} title="删除群聊（群主）" style={{ ...pill, ...(narrow ? pillIcon : {}), border: `1px solid rgba(239,68,68,0.3)`, background: C.dangerSoft, color: C.danger }}><Trash2 size={13} />{!narrow && " 删除"}</button>
            : <button onClick={onLeave} title="退出群聊" style={{ ...pill, ...(narrow ? pillIcon : {}), border: `1px solid ${C.borderStrong}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1 }}><LogOut size={13} />{!narrow && " 退出"}</button>
          )}
          {activeConv.type === "dm" && !isAI && (
            <button onClick={onDeleteDm} title="删除该私聊" style={{ ...pill, ...(narrow ? pillIcon : {}), border: `1px solid rgba(239,68,68,0.3)`, background: C.dangerSoft, color: C.danger }}><Trash2 size={13} />{!narrow && " 删除"}</button>
          )}
          {activeConv.type !== "lobby" && !isAI && !isBroadcast && (
            <button onClick={toggleMode} title={activeConv.mode === "serverless" ? "当前端到端加密，点击切回服务器模式" : "当前服务器模式，点击切换端到端加密"} style={{ ...pill, ...(narrow ? pillIcon : {}), border: `1px solid ${activeConv.mode === "serverless" ? C.accent : C.borderStrong}`, background: activeConv.mode === "serverless" ? C.accentSoft : "var(--c-elevated, rgba(128,128,128,0.10))", color: activeConv.mode === "serverless" ? C.accent : C.t1 }}>
              {activeConv.mode === "serverless" ? <><ShieldCheck size={13} />{!narrow && " 加密"}</> : <>服务器</>}
            </button>
          )}
        </div>
      </div>

      {/* 服务器状态指示（ComfyUI GVM 监控）—— 一行直接显示状态，桌面/移动端一致，不折叠 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: narrow ? "5px 12px" : "6px 18px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, overflowX: "auto" }}>
        <Server size={12} style={{ color: C.t3, flexShrink: 0 }} />
        <ComfyServerStatusIndicator />
      </div>

      {/* 端到端加密模式警示 */}
      {activeConv.mode === "serverless" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 18px", background: C.accentSoft, borderBottom: `1px solid ${C.accent}`, flexShrink: 0 }}>
          <Lock size={14} style={{ color: C.accent, flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: C.accent, lineHeight: 1.5 }}>
            聊天记录仅保存在本设备，管理员也无法查看或恢复。
          </span>
        </div>
      )}

      {/* messages */}
      <div ref={scrollRef} onScroll={onListScroll} style={{ flex: 1, overflowY: "auto", padding: narrow ? "12px 10px" : "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {loadingMessages && <div style={{ alignSelf: "center", color: C.t3, fontSize: 13 }}>加载中…</div>}
        {!loadingMessages && hasMoreMessages && (
          <button onClick={() => void onLoadEarlier()} disabled={loadingEarlier}
            style={{ alignSelf: "center", padding: "5px 14px", borderRadius: 999, border: `1px solid ${C.border}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t2, fontSize: 12, cursor: loadingEarlier ? "default" : "pointer", opacity: loadingEarlier ? 0.6 : 1 }}>
            {loadingEarlier ? "加载中…" : "加载更早消息"}
          </button>
        )}
        {!loadingMessages && messages.length === 0 && <div style={{ alignSelf: "center", color: C.t4, fontSize: 13 }}>还没有消息，发送第一条吧</div>}
        {messages.map((m) => <Bubble key={`${m.id}-${m.createdAt}`} msg={m} mine={m.senderId === -1 || m.senderId === myUserId} narrow={narrow} />)}
        {typingUsers.length > 0 && <div style={{ fontSize: 12, color: C.t3 }}>{typingUsers.join("、")} 正在输入…</div>}
        {isAI && sendToAssistantMut.isPending && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: C.accent }}>
            <Sparkles size={13} /> AI 正在思考…
          </div>
        )}
      </div>

      {/* 回到底部（用户在回看历史、新消息不再自动置底时出现） */}
      {showJumpToBottom && (
        <button onClick={jumpToBottom} title="回到最新消息" aria-label="回到最新消息"
          style={{ position: "absolute", right: narrow ? 12 : 20, bottom: 92, zIndex: 8, width: 38, height: 38, borderRadius: "50%", border: `1px solid ${C.borderStrong}`, background: C.surface, color: C.t1, cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.25)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <ChevronDown size={18} />
        </button>
      )}

      {/* AI 模型选择（仅 AI 助手会话） */}
      {isAI ? (
        <div style={{ display: "flex", alignItems: "center", gap: narrow ? 6 : 8, padding: narrow ? "6px 10px 0" : "6px 16px 0", fontSize: 11.5, color: C.t3, flexWrap: "wrap" }}>
          <Sparkles size={13} style={{ color: C.accent }} />
          <span>AI 模型</span>
          {chatModels.length === 0 ? (
            <span style={{ color: C.danger }}>管理员已停用全部聊天模型</span>
          ) : (
            <MiniSelect
              value={effModel ?? ""}
              placeholder="模型"
              maxWidth={200}
              accent={C.accent} accentSoft={C.accentSoft}
              groups={[{ options: chatModels.map((m) => ({ value: m.id, label: m.label })) }]}
              onChange={pickChatModel}
            />
          )}
          {/* 模板（人设）—— 复用 ai_chat 节点的同一套模板，选中即设定 AI 助手系统提示词。
              用自绘下拉而非原生 <select>：聊天窗在画布里会被 transform: scale 缩放，
              缩放下原生 select 弹层点击会错位/不生效（Chromium 已知问题）。 */}
          <BookOpen size={13} style={{ color: C.accent, marginLeft: 4 }} />
          <span>模板</span>
          <MiniSelect
            value={chatTemplate}
            placeholder="默认助手"
            maxWidth={190}
            accent={C.accent} accentSoft={C.accentSoft}
            title={chatTemplate === BLANK_TEMPLATE_ID ? "无任何人设，通用助手直接回答" : effSystemPrompt ? ALL_AI_TEMPLATES.find((t) => t.id === chatTemplate)?.blurb : "默认助手人设"}
            groups={[
              { options: [{ value: BLANK_TEMPLATE_ID, label: BLANK_TEMPLATE_LABEL, title: "不设任何人设/角色/风格" }, { value: "", label: "默认助手" }] },
              ...AI_TEMPLATE_CATEGORIES.map((cat) => ({ label: cat.label, options: cat.templates.map((t) => ({ value: t.id, label: t.label, title: t.blurb })) })),
            ]}
            onChange={pickChatTemplate}
          />
          {isClaudeLocalModel && bridgeSkills.enabled && bridgeSkills.skills.length > 0 && (
            <span style={{ color: C.accent }}>· 输入 <strong>/</strong> 选技能</span>
          )}
          {!narrow && <span style={{ color: C.t4 }}>· 与 AI 助手的对话内容会经服务器处理</span>}
        </div>
      ) : (
        /* limit hint */
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 16px 0", fontSize: 11, color: C.t3, flexWrap: "wrap" }}>
          <span>单文件 ≤ <strong style={{ color: C.t2 }}>{maxFileMb}MB</strong></span>
          {!serverlessAllowed && <><span>·</span><span>管理员已禁用端到端模式</span></>}
        </div>
      )}

      {/* staging area */}
      {staged.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "8px 16px 0" }}>
          {staged.map((f, i) => <StagedChip key={i} file={f} onRemove={() => setStaged((p) => p.filter((_, j) => j !== i))} />)}
        </div>
      )}

      {/* 「/ 唤起技能」面板：输入以 / 开头时浮在输入框上方 */}
      {showSkillPicker && (
        <div style={{ position: "relative", padding: narrow ? "0 10px" : "0 16px", flexShrink: 0 }}>
          <div className="nowheel" style={{ position: "absolute", bottom: 4, left: narrow ? 10 : 16, right: narrow ? 10 : 16, maxHeight: 260, overflowY: "auto",
            background: "var(--c-elevated, #1b1b1f)", border: `1px solid ${C.borderStrong}`, borderRadius: 10, boxShadow: "0 12px 34px rgba(0,0,0,0.45)", zIndex: 40, padding: 5 }}>
            <div style={{ fontSize: 10.5, color: C.t4, padding: "3px 8px 5px" }}>技能 · ↑↓ 选择 · Enter 确认 · Esc 关闭</div>
            {skillMatches.map((s, i) => (
              <button key={s.name} type="button"
                onMouseEnter={() => setSkillHi(i)}
                onClick={() => pickSkill(s.name)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 9px", borderRadius: 7, border: "none", cursor: "pointer",
                  background: i === skillHi ? C.accentSoft : "transparent", color: C.t1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: i === skillHi ? C.accent : C.t1 }}>/{s.name}</div>
                {s.description && <div style={{ fontSize: 11, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.description}</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 广播频道：普通消息不会广播，底部改为醒目的「发起广播」CTA（多选收件人） */}
      {isBroadcast ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: narrow ? "10px 12px calc(14px + env(safe-area-inset-bottom, 0px))" : "12px 16px 16px", flexShrink: 0, borderTop: `1px solid ${C.border}` }}>
          <button onClick={() => setShowBroadcast(true)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "11px 16px", borderRadius: 11, border: `1px solid ${C.accent}`, background: C.accentSoft, color: C.accent, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            <Radio size={16} /> 发起广播
          </button>
          <span style={{ fontSize: 11, color: C.t4, textAlign: "center" }}>可复选接收对象：全体用户 / 指定成员 / 房间群组 · 下发到各自「系统公告」房并实时提醒</span>
        </div>
      ) : (
      /* input */
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: narrow ? "8px 10px calc(12px + env(safe-area-inset-bottom, 0px))" : "8px 16px 14px", flexShrink: 0 }}>
        <input ref={fileRef} type="file" hidden multiple onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        {recording ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 12, border: `1px solid ${C.accent}`, background: C.accentSoft }}>
            <button onClick={() => stopRec(false)} title="取消录音" style={iconBtn}><X size={18} /></button>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: C.accent, fontWeight: 600, fontSize: 14 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ef4444" }} /> 录音中 {fmtSec(recSec)}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={() => stopRec(true)} title="发送语音" style={{ ...iconBtn, width: 40, height: 40, background: C.accentSoft, color: C.accent, border: `1px solid ${C.accent}` }}><Send size={18} /></button>
          </div>
        ) : (<>
        <button onClick={() => fileRef.current?.click()} title={isAI ? "添加附件（图片可作参考图，需视觉模型）" : `添加文件（单文件 ≤ ${maxFileMb}MB）`} style={iconBtn}><Paperclip size={18} /></button>
        {!isAI && <button onClick={() => screenshot()} disabled={capturing} title="框选截图（跨屏跨窗口：选择屏幕/窗口后，在截图上拖框选区域）" style={{ ...iconBtn, opacity: capturing ? 0.5 : 1 }}><Crop size={18} /></button>}
        {!isAI && <button onClick={() => void startRec()} title="录制语音消息" style={iconBtn}><Mic size={18} /></button>}
        <textarea value={text} onChange={(e) => { setText(e.target.value); emitTyping(); }}
          onKeyDown={(e) => {
            // 技能面板开着时，方向键/Enter/Esc/Tab 归面板用，不触发发送。
            if (showSkillPicker) {
              if (e.key === "ArrowDown") { e.preventDefault(); setSkillHi((i) => (i + 1) % skillMatches.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setSkillHi((i) => (i - 1 + skillMatches.length) % skillMatches.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickSkill(skillMatches[skillHi].name); return; }
              if (e.key === "Escape") { e.preventDefault(); setSkillDismiss(text); return; }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void doSend(); }
          }}
          onPaste={(e) => {
            // Support pasting files of any type (screenshots, images, docs…). The
            // clipboard exposes them via items (type "file") — pull out the Files
            // and stage them; only swallow the paste when files were present so
            // normal text paste still works.
            const files = Array.from(e.clipboardData.items)
              .filter((it) => it.kind === "file")
              .map((it) => it.getAsFile())
              .filter((f): f is File => !!f);
            if (files.length > 0) { e.preventDefault(); addFiles(files); }
          }}
          placeholder={narrow
            ? (isAI ? "向 AI 助手提问…" : "发送消息…")
            : (isAI ? "向 AI 助手提问，Enter 发送、Shift+Enter 换行" : "Enter 发送，Shift+Enter 换行，可拖拽或粘贴文件到此")} rows={1}
          style={{ flex: 1, resize: "none", maxHeight: 140, padding: "10px 14px", borderRadius: 12, border: `1px solid ${C.border}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1, fontSize: 14, outline: "none", fontFamily: "inherit" }} />
        <button onClick={() => doSend()} disabled={busy || sendToAssistantMut.isPending || (!text.trim() && staged.length === 0)} title="发送"
          style={{ ...iconBtn, width: 40, height: 40, background: C.accentSoft, color: C.accent, border: `1px solid ${C.accent}`, opacity: busy || sendToAssistantMut.isPending || (!text.trim() && staged.length === 0) ? 0.5 : 1 }}>
          <Send size={18} />
        </button>
        </>)}
      </div>
      )}

      {/* Screenshot annotate editor (portal) */}
      {cropSrc && <CropSelectOverlay imageUrl={cropSrc} onCancel={() => setCropSrc(null)} onSelect={(url) => { setCropSrc(null); setShotUrl(url); }} />}
      {shotUrl && <ScreenshotEditor imageUrl={shotUrl} onCancel={() => setShotUrl(null)} onConfirm={(file) => { addFiles([file]); setShotUrl(null); }} />}

      {/* drag overlay */}
      {dragOver && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(245,158,11,0.08)", border: `2px dashed ${C.accent}`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 5 }}>
          <span style={{ color: C.accent, fontWeight: 700, fontSize: 16 }}>松手添加到待发送</span>
        </div>
      )}

      {/* large serverless file: encrypt vs fast */}
      {askEncrypt && (
        <div onClick={() => setAskEncrypt(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: "90vw", background: C.surfaceFlat, border: `1px solid ${C.borderStrong}`, borderRadius: 16, padding: 22 }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>大文件传输方式</div>
            <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.6, marginBottom: 18 }}>有文件超过 100MB。端到端加密会逐块加密、较慢；也可<strong>不加密直传</strong>显著提速（明文经服务器中转，仍不落库）。</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => { setAskEncrypt(false); void doSend(true); }} style={{ padding: "11px 0", border: `1px solid ${C.borderStrong}`, borderRadius: 10, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1, fontWeight: 700, cursor: "pointer" }}>🔒 加密发送（安全，较慢）</button>
              <button onClick={() => { setAskEncrypt(false); void doSend(false); }} style={{ padding: "11px 0", border: "none", borderRadius: 10, background: C.accentSoft, color: C.accent, fontWeight: 700, cursor: "pointer" }}>⚡ 不加密快速发送</button>
            </div>
          </div>
        </div>
      )}

      {/* 广播编辑器（管理员发起广播，多选收件人） */}
      {showBroadcast && <BroadcastComposer onClose={() => setShowBroadcast(false)} />}

      {/* files history */}
      {showFiles && (
        <div onClick={() => setShowFiles(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "92vw", maxHeight: "80vh", overflow: "auto", background: C.surfaceFlat, border: `1px solid ${C.borderStrong}`, borderRadius: 16, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontWeight: 800, fontSize: 16 }}>文件历史</span>
              <button onClick={() => setShowFiles(false)} style={iconBtn}><X size={16} /></button>
            </div>
            {activeConv.mode === "serverless"
              ? <div style={{ fontSize: 13, color: C.t3 }}>🔒 端到端加密会话的文件不在服务器留存，无法在此列出。</div>
              : (filesQuery.data?.length === 0
                  ? <div style={{ fontSize: 13, color: C.t3 }}>暂无文件</div>
                  : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 10 }}>
                      {filesQuery.data?.map((f) => (
                        <a key={f.id} href={f.url} download={f.name} target="_blank" rel="noreferrer" style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8, borderRadius: 10, border: `1px solid ${C.border}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1, textDecoration: "none" }}>
                          {f.kind === "image"
                            ? <img src={f.url} alt={f.name} style={{ width: "100%", height: 80, objectFit: "cover", borderRadius: 7 }} />
                            : <span style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center", color: C.t2, background: "var(--c-elevated, rgba(128,128,128,0.10))", borderRadius: 7 }}>{f.kind === "video" ? <Film size={26} /> : <FileIcon size={26} />}</span>}
                          <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                          <span style={{ fontSize: 11, color: C.t3, display: "flex", alignItems: "center", gap: 4 }}><Download size={11} /> {Math.round(f.size / 1024)} KB</span>
                        </a>
                      ))}
                    </div>)}
          </div>
        </div>
      )}
    </div>
  );
}

function StagedChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImg = file.type.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (isImg) { const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); } }, [file, isImg]);
  const Icon = file.type.startsWith("video/") ? Film : file.type.startsWith("image/") ? ImageIcon : FileIcon;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 6px 6px", borderRadius: 10, border: `1px solid ${C.border}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", maxWidth: 220 }}>
      {url ? <img src={url} alt="" style={{ width: 34, height: 34, borderRadius: 7, objectFit: "cover" }} />
           : <span style={{ width: 34, height: 34, borderRadius: 7, background: "var(--c-elevated, rgba(128,128,128,0.10))", display: "inline-flex", alignItems: "center", justifyContent: "center", color: C.t2 }}><Icon size={17} /></span>}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130 }}>{file.name}</div>
        <div style={{ fontSize: 11, color: C.t3 }}>{(file.size / 1024 / 1024).toFixed(1)}MB</div>
      </div>
      <button onClick={onRemove} title="移除" style={{ marginLeft: "auto", width: 22, height: 22, borderRadius: 6, border: "none", background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t2, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><X size={13} /></button>
    </div>
  );
}

function Bubble({ msg, mine, narrow }: { msg: ChatWireMessage; mine: boolean; narrow?: boolean }) {
  // Download-request messages carry a leading [#DLREQ:<grantId>] marker → strip
  // it from display and render an inline approve control (admins only).
  const dl = msg.content.match(/^\[#DLREQ:(\d+)\]\n?/);
  const displayContent = dl ? msg.content.slice(dl[0].length) : msg.content;
  return (
    <div className="group/msg" style={{ display: "flex", gap: 9, alignItems: "flex-start", flexDirection: mine ? "row-reverse" : "row" }}>
      <span style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, background: avatarGrad(`u${msg.senderId}`), color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{initials(msg.senderName || "我")}</span>
      <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 3, maxWidth: narrow ? "86%" : "72%" }}>
        {!mine && <span style={{ fontSize: 11, color: C.t3, paddingLeft: 2 }}>{msg.senderName}</span>}
        <div style={{ padding: "9px 13px", borderRadius: 14, fontSize: 14, lineHeight: 1.55, wordBreak: "break-word",
          background: mine ? C.accentSoft : C.surfaceFlat, color: C.t1,
          border: `1px solid ${mine ? "rgba(245,158,11,0.30)" : C.border}`, borderTopRightRadius: mine ? 4 : 14, borderTopLeftRadius: mine ? 14 : 4 }}>
          <MessageContent content={displayContent} />
          {msg.attachments?.map((a, i) => <Attachment key={i} a={a} mine={mine} />)}
          {dl && <DownloadApproveInline grantId={Number(dl[1])} />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: mine ? "row-reverse" : "row" }}>
          <span style={{ fontSize: 10, color: C.t4, padding: "0 2px" }}>{new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          {displayContent.trim() && (
            <button
              onClick={() => void copyTextWithToast(displayContent, "已复制", { duration: 1200 })}
              // 窄屏（移动端）无 hover，hover 才显示等于永远不可见 → 窄屏常显（淡色不扰）。
              className={narrow ? "" : "opacity-0 group-hover/msg:opacity-100 transition-opacity"}
              style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: C.t4, background: "none", border: "none", cursor: "pointer", padding: 0 }}
              title="复制本条消息"
            >
              <Copy size={11} /> 复制
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 持续公告横幅：聊天窗顶部常驻突出显示并间隔闪烁（全员可见），直至管理员关闭或到期。
 *  数据来自 chat.getPersistentAnnouncement；set/clear 经 socket "system:announce:persistent"
 *  在 useChat 里 invalidate 该查询实时刷新。管理员(L3+) 显示关闭按钮。 */
function PersistentAnnounceBanner({ narrow = false }: { narrow?: boolean }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const q = trpc.chat.getPersistentAnnouncement.useQuery(undefined, { staleTime: 30_000, refetchInterval: 5 * 60_000 });
  const ann = q.data?.announcement ?? null;
  const [expanded, setExpanded] = useState(false);
  const clearMut = trpc.admin.chat.clearPersistentAnnouncement.useMutation({
    onSuccess: () => { void utils.chat.getPersistentAnnouncement.invalidate(); toast.success("持续公告已关闭"); },
    onError: (e) => toast.error("关闭失败：" + e.message),
  });
  // 到期自动消失：本地定时到点后重取（服务器惰性过期会返回 null），不依赖轮询间隔。
  useEffect(() => {
    if (!ann?.expiresAt) return;
    const ms = ann.expiresAt - Date.now();
    if (ms <= 0) { void utils.chat.getPersistentAnnouncement.invalidate(); return; }
    const t = setTimeout(() => { void utils.chat.getPersistentAnnouncement.invalidate(); }, Math.min(ms + 500, 2_147_000_000));
    return () => clearTimeout(t);
  }, [ann?.expiresAt, utils]);
  if (!ann) return null;
  const isManager = user?.role === "admin" && (user?.adminLevel ?? 0) >= 3;
  const expiryLabel = ann.expiresAt
    ? (() => { const h = (ann.expiresAt - Date.now()) / 3600_000; return h >= 1 ? `${Math.ceil(h)} 小时后结束` : `${Math.max(1, Math.ceil(h * 60))} 分钟后结束`; })()
    : null;
  return (
    <div
      className="chat-announce-blink"
      onClick={() => setExpanded((v) => !v)}
      role="status"
      title={expanded ? "收起" : "展开全文"}
      style={{
        display: "flex", alignItems: expanded ? "flex-start" : "center", gap: 8,
        padding: narrow ? "8px 10px" : "9px 14px", flexShrink: 0, cursor: "pointer",
        background: "rgba(245,158,11,0.14)",
        borderBottom: "1px solid rgba(245,158,11,0.45)",
        color: C.t1, fontSize: 13, lineHeight: 1.5,
      }}
    >
      <span aria-hidden style={{ flexShrink: 0, fontSize: 15, lineHeight: "20px" }}>📢</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{ marginRight: 8 }}>{ann.title}</b>
        <span style={expanded
          ? { color: C.t2, whiteSpace: "pre-wrap", wordBreak: "break-word" }
          : { color: C.t2, display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
          {ann.body}
        </span>
        {expanded && (
          <div style={{ marginTop: 4, fontSize: 11, color: C.t4 }}>
            {ann.createdBy ? `发布：${ann.createdBy} · ` : ""}{expiryLabel ?? "持续显示，直至管理员关闭"}
          </div>
        )}
      </div>
      {!expanded && expiryLabel && !narrow && <span style={{ flexShrink: 0, fontSize: 11, color: C.t4 }}>{expiryLabel}</span>}
      {isManager && (
        <button
          onClick={(e) => { e.stopPropagation(); if (!clearMut.isPending && confirm("关闭这条持续公告？将立即对全体用户消失。")) clearMut.mutate(); }}
          title="关闭持续公告（管理员）"
          aria-label="关闭持续公告"
          style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: `1px solid ${C.borderStrong}`, background: C.elevated, color: C.t2, cursor: "pointer" }}
        ><X size={13} /></button>
      )}
    </div>
  );
}

/** Inline approve control inside a "下载审批" channel message（限管理员 L3+，与后端一致）。 */
function DownloadApproveInline({ grantId }: { grantId: number }) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [hours, setHours] = useState(1);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const decideMut = trpc.admin.downloads.decide.useMutation();
  if (user?.role !== "admin" || (user?.adminLevel ?? 0) < 3) return null;
  if (done) return <div style={{ marginTop: 8, fontSize: 12, color: done === "approved" ? "oklch(0.7 0.16 155)" : "oklch(0.7 0.16 25)" }}>{done === "approved" ? `已授权（${hours}h）` : "已拒绝"}</div>;
  const after = (r: "approved" | "denied") => { setDone(r); void utils.admin.downloads.pendingCount.invalidate(); void utils.admin.downloads.list.invalidate(); };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
      <select value={hours} onChange={(e) => setHours(Number(e.target.value))} title="授权有效期"
        style={{ fontSize: 11.5, padding: "3px 6px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surfaceFlat, color: C.t1, cursor: "pointer" }}>
        {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{h} 小时</option>)}
      </select>
      <button disabled={decideMut.isPending}
        onClick={() => decideMut.mutate({ grantId, approve: true, expiresHours: hours }, { onSuccess: () => { toast.success(`已授权（${hours}h）`); after("approved"); }, onError: (e) => toast.error("授权失败：" + e.message) })}
        style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 7, border: "none", background: "oklch(0.6 0.16 155)", color: "#fff", cursor: "pointer" }}>授权（{hours}h）</button>
      <button disabled={decideMut.isPending}
        onClick={() => decideMut.mutate({ grantId, approve: false }, { onSuccess: () => { toast.success("已拒绝"); after("denied"); }, onError: (e) => toast.error(e.message) })}
        style={{ fontSize: 12, padding: "4px 10px", borderRadius: 7, border: `1px solid ${C.border}`, background: "transparent", color: "oklch(0.74 0.18 25)", cursor: "pointer" }}>拒绝</button>
      <button onClick={() => goToAdminTab(navigate, "downloads")} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 7, border: `1px solid ${C.border}`, background: "transparent", color: C.t3, cursor: "pointer" }}>查看</button>
    </div>
  );
}

function Attachment({ a, mine }: { a: ChatFileRef; mine: boolean }) {
  // 下载门控：图片禁长按/右键/拖拽另存（点击走应用内放大预览，预览里下载受门控）；
  // 视频/音频去掉原生控件的「下载」项、禁右键，与画布媒体保护一致。
  if (a.kind === "image") return (
    <img
      src={a.url} alt={a.name} draggable={false}
      onClick={() => openLightbox(a.url)}
      onContextMenu={(e) => e.preventDefault()}
      style={{ maxWidth: 240, maxHeight: 240, borderRadius: 10, marginTop: 6, display: "block", cursor: "zoom-in", WebkitTouchCallout: "none", userSelect: "none" }}
    />
  );
  if (a.kind === "video") return (
    <video
      src={a.url} controls controlsList="nodownload noremoteplayback" disablePictureInPicture
      onContextMenu={(e) => e.preventDefault()}
      style={{ maxWidth: 280, borderRadius: 10, marginTop: 6, display: "block" }}
    />
  );
  if (a.mimeType.startsWith("audio/")) return (
    <audio src={a.url} controls controlsList="nodownload" onContextMenu={(e) => e.preventDefault()} style={{ marginTop: 6, width: 240 }} />
  );
  return (
    <a href={a.url} download={a.name} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, color: C.accent2, textDecoration: "underline", fontSize: 13 }}>
      <Paperclip size={13} /> {a.name} ({Math.round(a.size / 1024)} KB)
    </a>
  );
}

const pill: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "4px 8px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 };
// 移动端：动作按钮压成纯图标方块（隐藏文字，省横向空间、保证触控尺寸）。
const pillIcon: React.CSSProperties = { width: 32, height: 32, padding: 0, justifyContent: "center", borderRadius: 9 };
const iconBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 11, border: `1px solid ${C.border}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1, cursor: "pointer", flexShrink: 0 };
