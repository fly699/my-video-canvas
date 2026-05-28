import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { trpc } from "@/lib/trpc";
import { usePersistentState } from "./usePersistentState";
import type { LanChatMessage, LanChatOnlineUser, LanChatRoom, ChatAttachment } from "../../../shared/types";

const SESSION_KEY = "lan-chat:session:v1";
const ACTIVE_ROOM_KEY = "lan-chat:active-room:v1";

interface SessionInfo {
  sessionId: string;
  nickname: string;
  color: string;
}

/**
 * Centralized state + IO for LAN chat. Both the canvas widget and the
 * standalone /lan-chat page consume this hook so they stay in lockstep on
 * the same socket connection.
 */
export function useLanChat() {
  const [session, setSession] = usePersistentState<SessionInfo | null>(
    SESSION_KEY,
    null,
    {
      validate: (v) => {
        if (!v || typeof v !== "object") return null;
        const o = v as Partial<SessionInfo>;
        if (typeof o.sessionId !== "string" || typeof o.nickname !== "string" || typeof o.color !== "string") return null;
        return { sessionId: o.sessionId, nickname: o.nickname, color: o.color };
      },
    },
  );
  const [activeRoomId, setActiveRoomId] = usePersistentState<number>(ACTIVE_ROOM_KEY, 1, {
    validate: (v) => (typeof v === "number" && Number.isFinite(v) ? v : null),
  });

  const [messages, setMessages] = useState<LanChatMessage[]>([]);
  const [online, setOnline] = useState<LanChatOnlineUser[]>([]);
  const [connected, setConnected] = useState(false);
  const [typing, setTyping] = useState<string[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const utils = trpc.useUtils();

  const joinMu = trpc.lanChat.joinSession.useMutation();
  const sendMu = trpc.lanChat.sendMessage.useMutation();
  const createRoomMu = trpc.lanChat.createRoom.useMutation({
    onSuccess: () => utils.lanChat.listRooms.invalidate(),
  });
  const uploadMu = trpc.lanChat.uploadMedia.useMutation();

  const roomsQ = trpc.lanChat.listRooms.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });
  const lanForbidden = useMemo(
    () => !!(roomsQ.error && /lan|403|forbidden/i.test(roomsQ.error.message)),
    [roomsQ.error],
  );

  // Establish + tear down socket when session changes.
  useEffect(() => {
    if (!session) return;
    const socket = io("/lan-chat", {
      path: "/api/socket",
      transports: ["websocket", "polling"],
      auth: { sessionId: session.sessionId },
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (err) => {
      // Likely stale sessionId after a server restart — drop it so the
      // user picks a nickname again on next interaction.
      if (/session-not-found/i.test(err.message)) setSession(null);
      setConnected(false);
    });

    socket.on("lan-chat:message", (msg: LanChatMessage) => {
      setMessages((prev) => {
        // De-dupe in case the same message comes through via REST + WS race.
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });
    socket.on("lan-chat:presence", ({ roomId, online: list }: { roomId: number; online: LanChatOnlineUser[] }) => {
      // Only apply presence updates for the room we're currently viewing.
      // The server emits to all rooms the user is in, so filter client-side.
      setOnline((prev) => (roomId === activeRoomIdRef.current ? list : prev));
    });
    socket.on("lan-chat:typing", ({ nickname, roomId }: { nickname: string; roomId: number }) => {
      if (roomId !== activeRoomIdRef.current) return;
      setTyping((prev) => (prev.includes(nickname) ? prev : [...prev, nickname]));
      window.setTimeout(() => {
        setTyping((prev) => prev.filter((n) => n !== nickname));
      }, 3000);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [session, setSession]);

  // Keep a ref of the active room so socket handlers always see the latest
  // value without re-binding listeners on every room switch.
  const activeRoomIdRef = useRef(activeRoomId);
  useEffect(() => { activeRoomIdRef.current = activeRoomId; }, [activeRoomId]);

  // On room change: leave previous room, enter new room, load history.
  const prevRoomRef = useRef<number | null>(null);
  useEffect(() => {
    if (!session || !socketRef.current) return;
    const socket = socketRef.current;
    const prev = prevRoomRef.current;
    if (prev != null && prev !== activeRoomId) {
      socket.emit("lan-chat:leave-room", { roomId: prev });
    }
    socket.emit("lan-chat:enter-room", { roomId: activeRoomId });
    prevRoomRef.current = activeRoomId;

    // Load recent history
    setMessages([]);
    utils.lanChat.getMessages.fetch({ roomId: activeRoomId, limit: 50 })
      .then((rows) => {
        // Server returns newest-first; chronological for display.
        setMessages([...rows].reverse());
      })
      .catch(() => { /* swallow — UI shows empty state */ });
  }, [activeRoomId, session, utils]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const join = useCallback(async (nickname: string) => {
    const res = await joinMu.mutateAsync({ nickname });
    setSession(res);
    return res;
  }, [joinMu, setSession]);

  const send = useCallback(async (content: string, attachments?: ChatAttachment[]) => {
    if (!session) return;
    await sendMu.mutateAsync({
      sessionId: session.sessionId,
      roomId: activeRoomId,
      content,
      attachments,
    });
  }, [session, activeRoomId, sendMu]);

  const sendTyping = useCallback(() => {
    socketRef.current?.emit("lan-chat:typing", { roomId: activeRoomId });
  }, [activeRoomId]);

  const createRoom = useCallback(async (name: string): Promise<LanChatRoom | undefined> => {
    if (!session) return undefined;
    const room = await createRoomMu.mutateAsync({ sessionId: session.sessionId, name });
    return room;
  }, [session, createRoomMu]);

  const uploadMedia = useCallback(async (file: File): Promise<{ url: string; type: "image" | "file"; mimeType: string; name: string } | null> => {
    if (!session) return null;
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const res = await uploadMu.mutateAsync({
      sessionId: session.sessionId,
      base64,
      mimeType: file.type,
      filename: file.name,
    });
    return {
      url: res.url,
      type: file.type.startsWith("image/") ? "image" : "file",
      mimeType: file.type,
      name: file.name,
    };
  }, [session, uploadMu]);

  const clearSession = useCallback(() => setSession(null), [setSession]);

  return {
    session,
    join,
    clearSession,
    rooms: roomsQ.data ?? [],
    activeRoomId,
    setActiveRoomId,
    createRoom,
    messages,
    online,
    typing,
    connected,
    send,
    sendTyping,
    uploadMedia,
    lanForbidden,
  };
}
