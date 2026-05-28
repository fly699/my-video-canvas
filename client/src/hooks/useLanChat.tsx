import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

interface LanChatContextValue {
  session: SessionInfo | null;
  join: (nickname: string) => Promise<SessionInfo>;
  clearSession: () => void;
  rooms: LanChatRoom[];
  activeRoomId: number;
  setActiveRoomId: (id: number) => void;
  createRoom: (name: string) => Promise<LanChatRoom | undefined>;
  messages: LanChatMessage[];
  online: LanChatOnlineUser[];
  typing: string[];
  connected: boolean;
  send: (content: string, attachments?: ChatAttachment[]) => Promise<void>;
  sendTyping: () => void;
  uploadMedia: (file: File) => Promise<{ url: string; type: "image" | "file"; mimeType: string; name: string } | null>;
  lanForbidden: boolean;
}

const LanChatContext = createContext<LanChatContextValue | null>(null);

/**
 * Singleton-ish chat state: the canvas widget and the standalone /lan-chat
 * page both render under `<LanChatProvider>` (mounted at the App root) so
 * they share one socket, one session, and one message list. Without this
 * shared layer, mounting two `useLanChat()` consumers on the same page
 * would open two sockets and race the React state updates.
 */
export function LanChatProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = usePersistentState<SessionInfo | null>(
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

  // Establish socket when session changes. Guard against stale handlers
  // from a prior effect run (strict-mode double-invoke) writing state
  // after a newer socket has taken over.
  useEffect(() => {
    if (!session) return;
    const socket = io("/lan-chat", {
      path: "/api/socket",
      transports: ["websocket", "polling"],
      auth: { sessionId: session.sessionId },
    });
    socketRef.current = socket;
    const isLive = () => socketRef.current === socket;

    socket.on("connect", () => { if (isLive()) setConnected(true); });
    socket.on("disconnect", () => { if (isLive()) setConnected(false); });
    socket.on("connect_error", (err) => {
      if (!isLive()) return;
      if (/session-not-found/i.test(err.message)) setSessionState(null);
      setConnected(false);
    });
    socket.on("lan-chat:message", (msg: LanChatMessage) => {
      if (!isLive()) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    });
    socket.on("lan-chat:presence", ({ roomId, online: list }: { roomId: number; online: LanChatOnlineUser[] }) => {
      if (!isLive()) return;
      if (roomId === activeRoomIdRef.current) setOnline(list);
    });
    socket.on("lan-chat:typing", ({ nickname, roomId }: { nickname: string; roomId: number }) => {
      if (!isLive()) return;
      if (roomId !== activeRoomIdRef.current) return;
      setTyping((prev) => (prev.includes(nickname) ? prev : [...prev, nickname]));
      window.setTimeout(() => {
        setTyping((prev) => prev.filter((n) => n !== nickname));
      }, 3000);
    });

    return () => {
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
        setConnected(false);
      }
    };
  }, [session, setSessionState]);

  const activeRoomIdRef = useRef(activeRoomId);
  useEffect(() => { activeRoomIdRef.current = activeRoomId; }, [activeRoomId]);

  // Room switching — leave previous room, enter new, load history.
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
    setMessages([]);
    utils.lanChat.getMessages.fetch({ roomId: activeRoomId, limit: 50 })
      .then((rows) => setMessages([...rows].reverse()))
      .catch(() => { /* swallow */ });
    // Wait for socket to be connected before emitting (in strict-mode the
    // first render may run this before the socket effect's socket connects
    // — we re-run the emit when `connected` flips true below).
  }, [activeRoomId, session, utils]);

  // After the socket connects (or reconnects), re-emit enter-room so the
  // server's presence map gets us back in.
  useEffect(() => {
    if (connected && socketRef.current) {
      socketRef.current.emit("lan-chat:enter-room", { roomId: activeRoomIdRef.current });
    }
  }, [connected]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const join = useCallback(async (nickname: string) => {
    const res = await joinMu.mutateAsync({ nickname });
    setSessionState(res);
    return res;
  }, [joinMu, setSessionState]);

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

  const clearSession = useCallback(() => setSessionState(null), [setSessionState]);

  const value: LanChatContextValue = {
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

  return <LanChatContext.Provider value={value}>{children}</LanChatContext.Provider>;
}

export function useLanChat(): LanChatContextValue {
  const ctx = useContext(LanChatContext);
  if (!ctx) {
    throw new Error("useLanChat must be used within <LanChatProvider>");
  }
  return ctx;
}
