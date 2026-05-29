import { useEffect, useRef, useState } from "react";
import { Lock, Paperclip, Send, ShieldCheck, Users } from "lucide-react";
import { useChat, SERVERLESS_ENCRYPT_PROMPT_BYTES } from "@/hooks/useChat";
import { trpc } from "@/lib/trpc";
import type { ChatWireMessage, ChatFileRef } from "@shared/types";
import { toast } from "sonner";

export function ChatView() {
  const { activeConv, messages, presence, typingUsers, sendText, sendFile, emitTyping, connected, loadingMessages, maxFileMb, serverlessAllowed } = useChat();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const setModeMut = trpc.chat.setMode.useMutation();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  if (!activeConv) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-t3, rgba(255,255,255,0.4))" }}>
        选择一个会话开始聊天
      </div>
    );
  }

  const title = activeConv.type === "dm" ? (activeConv.peer?.name ?? "私聊") : activeConv.type === "lobby" ? "大厅" : (activeConv.title ?? "群聊");

  async function onSend() {
    if (!text.trim() || sending) return;
    setSending(true);
    try { await sendText(text); setText(""); }
    catch (e) { toast.error(e instanceof Error ? e.message : "发送失败"); }
    finally { setSending(false); }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    // Serverless + large file → let the user choose encrypted vs fast plaintext.
    if (activeConv?.mode === "serverless" && f.size > SERVERLESS_ENCRYPT_PROMPT_BYTES) {
      setPendingFile(f);
      return;
    }
    try { await sendFile(f); } catch (err) { toast.error(err instanceof Error ? err.message : "文件发送失败"); }
  }

  async function doSendPending(encrypt: boolean) {
    const f = pendingFile;
    setPendingFile(null);
    if (!f) return;
    try { await sendFile(f, { encrypt }); } catch (err) { toast.error(err instanceof Error ? err.message : "文件发送失败"); }
  }

  async function toggleMode() {
    if (activeConv!.type === "lobby") { toast.error("大厅模式不可更改"); return; }
    const next = activeConv!.mode === "server" ? "serverless" : "server";
    if (next === "serverless" && !serverlessAllowed) { toast.error("管理员已禁用端到端加密模式"); return; }
    try {
      await setModeMut.mutateAsync({ conversationId: activeConv!.id, mode: next });
      utils.chat.listConversations.invalidate();
      toast.success(next === "serverless" ? "已切换为端到端加密（无服务器）" : "已切换为服务器模式");
    } catch (e) { toast.error(e instanceof Error ? e.message : "切换失败"); }
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--c-canvas, #0d0d10)" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--c-bd2, rgba(255,255,255,0.08))", flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
            {title}
            {activeConv.isPrivate && <Lock size={13} style={{ color: "var(--c-t3)" }} />}
          </div>
          <div style={{ fontSize: 12, color: "var(--c-t3, rgba(255,255,255,0.4))", display: "flex", alignItems: "center", gap: 6 }}>
            <Users size={12} /> {presence.length} 在线 · {connected ? "已连接" : "连接中…"}
          </div>
        </div>
        {activeConv.type !== "lobby" && (
          <button onClick={toggleMode} title="切换工作模式" style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
            padding: "6px 12px", borderRadius: 8, cursor: "pointer",
            border: "1px solid var(--c-bd2, rgba(255,255,255,0.12))",
            background: activeConv.mode === "serverless" ? "oklch(0.58 0.22 285 / 0.2)" : "var(--c-elevated, rgba(255,255,255,0.05))",
            color: "var(--c-t1, #f0f0f4)",
          }}>
            {activeConv.mode === "serverless" ? <><ShieldCheck size={14} /> 端到端加密</> : <>服务器模式</>}
          </button>
        )}
      </div>

      {/* messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        {activeConv.mode === "serverless" && (
          <div style={{ alignSelf: "center", fontSize: 12, color: "var(--c-t3, rgba(255,255,255,0.4))", background: "var(--c-surface, #14141a)", padding: "6px 12px", borderRadius: 8, border: "1px solid var(--c-bd2, rgba(255,255,255,0.08))" }}>
            🔒 端到端加密会话 · 消息不在服务器留存，历史仅保存在本机
          </div>
        )}
        {loadingMessages && <div style={{ alignSelf: "center", color: "var(--c-t3)", fontSize: 13 }}>加载中…</div>}
        {!loadingMessages && messages.length === 0 && <div style={{ alignSelf: "center", color: "var(--c-t4, rgba(255,255,255,0.25))", fontSize: 13 }}>还没有消息，发送第一条吧</div>}
        {messages.map((m) => <MessageBubble key={`${m.id}-${m.createdAt}`} msg={m} />)}
        {typingUsers.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--c-t3, rgba(255,255,255,0.4))" }}>{typingUsers.join("、")} 正在输入…</div>
        )}
      </div>

      {/* limit / warning hint (synced with admin settings) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 16px 0", fontSize: 11, color: "var(--c-t3, rgba(255,255,255,0.4))", flexShrink: 0, flexWrap: "wrap" }}>
        <span>单文件 ≤ <strong>{maxFileMb}MB</strong></span>
        <span>·</span>
        <span>{activeConv.mode === "serverless" ? "🔒 端到端加密，内容不留存、仅本机历史" : "服务器模式，消息与文件留存、管理员可审计"}</span>
        {activeConv.mode === "serverless" && <><span>·</span><span>大文件可选不加密提速</span></>}
        {!serverlessAllowed && <><span>·</span><span>管理员已禁用端到端模式</span></>}
      </div>

      {/* input */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "8px 16px 12px", borderTop: "none", flexShrink: 0 }}>
        <input ref={fileRef} type="file" hidden onChange={onPickFile} />
        <button onClick={() => fileRef.current?.click()} title={`发送文件（单文件 ≤ ${maxFileMb}MB${activeConv.mode === "serverless" ? `；>100MB 可选不加密提速` : ""}）`} style={iconBtn}><Paperclip size={18} /></button>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); emitTyping(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void onSend(); } }}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          rows={1}
          style={{
            flex: 1, resize: "none", maxHeight: 120, padding: "9px 12px", borderRadius: 10,
            border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))", background: "var(--c-input, rgba(255,255,255,0.04))",
            color: "var(--c-t1, #f0f0f4)", fontSize: 14, outline: "none", fontFamily: "inherit",
          }}
        />
        <button onClick={onSend} disabled={sending || !text.trim()} title="发送" style={{ ...iconBtn, background: "oklch(0.58 0.22 285 / 0.9)", color: "#fff", opacity: sending || !text.trim() ? 0.5 : 1 }}>
          <Send size={18} />
        </button>
      </div>

      {pendingFile && (
        <div onClick={() => setPendingFile(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: "90vw", background: "var(--c-surface, #1a1a22)", border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))", borderRadius: 14, padding: 22, color: "var(--c-t1, #f0f0f4)" }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>大文件传输方式</div>
            <div style={{ fontSize: 13, color: "var(--c-t2, rgba(255,255,255,0.55))", lineHeight: 1.6, marginBottom: 18 }}>
              「{pendingFile.name}」约 {Math.round(pendingFile.size / 1024 / 1024)}MB（管理员单文件上限 {maxFileMb}MB）。端到端加密会逐块加密、速度较慢；你也可以选择<strong>不加密直传</strong>以显著提速（文件内容会以明文经服务器中转，但仍不落库）。
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => doSendPending(true)} style={{ padding: "11px 0", border: "1px solid var(--c-bd2, rgba(255,255,255,0.12))", borderRadius: 9, background: "var(--c-elevated, rgba(255,255,255,0.05))", color: "var(--c-t1, #f0f0f4)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                🔒 加密发送（安全，较慢）
              </button>
              <button onClick={() => doSendPending(false)} style={{ padding: "11px 0", border: "none", borderRadius: 9, background: "oklch(0.58 0.22 285 / 0.9)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                ⚡ 不加密快速发送
              </button>
              <button onClick={() => setPendingFile(null)} style={{ padding: "8px 0", border: "none", background: "transparent", color: "var(--c-t3, rgba(255,255,255,0.45))", fontSize: 13, cursor: "pointer" }}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatWireMessage }) {
  const mine = msg.senderId === -1; // optimistic local echo for serverless
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 2 }}>
      {!mine && <span style={{ fontSize: 11, color: "var(--c-t3, rgba(255,255,255,0.4))", paddingLeft: 4 }}>{msg.senderName}</span>}
      <div style={{
        maxWidth: "72%", padding: "8px 12px", borderRadius: 12, fontSize: 14, lineHeight: 1.5, wordBreak: "break-word",
        background: mine ? "oklch(0.58 0.22 285 / 0.85)" : "var(--c-surface, #14141a)",
        color: mine ? "#fff" : "var(--c-t1, #f0f0f4)",
        border: mine ? "none" : "1px solid var(--c-bd2, rgba(255,255,255,0.08))",
      }}>
        {msg.content && <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>}
        {msg.attachments?.map((a, i) => <Attachment key={i} a={a} />)}
      </div>
      <span style={{ fontSize: 10, color: "var(--c-t4, rgba(255,255,255,0.3))", padding: "0 4px" }}>
        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}

function Attachment({ a }: { a: ChatFileRef }) {
  if (a.kind === "image") {
    return <img src={a.url} alt={a.name} style={{ maxWidth: 240, maxHeight: 240, borderRadius: 8, marginTop: 4, display: "block" }} />;
  }
  if (a.kind === "video") {
    return <video src={a.url} controls style={{ maxWidth: 280, borderRadius: 8, marginTop: 4, display: "block" }} />;
  }
  return (
    <a href={a.url} download={a.name} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 4, color: "inherit", textDecoration: "underline", fontSize: 13 }}>
      <Paperclip size={13} /> {a.name} ({Math.round(a.size / 1024)} KB)
    </a>
  );
}

const iconBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38,
  borderRadius: 10, border: "1px solid var(--c-bd2, rgba(255,255,255,0.1))",
  background: "var(--c-elevated, rgba(255,255,255,0.04))", color: "var(--c-t1, #f0f0f4)", cursor: "pointer", flexShrink: 0,
};
