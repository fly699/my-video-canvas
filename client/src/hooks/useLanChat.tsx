import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { trpc } from "@/lib/trpc";
import { usePersistentState } from "./usePersistentState";
import { useLanFingerprint } from "./useLanFingerprint";
import { usePeerMesh, type MeshPeer } from "./usePeerMesh";
import { appendMessage as historyAppend, loadRecentMessages } from "@/lib/localChatHistory";
import type { LanChatMessage, LanChatOnlineUser, LanChatRoom, ChatAttachment } from "../../../shared/types";

const SESSION_KEY = "lan-chat:session:v1";
const ACTIVE_ROOM_KEY = "lan-chat:active-room:v1";

/** Convert a uuid string into a numeric id for React key compat with the
 *  legacy LanChatMessage shape (id was a server-issued auto-increment).
 *  Simple djb2 hash — collisions don't matter beyond React key stability. */
function hashId(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

interface SessionInfo {
  sessionId: string;
  nickname: string;
  color: string;
}

interface LanChatContextValue {
  /** Public-IP fingerprint state — UI must check this BEFORE letting
   *  the user join. "loading" → show spinner; "error" → show diagnostic
   *  card; "ready" → unlock the nickname form. */
  fingerprint: ReturnType<typeof useLanFingerprint>;
  session: SessionInfo | null;
  join: (nickname: string) => Promise<SessionInfo>;
  clearSession: () => void;
  rooms: LanChatRoom[];
  activeRoomId: number;
  setActiveRoomId: (id: number) => void;
  createRoom: (name: string) => Promise<LanChatRoom | undefined>;
  messages: LanChatMessage[];
  online: LanChatOnlineUser[];
  /** WebRTC peer connection state — UI can display "N/M peers ready"
   *  so the user knows whose messages they will (and won't) see. */
  peers: MeshPeer[];
  typing: string[];
  connected: boolean;
  send: (content: string, attachments?: ChatAttachment[]) => Promise<void>;
  sendTyping: () => void;
  uploadMedia: (file: File) => Promise<{ url: string; type: "image" | "file"; mimeType: string; name: string } | null>;
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
  // Public-IP-based grouping (or URL hash override). Three states:
  // loading / ready (with groupId) / error. join() refuses to run until
  // state === "ready" — there is no "public" fallback by design.
  const fingerprint = useLanFingerprint();

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

  // Local message history (IndexedDB) — server-side message storage was
  // dropped when we switched to E2E P2P, so each peer keeps its own.
  useEffect(() => {
    if (!session || fingerprint.state !== "ready") return;
    let cancelled = false;
    loadRecentMessages(fingerprint.groupId).then((rows) => {
      if (cancelled) return;
      setMessages(rows.map((r) => ({
        id: hashId(r.id),
        roomId: 1, // unused in P2P phase 1
        nickname: r.nickname,
        color: r.color,
        content: r.content,
        attachments: r.attachments ? r.attachments.map((a) => ({
          type: a.type,
          url: a.url,
          mimeType: a.mimeType,
          name: a.name,
        })) : null,
        createdAt: new Date(r.createdAt).toISOString(),
      })));
    });
    return () => { cancelled = true; };
  }, [session, fingerprint]);

  const joinMu = trpc.lanChat.joinSession.useMutation();
  const sendMu = trpc.lanChat.sendMessage.useMutation();
  const createRoomMu = trpc.lanChat.createRoom.useMutation({
    onSuccess: (room) => {
      // Inject the new room into the cache synchronously so the
      // auto-correct effect (which watches roomsQ.data) sees it before
      // any refetch lands. Without this the user clicks create → we
      // setActiveRoomId(newRoom.id) → auto-correct doesn't find it →
      // snaps back to rooms[0]. Bug: "新建的房间不能进入".
      if (session) {
        utils.lanChat.listRooms.setData(
          { sessionId: session.sessionId },
          (prev) => prev ? [...prev, { id: room.id, name: room.name }] : [{ id: room.id, name: room.name }],
        );
      }
      utils.lanChat.listRooms.invalidate();
    },
  });
  const uploadMu = trpc.lanChat.uploadMedia.useMutation();

  const roomsQ = trpc.lanChat.listRooms.useQuery(
    session ? { sessionId: session.sessionId } : undefined,
    {
      retry: false,
      staleTime: 60_000,
      enabled: !!session, // wait until joinSession finishes
    },
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
    // lan-chat:message (server-broadcast text) is no longer emitted in
    // the P2P architecture — text now flows over WebRTC DataChannel.
    // Listener kept as a no-op so a future stray emit doesn't error.
    socket.on("lan-chat:message", () => { /* deprecated path — ignored */ });
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
    utils.lanChat.getMessages.fetch({ sessionId: session.sessionId, roomId: activeRoomId, limit: 50 })
      .then((rows) => setMessages([...rows].reverse()))
      .catch(() => { /* swallow */ });
    // Wait for socket to be connected before emitting (in strict-mode the
    // first render may run this before the socket effect's socket connects
    // — we re-run the emit when `connected` flips true below).
  }, [activeRoomId, session, utils]);

  // Auto-correct activeRoomId when the persisted value isn't in this
  // network's room list. Why this matters: usePersistentState seeds
  // activeRoomId=1, but after the 0017 network-group refactor a user's
  // own "大厅" gets a freshly-allocated id (likely > 1). If we don't
  // snap to a valid room, getMessages + sendMessage both server-reject
  // ("房间不存在" / "不能向其他网络的房间发消息") and the chat appears
  // to silently swallow every message the user sends.
  useEffect(() => {
    const rooms = roomsQ.data;
    if (!rooms || rooms.length === 0) return;
    // CRITICAL: skip while a refetch is in flight. Otherwise immediately
    // after createRoom, the cache still shows the OLD list (without the
    // new room), and we'd snap activeRoomId back to rooms[0] — bug:
    // "newly created room can't be entered" because the user landed in
    // the wrong room before the refetch finished.
    if (roomsQ.isFetching) return;
    if (!rooms.some((r) => r.id === activeRoomId)) {
      setActiveRoomId(rooms[0].id);
    }
  }, [roomsQ.data, roomsQ.isFetching, activeRoomId, setActiveRoomId]);

  // After the socket connects (or reconnects), re-emit enter-room so the
  // server's presence map gets us back in.
  useEffect(() => {
    if (connected && socketRef.current) {
      socketRef.current.emit("lan-chat:enter-room", { roomId: activeRoomIdRef.current });
    }
  }, [connected]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const join = useCallback(async (nickname: string) => {
    if (fingerprint.state !== "ready") {
      throw new Error("公网 IP 未就绪，无法加入聊天");
    }
    const res = await joinMu.mutateAsync({ nickname, groupId: fingerprint.groupId });
    setSessionState(res);
    return res;
  }, [joinMu, setSessionState, fingerprint]);

  // ── WebRTC mesh wiring ────────────────────────────────────────────────
  // Peer list = the same `online` list the server reports, minus self.
  // Server only knows who's connected via socket presence — it does NOT
  // see message content.
  const desiredPeers = useMemo(() => (session
    ? online.filter((u) => u.sessionId !== session.sessionId)
    : []
  ), [online, session]);

  const handlePeerMessage = useCallback((msg: { fromSessionId: string; fromNickname: string; fromColor: string; payload: unknown }) => {
    const p = msg.payload as { kind?: string; content?: string; attachments?: ChatAttachment[]; createdAt?: number; id?: string };
    if (!p || p.kind !== "chat" || typeof p.content !== "string") return;
    const id = p.id ?? crypto.randomUUID();
    const content: string = p.content;
    const createdAt = typeof p.createdAt === "number" ? p.createdAt : Date.now();
    historyAppend({
      id,
      groupId: fingerprint.state === "ready" ? fingerprint.groupId : "unknown",
      nickname: msg.fromNickname,
      color: msg.fromColor,
      content,
      attachments: p.attachments,
      createdAt,
      ownByMe: false,
    });
    setMessages((prev) => [...prev, {
      id: hashId(id),
      roomId: 1,
      nickname: msg.fromNickname,
      color: msg.fromColor,
      content,
      attachments: p.attachments ?? null,
      createdAt: new Date(createdAt).toISOString(),
    }]);
  }, [fingerprint]);

  const mesh = usePeerMesh({
    socket: socketRef.current,
    mySessionId: session?.sessionId ?? null,
    myNickname: session?.nickname ?? "",
    desiredPeers,
    onMessage: handlePeerMessage,
  });

  const send = useCallback(async (content: string, attachments?: ChatAttachment[]) => {
    if (!session || fingerprint.state !== "ready") return;
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    // 1. Persist locally (each peer keeps own history)
    historyAppend({
      id,
      groupId: fingerprint.groupId,
      nickname: session.nickname,
      color: session.color,
      content,
      attachments: attachments?.map((a) => ({ type: a.type, url: a.url, name: a.name, mimeType: a.mimeType })),
      createdAt,
      ownByMe: true,
    });
    // 2. Render in own UI immediately
    setMessages((prev) => [...prev, {
      id: hashId(id),
      roomId: 1,
      nickname: session.nickname,
      color: session.color,
      content,
      attachments: attachments ?? null,
      createdAt: new Date(createdAt).toISOString(),
    }]);
    // 3. Broadcast to connected peers via DataChannel — server never sees it.
    mesh.broadcast({ kind: "chat", id, content, attachments, createdAt });
    // sendMu intentionally NOT called — the server-side path is deprecated
    // by the E2E architecture.
    void sendMu;
  }, [session, fingerprint, mesh, sendMu]);

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
    fingerprint,
    session,
    join,
    clearSession,
    rooms: roomsQ.data ?? [],
    activeRoomId,
    setActiveRoomId,
    createRoom,
    messages,
    online,
    peers: mesh.peers,
    typing,
    connected,
    send,
    sendTyping,
    uploadMedia,
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
