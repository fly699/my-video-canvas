import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Lock, Paperclip, Send, ShieldCheck, Users, Trash2, LogOut, X, FileIcon, ImageIcon, Film, FolderOpen, Download, Camera, Crop } from "lucide-react";
import { captureScreen, captureRegion, RegionSelectOverlay, ScreenshotEditor } from "./ScreenshotEditor";
import { ComfyServerStatusIndicator } from "../canvas/ComfyServerStatusIndicator";
import { useChat, SERVERLESS_ENCRYPT_PROMPT_BYTES } from "@/hooks/useChat";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { goToAdminTab } from "@/lib/adminNav";
import type { ChatWireMessage, ChatFileRef } from "@shared/types";
import { toast } from "sonner";
import { C, avatarGrad, initials } from "./chatTheme";
import { MessageContent } from "./MessageContent";
import { openLightbox } from "./chatLightbox";

export function ChatView({ membersOpen: _m }: { membersOpen?: boolean }) {
  const { activeConv, messages, presence, typingUsers, sendText, sendFile, emitTyping, connected, loadingMessages, maxFileMb, serverlessAllowed, e2eAvailable, myUserId, deleteRoom, leaveRoom } = useChat();
  const [text, setText] = useState("");
  const [staged, setStaged] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [askEncrypt, setAskEncrypt] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  // Screenshots → annotate → stage as an attachment. Two entry points:
  //  • 截图: whole screen/window/tab via getDisplayMedia (can grab other windows).
  //  • 框选: drag a box over THIS page → capture just that region (no OS picker).
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  async function fullScreenshot() {
    if (capturing) return;
    setCapturing(true);
    try {
      const url = await captureScreen();
      if (url) setShotUrl(url);
      else toast.info("已取消，或当前浏览器/环境不支持屏幕截图（需 HTTPS）");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "截图失败");
    } finally { setCapturing(false); }
  }
  async function onRegionSelected(rect: { x: number; y: number; w: number; h: number }) {
    setSelecting(false);
    // Let the selection overlay unmount (and repaint) before snapshotting the DOM.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    setCapturing(true);
    try {
      const url = await captureRegion(rect);
      if (url) setShotUrl(url);
    } catch (e) {
      toast.error("框选截图失败：" + (e instanceof Error ? e.message : String(e)));
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

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: C.bg }}>
        <img src="/chat-icon.svg" width={72} height={72} alt="" style={{ opacity: 0.5, borderRadius: 18 }} />
        <div style={{ color: C.t3, fontSize: 14 }}>选择一个会话开始聊天</div>
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
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 11 }}>
          <span style={{ width: 38, height: 38, borderRadius: 11, background: avatarGrad(activeConv.type === "dm" ? `u${activeConv.peer?.id}` : `c${activeConv.id}`), color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>{initials(title)}</span>
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ComfyServerStatusIndicator />
          <button onClick={() => setShowFiles(true)} title="文件" style={{ ...pill, border: `1px solid ${C.borderStrong}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1 }}><FolderOpen size={14} /> 文件</button>
          {activeConv.type === "group" && (isOwner
            ? <button onClick={onDelete} title="删除群聊（群主）" style={{ ...pill, border: `1px solid rgba(239,68,68,0.3)`, background: C.dangerSoft, color: C.danger }}><Trash2 size={14} /> 删除</button>
            : <button onClick={onLeave} title="退出群聊" style={{ ...pill, border: `1px solid ${C.borderStrong}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1 }}><LogOut size={14} /> 退出</button>
          )}
          {activeConv.type === "dm" && (
            <button onClick={onDeleteDm} title="删除该私聊" style={{ ...pill, border: `1px solid rgba(239,68,68,0.3)`, background: C.dangerSoft, color: C.danger }}><Trash2 size={14} /> 删除</button>
          )}
          {activeConv.type !== "lobby" && (
            <button onClick={toggleMode} title="切换工作模式" style={{ ...pill, border: `1px solid ${activeConv.mode === "serverless" ? C.accent : C.borderStrong}`, background: activeConv.mode === "serverless" ? C.accentSoft : "var(--c-elevated, rgba(128,128,128,0.10))", color: activeConv.mode === "serverless" ? C.accent : C.t1 }}>
              {activeConv.mode === "serverless" ? <><ShieldCheck size={14} /> 端到端加密</> : <>服务器模式</>}
            </button>
          )}
        </div>
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
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {loadingMessages && <div style={{ alignSelf: "center", color: C.t3, fontSize: 13 }}>加载中…</div>}
        {!loadingMessages && messages.length === 0 && <div style={{ alignSelf: "center", color: C.t4, fontSize: 13 }}>还没有消息，发送第一条吧</div>}
        {messages.map((m) => <Bubble key={`${m.id}-${m.createdAt}`} msg={m} mine={m.senderId === -1 || m.senderId === myUserId} />)}
        {typingUsers.length > 0 && <div style={{ fontSize: 12, color: C.t3 }}>{typingUsers.join("、")} 正在输入…</div>}
      </div>

      {/* limit hint */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 16px 0", fontSize: 11, color: C.t3, flexWrap: "wrap" }}>
        <span>单文件 ≤ <strong style={{ color: C.t2 }}>{maxFileMb}MB</strong></span>
        {!serverlessAllowed && <><span>·</span><span>管理员已禁用端到端模式</span></>}
      </div>

      {/* staging area */}
      {staged.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "8px 16px 0" }}>
          {staged.map((f, i) => <StagedChip key={i} file={f} onRemove={() => setStaged((p) => p.filter((_, j) => j !== i))} />)}
        </div>
      )}

      {/* input */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "8px 16px 14px", flexShrink: 0 }}>
        <input ref={fileRef} type="file" hidden multiple onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <button onClick={() => fileRef.current?.click()} title={`添加文件（单文件 ≤ ${maxFileMb}MB）`} style={iconBtn}><Paperclip size={18} /></button>
        <button onClick={fullScreenshot} disabled={capturing} title="截图（整屏/窗口，可截浏览器外内容；截屏后可标注再发送）" style={{ ...iconBtn, opacity: capturing ? 0.5 : 1 }}><Camera size={18} /></button>
        <button onClick={() => setSelecting(true)} disabled={capturing} title="框选截图（点击后直接在页面上拖框，框完即截）" style={{ ...iconBtn, opacity: capturing ? 0.5 : 1 }}><Crop size={18} /></button>
        <textarea value={text} onChange={(e) => { setText(e.target.value); emitTyping(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void doSend(); } }}
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
          placeholder="Enter 发送，Shift+Enter 换行，可拖拽或粘贴文件到此" rows={1}
          style={{ flex: 1, resize: "none", maxHeight: 140, padding: "10px 14px", borderRadius: 12, border: `1px solid ${C.border}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1, fontSize: 14, outline: "none", fontFamily: "inherit" }} />
        <button onClick={() => doSend()} disabled={busy || (!text.trim() && staged.length === 0)} title="发送"
          style={{ ...iconBtn, width: 40, height: 40, background: C.accentSoft, color: C.accent, border: `1px solid ${C.accent}`, opacity: busy || (!text.trim() && staged.length === 0) ? 0.5 : 1 }}>
          <Send size={18} />
        </button>
      </div>

      {/* Screenshot annotate editor (portal) */}
      {selecting && <RegionSelectOverlay onCancel={() => setSelecting(false)} onSelect={onRegionSelected} />}
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

function Bubble({ msg, mine }: { msg: ChatWireMessage; mine: boolean }) {
  // Download-request messages carry a leading [#DLREQ:<grantId>] marker → strip
  // it from display and render an inline approve control (admins only).
  const dl = msg.content.match(/^\[#DLREQ:(\d+)\]\n?/);
  const displayContent = dl ? msg.content.slice(dl[0].length) : msg.content;
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "flex-start", flexDirection: mine ? "row-reverse" : "row" }}>
      <span style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, background: avatarGrad(`u${msg.senderId}`), color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{initials(msg.senderName || "我")}</span>
      <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 3, maxWidth: "72%" }}>
        {!mine && <span style={{ fontSize: 11, color: C.t3, paddingLeft: 2 }}>{msg.senderName}</span>}
        <div style={{ padding: "9px 13px", borderRadius: 14, fontSize: 14, lineHeight: 1.55, wordBreak: "break-word",
          background: mine ? C.accentSoft : C.surfaceFlat, color: C.t1,
          border: `1px solid ${mine ? "rgba(245,158,11,0.30)" : C.border}`, borderTopRightRadius: mine ? 4 : 14, borderTopLeftRadius: mine ? 14 : 4 }}>
          <MessageContent content={displayContent} />
          {msg.attachments?.map((a, i) => <Attachment key={i} a={a} mine={mine} />)}
          {dl && <DownloadApproveInline grantId={Number(dl[1])} />}
        </div>
        <span style={{ fontSize: 10, color: C.t4, padding: "0 2px" }}>{new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>
  );
}

/** Inline approve control inside a "下载审批" channel message (admins only). */
function DownloadApproveInline({ grantId }: { grantId: number }) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [hours, setHours] = useState(1);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const decideMut = trpc.admin.downloads.decide.useMutation();
  if (user?.role !== "admin") return null;
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
  if (a.kind === "image") return <img src={a.url} alt={a.name} onClick={() => openLightbox(a.url)} style={{ maxWidth: 240, maxHeight: 240, borderRadius: 10, marginTop: 6, display: "block", cursor: "zoom-in" }} />;
  if (a.kind === "video") return <video src={a.url} controls style={{ maxWidth: 280, borderRadius: 10, marginTop: 6, display: "block" }} />;
  if (a.mimeType.startsWith("audio/")) return <audio src={a.url} controls style={{ marginTop: 6, width: 240 }} />;
  return (
    <a href={a.url} download={a.name} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, color: C.accent2, textDecoration: "underline", fontSize: 13 }}>
      <Paperclip size={13} /> {a.name} ({Math.round(a.size / 1024)} KB)
    </a>
  );
}

const pill: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 10, cursor: "pointer" };
const iconBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 11, border: `1px solid ${C.border}`, background: "var(--c-elevated, rgba(128,128,128,0.10))", color: C.t1, cursor: "pointer", flexShrink: 0 };
