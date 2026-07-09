import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { playMessageSound, showCompletionNotification, ensureNotificationPermission } from "@/lib/notify";
import { CHAT_MUTED_KEY } from "@/hooks/useChat";

function muted(): boolean {
  try { return localStorage.getItem(CHAT_MUTED_KEY) === "1"; } catch { return false; }
}

type IncomingLike = { conversationId: number; senderId: number; senderName?: string | null; content?: string; attachments?: unknown[]; fileMeta?: unknown; kind?: string; last?: boolean };

/**
 * 画布端「常驻」聊天通知监听器：在**聊天窗关着**时也能收到新消息的声音 / 桌面 / 应用内横幅提醒，
 * 并把未读数报给上层（顶栏聊天按钮显红点）。此前通知逻辑只在 ChatProvider(随聊天窗挂载) 里，
 * 聊天窗一关就完全收不到提醒——本组件填补该缺口。
 *
 * 设计要点：
 * - 只在聊天窗关闭时挂载（聊天窗打开时由 ChatProvider 负责，避免双重通知/双 socket）。
 * - 用 `chat:subscribe-all` **静默**订阅用户全部会话房间（不设 presence，不污染在线状态）。
 * - 监听 server 模式的 `chat:message:new`（有明文预览）与端到端的 `chat:relay`/`chat:file-chunk`
 *   （无密钥→显示「[加密消息]/[媒体]」通用预览）。
 */
export function CanvasChatNotifier({ onNewMessage }: { onNewMessage: () => void }) {
  const { user } = useAuth();
  const onNewRef = useRef(onNewMessage);
  onNewRef.current = onNewMessage;

  useEffect(() => {
    if (!user) return;
    if (!muted()) void ensureNotificationPermission();

    const socket: Socket = io("/chat", { path: "/api/socket", transports: ["websocket", "polling"], withCredentials: true });
    socket.on("connect", () => socket.emit("chat:subscribe-all"));

    const notify = (m: IncomingLike, previewOverride?: string) => {
      if (muted()) return;
      if (m.senderId === user.id || m.senderId === -1) return; // 自己发的/本地回显不提醒
      const focused = typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
      const who = m.senderName || "新消息";
      const preview = previewOverride
        ?? (m.attachments && m.attachments.length ? "[媒体]" : (m.content?.replace(/^\[#DLREQ:\d+\]\n?/, "📥 ").slice(0, 60) || "[新消息]"));
      onNewRef.current(); // 累加未读（顶栏红点）
      playMessageSound();
      if (focused) {
        toast(`💬 ${who}`, { description: preview, duration: 4000 });
      } else {
        showCompletionNotification({ title: `💬 ${who}`, body: preview, tag: `chat-${m.conversationId}` });
      }
    };

    socket.on("chat:message:new", (m: IncomingLike) => notify(m));
    // 端到端消息经 chat:relay 转发，画布通知器无会话密钥，用通用预览。密钥请求/分发（key-request/
    // key-bundle）是控制帧、非真消息——任一成员上线都会触发一轮密钥中继，若也弹通知会让其他成员莫名
    // 收到「[加密消息]」提示音洪泛。只对普通 message 弹（与 useChat.handleRelay 的 kind 分支一致）。
    socket.on("chat:relay", (m: IncomingLike) => {
      if (m.kind === "key-request" || m.kind === "key-bundle") return;
      notify(m, "[加密消息]");
    });
    // 文件分片：一个文件被切成很多帧（每 256KB 一帧），只在最后一帧（last）弹一次，否则一个 10MB
    // 文件会弹 ~40 次通知+声音。与 useChat.handleFileChunk 只在 frame.last 通知一致。
    socket.on("chat:file-chunk", (m: IncomingLike) => { if (m.last) notify(m, "[媒体]"); });
    // 管理员广播：定向到个人房（恒加入），保证一定收到。senderId=-2 系统，绕过自己过滤。
    socket.on("system:announce", (p: { roomId: number; title: string; body: string }) => {
      notify({ conversationId: p.roomId, senderId: -2, senderName: `📢 系统公告` }, (p.title || "系统公告").slice(0, 60));
    });

    return () => { socket.disconnect(); };
  }, [user]);

  return null;
}
