import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Paperclip, Plus, X, FileText, Users, Loader2 } from "lucide-react";
import { useLanChat } from "@/hooks/useLanChat";
import { useLanChatNotifications } from "@/hooks/useLanChatNotifications";
import type { ChatAttachment, LanChatMessage } from "../../../../shared/types";

interface LanChatPanelProps {
  /** Whether the panel is currently visible to the user (drives notifications). */
  visible: boolean;
  /** Render width-tight (no left sidebar) for the canvas widget. Defaults
   *  to two-column layout used by /lan-chat. */
  compact?: boolean;
}

/**
 * The shared chat surface. Used by both LanChatWidget (canvas float) and
 * LanChatPage (standalone). All state lives in useLanChat — this component
 * is mostly presentation + drop-zone wiring.
 */
export function LanChatPanel({ visible, compact = false }: LanChatPanelProps) {
  const chat = useLanChat();
  const {
    session, rooms, activeRoomId, setActiveRoomId, createRoom,
    messages, online, typing, connected,
    send, sendTyping, uploadMedia,
  } = chat;

  const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const { unread, clearUnread } = useLanChatNotifications({
    latestMessage,
    ownNickname: session?.nickname ?? null,
    isOpen: visible,
  });
  // Clear unread when the user actually focuses the input (proves they're reading).
  void unread; // exposed for the bubble; not used directly here

  const [input, setInput] = useState("");
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [draggingOver, setDraggingOver] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [showOnline, setShowOnline] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (isNearBottom) {
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }, [messages]);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg && pending.length === 0) return;
    const attachments = pending;
    setInput("");
    setPending([]);
    try {
      await send(msg, attachments.length > 0 ? attachments : undefined);
    } catch { /* toast via mutation onError if added — silent ok */ }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else {
      sendTyping();
    }
  };

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    if (!session) return;
    if (pending.length + files.length > 8) return;
    setUploading(true);
    try {
      const arr = Array.from(files);
      for (const f of arr) {
        if (f.size > 16 * 1024 * 1024) continue;
        const result = await uploadMedia(f);
        if (!result) continue;
        setPending((prev) => [...prev, result]);
      }
    } finally {
      setUploading(false);
    }
  }, [session, pending.length, uploadMedia]);

  // Drop handler — mirrors AIChatNode's tri-priority: Files → structured
  // application/x-avc-attachment from filmstrip → bare URL fallback.
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await handleFiles(files);
      return;
    }
    const structured = e.dataTransfer.getData("application/x-avc-attachment");
    if (structured) {
      try {
        const parsed = JSON.parse(structured) as ChatAttachment;
        if (pending.length >= 8) return;
        setPending((prev) => [...prev, parsed]);
        return;
      } catch { /* fall through */ }
    }
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (!url || !/^(https?:|data:|\/)/i.test(url)) return;
    const isImg = /\.(jpe?g|png|gif|webp|bmp|svg|avif)(\?|#|$)/i.test(url) || url.startsWith("data:image/");
    if (!isImg) return;
    if (pending.length >= 8) return;
    const name = url.startsWith("data:") ? "image" : (url.split("/").pop()?.split("?")[0] || "image");
    setPending((prev) => [...prev, { type: "image", url, mimeType: "image/*", name }]);
  }, [handleFiles, pending.length]);

  return (
    <div
      className="flex h-full"
      onDragOver={(e) => {
        const t = e.dataTransfer.types;
        if (t && (t.includes("Files") || t.includes("application/x-avc-attachment") || t.includes("text/uri-list"))) {
          e.preventDefault();
          e.stopPropagation();
          setDraggingOver(true);
        }
      }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDraggingOver(false); }}
      onDrop={handleDrop}
      onClick={clearUnread}
    >
      {/* Sidebar — rooms list (hidden in compact mode) */}
      {!compact && (
        <div
          className="flex flex-col flex-shrink-0"
          style={{
            width: 180,
            borderRight: "1px solid var(--c-bd1)",
            background: "color-mix(in oklch, var(--c-base) 96%, transparent)",
          }}
        >
          <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid var(--c-bd1)" }}>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-t4)" }}>
              房间
            </span>
            <span className="ml-auto text-[10px]" style={{ color: connected ? "oklch(0.72 0.18 155)" : "var(--c-t4)" }}>
              {connected ? "● 在线" : "○ 离线"}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-1 py-1.5 space-y-0.5">
            {rooms.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveRoomId(r.id)}
                className="w-full px-2 py-1.5 rounded text-left text-xs"
                style={{
                  background: r.id === activeRoomId ? "oklch(0.68 0.22 285 / 0.15)" : "transparent",
                  color: r.id === activeRoomId ? "oklch(0.82 0.20 285)" : "var(--c-t2)",
                  fontWeight: r.id === activeRoomId ? 600 : 400,
                }}
              >
                # {r.name}
              </button>
            ))}
          </div>
          <div className="px-2 py-2 flex items-center gap-1" style={{ borderTop: "1px solid var(--c-bd1)" }}>
            <input
              value={newRoomName}
              maxLength={80}
              onChange={(e) => setNewRoomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newRoomName.trim()) {
                  createRoom(newRoomName.trim()).then((room) => {
                    if (room) { setActiveRoomId(room.id); setNewRoomName(""); }
                  });
                }
              }}
              placeholder="+ 新房间"
              className="flex-1 px-2 py-1 rounded text-[11px]"
              style={{ background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }}
            />
            <button
              onClick={() => {
                if (!newRoomName.trim()) return;
                createRoom(newRoomName.trim()).then((room) => {
                  if (room) { setActiveRoomId(room.id); setNewRoomName(""); }
                });
              }}
              disabled={!newRoomName.trim()}
              className="w-6 h-6 rounded flex items-center justify-center"
              style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)" }}
            >
              <Plus style={{ width: 11, height: 11 }} />
            </button>
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Active room header. Compact mode (canvas widget) shows a room
            dropdown + create-room control inline since the sidebar is hidden. */}
        <div
          className="flex items-center px-3 py-2 gap-2"
          style={{ borderBottom: "1px solid var(--c-bd1)", flexShrink: 0 }}
        >
          {compact ? (
            <CompactRoomPicker
              rooms={rooms}
              activeRoomId={activeRoomId}
              onSelect={setActiveRoomId}
              onCreate={async (name) => {
                const room = await createRoom(name);
                if (room) setActiveRoomId(room.id);
              }}
            />
          ) : (
            <span className="text-xs font-semibold" style={{ color: "var(--c-t1)" }}>
              # {rooms.find((r) => r.id === activeRoomId)?.name ?? "大厅"}
            </span>
          )}
          <button
            onClick={() => setShowOnline((v) => !v)}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px]"
            style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t3)" }}
            title="在线成员"
          >
            <Users style={{ width: 10, height: 10 }} />
            {online.length}
          </button>
        </div>

        {/* Online popover */}
        {showOnline && (
          <div
            className="absolute right-3 top-10 z-20 rounded-lg p-2 min-w-[160px]"
            style={{
              background: "var(--c-base)",
              border: "1px solid var(--c-bd2)",
              boxShadow: "0 8px 32px oklch(0 0 0 / 0.45)",
            }}
            onMouseLeave={() => setShowOnline(false)}
          >
            <p className="text-[10px] uppercase tracking-wider mb-1 px-1" style={{ color: "var(--c-t4)" }}>
              在线 {online.length}
            </p>
            <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
              {online.map((u) => (
                <div key={u.sessionId} className="flex items-center gap-2 px-1 py-1 rounded text-xs">
                  <span className="w-2 h-2 rounded-full" style={{ background: u.color }} />
                  <span style={{ color: "var(--c-t2)" }}>{u.nickname}</span>
                </div>
              ))}
              {online.length === 0 && (
                <p className="text-[10px] px-1 py-2 text-center" style={{ color: "var(--c-t4)" }}>暂无其他在线用户</p>
              )}
            </div>
          </div>
        )}

        {/* Message scroll */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2.5">
          {messages.length === 0 && (
            <p className="text-center text-xs mt-8" style={{ color: "var(--c-t4)" }}>
              还没有消息。发出第一条来打破沉默吧。
            </p>
          )}
          {messages.map((msg) => (
            <MessageRow key={msg.id} msg={msg} isOwn={msg.nickname === session?.nickname} />
          ))}
          {typing.length > 0 && (
            <p className="text-[10px] italic" style={{ color: "var(--c-t4)" }}>
              {typing.join("、")} 正在输入…
            </p>
          )}
        </div>

        {/* Drag overlay */}
        {draggingOver && (
          <div
            className="absolute inset-0 flex items-center justify-center text-xs pointer-events-none z-10"
            style={{
              background: "oklch(0.68 0.22 285 / 0.10)",
              border: "2px dashed oklch(0.68 0.22 285 / 0.45)",
              color: "oklch(0.78 0.20 285)",
            }}
          >
            松开以添加附件
          </div>
        )}

        {/* Pending attachments */}
        {pending.length > 0 && (
          <div className="px-3 py-1.5 flex flex-wrap gap-1.5" style={{ borderTop: "1px solid var(--c-bd1)" }}>
            {pending.map((att, i) => (
              <PendingChip
                key={i}
                att={att}
                onRemove={() => setPending((prev) => prev.filter((_, idx) => idx !== i))}
              />
            ))}
          </div>
        )}

        {/* Input bar */}
        <div className="flex items-end gap-2 px-3 py-2" style={{ borderTop: "1px solid var(--c-bd1)", flexShrink: 0 }}>
          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept="image/*,video/*"
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) {
                handleFiles(e.target.files);
                e.target.value = "";
              }
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "transparent", border: "1px solid var(--c-bd2)", color: "var(--c-t3)" }}
            title="上传图片/视频（最大 16 MB）"
          >
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={pending.length > 0 ? "添加说明（可选）" : "输入消息… (Enter 发送 / Shift+Enter 换行)"}
            rows={1}
            className="flex-1"
            style={{
              fontSize: 12,
              padding: "7px 10px",
              background: "var(--c-input)",
              border: "1px solid var(--c-bd2)",
              borderRadius: 8,
              color: "var(--c-t1)",
              outline: "none",
              resize: "none",
              maxHeight: 100,
              minHeight: 32,
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleSend}
            disabled={(!input.trim() && pending.length === 0) || uploading}
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: (!input.trim() && pending.length === 0) || uploading
                ? "var(--c-surface)" : "oklch(0.68 0.22 285)",
              border: "1px solid var(--c-bd2)",
              color: (!input.trim() && pending.length === 0) || uploading ? "var(--c-t4)" : "white",
              cursor: (!input.trim() && pending.length === 0) || uploading ? "not-allowed" : "pointer",
            }}
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageRow({ msg, isOwn }: { msg: LanChatMessage; isOwn: boolean }) {
  return (
    <div className="flex flex-col gap-0.5" style={{ alignItems: isOwn ? "flex-end" : "flex-start" }}>
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold" style={{ color: msg.color }}>{msg.nickname}</span>
        <span className="text-[9px]" style={{ color: "var(--c-t4)" }}>{formatTime(msg.createdAt)}</span>
      </div>
      <div
        className="rounded-lg px-2.5 py-1.5 text-xs leading-relaxed"
        style={{
          background: isOwn ? "oklch(0.68 0.22 285 / 0.18)" : "var(--c-surface)",
          border: `1px solid ${isOwn ? "oklch(0.68 0.22 285 / 0.30)" : "var(--c-bd2)"}`,
          color: "var(--c-t1)",
          maxWidth: 380,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {msg.content}
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {msg.attachments.map((att, i) => (
              <AttachmentTile key={i} att={att} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentTile({ att }: { att: ChatAttachment }) {
  if (att.type === "image") {
    return (
      <a href={att.url} target="_blank" rel="noopener" className="block rounded overflow-hidden" style={{ maxWidth: 200 }}>
        <img src={att.url} alt={att.name} style={{ maxWidth: "100%", maxHeight: 200, display: "block" }} />
      </a>
    );
  }
  return (
    <div
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px]"
      style={{ background: "var(--c-base)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}
    >
      <FileText style={{ width: 10, height: 10 }} />
      <span>{att.name}</span>
    </div>
  );
}

function PendingChip({ att, onRemove }: { att: ChatAttachment; onRemove: () => void }) {
  if (att.type === "image") {
    return (
      <div className="relative rounded overflow-hidden" style={{ width: 48, height: 48, border: "1px solid var(--c-bd2)" }}>
        <img src={att.url} alt={att.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <button
          onClick={onRemove}
          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
          style={{ background: "oklch(0 0 0 / 0.65)", color: "white" }}
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
      <span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name}</span>
      <button onClick={onRemove} className="w-4 h-4 rounded flex items-center justify-center" style={{ color: "var(--c-t4)" }}>
        <X style={{ width: 9, height: 9 }} />
      </button>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Inline room dropdown + create-room popover for the canvas widget where
// there's no left sidebar. Renders the current room as a button; clicking
// opens a small menu with all rooms + a + 新房间 input.
function CompactRoomPicker({
  rooms,
  activeRoomId,
  onSelect,
  onCreate,
}: {
  rooms: Array<{ id: number; name: string }>;
  activeRoomId: number;
  onSelect: (id: number) => void;
  onCreate: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const current = rooms.find((r) => r.id === activeRoomId);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold"
        style={{ color: "var(--c-t1)", background: open ? "var(--c-elevated)" : "transparent" }}
      >
        # {current?.name ?? "大厅"}
        <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div
          className="absolute left-0 top-7 z-30 rounded-lg p-1 min-w-[180px]"
          style={{
            background: "var(--c-base)",
            border: "1px solid var(--c-bd2)",
            boxShadow: "0 8px 32px oklch(0 0 0 / 0.45)",
          }}
          onMouseLeave={() => setOpen(false)}
        >
          <div className="max-h-[180px] overflow-y-auto">
            {rooms.map((r) => (
              <button
                key={r.id}
                onClick={() => { onSelect(r.id); setOpen(false); }}
                className="w-full text-left px-2 py-1 rounded text-xs"
                style={{
                  background: r.id === activeRoomId ? "oklch(0.68 0.22 285 / 0.15)" : "transparent",
                  color: r.id === activeRoomId ? "oklch(0.82 0.20 285)" : "var(--c-t2)",
                }}
              >
                # {r.name}
              </button>
            ))}
            {rooms.length === 0 && (
              <p className="text-[10px] px-2 py-2 text-center" style={{ color: "var(--c-t4)" }}>
                无房间
              </p>
            )}
          </div>
          <div
            className="flex items-center gap-1 mt-1 px-1 pt-1"
            style={{ borderTop: "1px solid var(--c-bd1)" }}
          >
            <input
              value={newName}
              maxLength={80}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  onCreate(newName.trim());
                  setNewName("");
                  setOpen(false);
                }
              }}
              placeholder="+ 新房间"
              className="flex-1 px-2 py-1 rounded text-[11px]"
              style={{ background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }}
            />
            <button
              onClick={() => {
                if (!newName.trim()) return;
                onCreate(newName.trim());
                setNewName("");
                setOpen(false);
              }}
              disabled={!newName.trim()}
              className="px-2 py-1 rounded text-[10px]"
              style={{
                background: newName.trim() ? "oklch(0.68 0.22 285 / 0.20)" : "transparent",
                color: newName.trim() ? "oklch(0.82 0.20 285)" : "var(--c-t4)",
                border: "1px solid var(--c-bd2)",
                cursor: newName.trim() ? "pointer" : "not-allowed",
              }}
            >
              建
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
