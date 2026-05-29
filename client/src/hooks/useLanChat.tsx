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
const DEVICE_ID_KEY = "lan-chat:device-id:v1";
/** Max file size for both sending and receiving — 256 MB.
 *  P2P DataChannel is limited by browser memory, not network; 256 MB fits
 *  comfortably in a desktop browser tab and covers most LAN use-cases
 *  (video clips, design assets, archives). */
const MAX_FILE_BYTES = 256 * 1024 * 1024;

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

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

/** A staged attachment carries the original File so the actual P2P
 *  broadcast can be deferred until the user hits send (selecting a file
 *  must NOT transmit it). The File is stripped before the chat message is
 *  broadcast — peers receive the bytes via the separate file-chunk frames. */
export type PendingAttachment = ChatAttachment & { file?: File };

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
  createRoom: (name: string, password?: string) => Promise<LanChatRoom | undefined>;
  deleteRoom: (roomId: number) => Promise<void>;
  /** Enter a (possibly private) room — for private rooms the password
   *  is required. Returns true on success, false if server denied. */
  enterRoom: (roomId: number, password?: string) => Promise<boolean>;
  messages: LanChatMessage[];
  online: LanChatOnlineUser[];
  /** WebRTC peer connection state — UI can display "N/M peers ready"
   *  so the user knows whose messages they will (and won't) see. */
  peers: MeshPeer[];
  typing: string[];
  connected: boolean;
  send: (content: string, attachments?: PendingAttachment[]) => Promise<void>;
  sendTyping: () => void;
  uploadMedia: (file: File) => Promise<PendingAttachment | null>;
  /** Force-reconnect the signaling socket + rebuild the peer mesh. Bound to
   *  a manual "refresh" button so a user who looks disconnected can recover
   *  without reloading the whole page. */
  reconnect: () => void;
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
  // Bump to force a full socket teardown + rebuild (manual reconnect button).
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const reconnect = useCallback(() => setReconnectNonce((n) => n + 1), []);
  // Debounce the "disconnected" UI: socket.io auto-reconnects on transient
  // network blips, so a brief drop shouldn't flash "离线" — only flip the
  // badge if we're still down after a short grace period.
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const socketRef = useRef<Socket | null>(null);
  // socketState mirrors socketRef but is proper React state so usePeerMesh
  // receives the real socket object after the connection effect runs.
  // socketRef alone won't work: React doesn't re-render on ref mutation, so
  // usePeerMesh would always see null and never establish DataChannels.
  const [socketState, setSocketState] = useState<Socket | null>(null);
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
        // Legacy rows (pre-room-isolation) have no roomId — fall back to the
        // currently active room so they remain visible somewhere.
        roomId: typeof r.roomId === "number" ? r.roomId : activeRoomIdRef.current,
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
        ownByMe: r.ownByMe,
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
        const next = { id: room.id, name: room.name, isPrivate: room.isPrivate };
        utils.lanChat.listRooms.setData(
          { sessionId: session.sessionId },
          (prev) => prev ? [...prev, next] : [next],
        );
      }
      utils.lanChat.listRooms.invalidate();
    },
  });
  const deleteRoomMu = trpc.lanChat.deleteRoom.useMutation({
    onSuccess: (_, vars) => {
      if (session) {
        utils.lanChat.listRooms.setData(
          { sessionId: session.sessionId },
          (prev) => prev?.filter((r) => r.id !== vars.roomId),
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
    setSocketState(socket);
    const isLive = () => socketRef.current === socket;

    socket.on("connect", () => {
      if (!isLive()) return;
      if (offlineTimerRef.current) { clearTimeout(offlineTimerRef.current); offlineTimerRef.current = null; }
      setConnected(true);
    });
    socket.on("disconnect", () => {
      if (!isLive()) return;
      // Grace period: socket.io is already retrying. Only show 离线 if the
      // drop persists — avoids the badge flickering on every transient blip.
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      offlineTimerRef.current = setTimeout(() => { if (isLive()) setConnected(false); }, 2500);
    });
    socket.on("connect_error", (err) => {
      if (!isLive()) return;
      if (/session-not-found/i.test(err.message)) setSessionState(null);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      offlineTimerRef.current = setTimeout(() => { if (isLive()) setConnected(false); }, 2500);
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
    // Someone in our group created a room — refresh the list so it appears
    // in everyone's sidebar without a page reload.
    socket.on("lan-chat:room-created", () => {
      if (!isLive()) return;
      utils.lanChat.listRooms.invalidate();
    });
    // Someone deleted a room — remove it from the cache immediately so
    // users don't see a stale entry while the refetch is in flight.
    socket.on("lan-chat:room-deleted", ({ id }: { id: number }) => {
      if (!isLive()) return;
      utils.lanChat.listRooms.setData(
        session ? { sessionId: session.sessionId } : undefined,
        (prev) => prev?.filter((r) => r.id !== id),
      );
      utils.lanChat.listRooms.invalidate();
    });

    return () => {
      if (offlineTimerRef.current) { clearTimeout(offlineTimerRef.current); offlineTimerRef.current = null; }
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
        setSocketState(null);
        setConnected(false);
      }
    };
  }, [session, setSessionState, reconnectNonce]);

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
    // In P2P mode messages come via DataChannel and are kept in IndexedDB;
    // the server never stores new messages. Don't clear or replace the
    // message list here — doing so would wipe messages that arrived via
    // DataChannel between the setMessages([]) call and the (empty) server
    // response. IndexedDB history is loaded once on session+fingerprint
    // ready (the effect above), which is the correct source of truth.
    // Wait for socket to be connected before emitting (in strict-mode the
    // first render may run this before the socket effect's socket connects
    // — we re-run the emit when `connected` flips true below).
  }, [activeRoomId, session]);

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
    const res = await joinMu.mutateAsync({ nickname, groupId: fingerprint.groupId, deviceId: getOrCreateDeviceId() });
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


  // In-flight inbound file transfers from peers. Keyed by transferId; each
  // entry collects chunks until a "file-end" marker arrives, then assembles
  // a Blob → objectURL → fires a synthetic chat message with the attachment.
  const fileTransfersRef = useRef<Map<string, {
    name: string;
    mimeType: string;
    size: number;
    roomId: number;
    chunks: Uint8Array[];
    received: number;
    fromNickname: string;
    fromColor: string;
    fromSessionId: string;
  }>>(new Map());

  // Drop all in-flight transfers that originated from a peer that just
  // disconnected — prevents unbounded memory growth from partial transfers.
  const handlePeerDrop = useCallback((sessionId: string) => {
    fileTransfersRef.current.forEach((entry, transferId) => {
      if (entry.fromSessionId === sessionId) {
        fileTransfersRef.current.delete(transferId);
      }
    });
  }, []);

  const handlePeerMessage = useCallback((msg: { fromSessionId: string; fromNickname: string; fromColor: string; payload: unknown }) => {
    const p = msg.payload as { kind?: string; [k: string]: unknown };
    if (!p?.kind) return;

    // Text chat message
    if (p.kind === "chat" && typeof p.content === "string") {
      const id = (typeof p.id === "string" ? p.id : null) ?? crypto.randomUUID();
      const content = p.content as string;
      const createdAt = typeof p.createdAt === "number" ? p.createdAt : Date.now();
      const attachments = Array.isArray(p.attachments) ? (p.attachments as ChatAttachment[]) : undefined;
      // Peers are group-wide, so a message can arrive for any room. Tag it
      // with the sender's roomId; the UI only shows messages for the room
      // the user is currently viewing.
      const roomId = typeof p.roomId === "number" ? p.roomId : activeRoomIdRef.current;
      historyAppend({
        id,
        groupId: fingerprint.state === "ready" ? fingerprint.groupId : "unknown",
        roomId,
        nickname: msg.fromNickname,
        color: msg.fromColor,
        content,
        attachments,
        createdAt,
        ownByMe: false,
      });
      setMessages((prev) => [...prev, {
        id: hashId(id),
        roomId,
        nickname: msg.fromNickname,
        color: msg.fromColor,
        content,
        attachments: attachments ?? null,
        createdAt: new Date(createdAt).toISOString(),
        ownByMe: false,
      }]);
      return;
    }

    // File transfer protocol — three frames per file:
    //   text frame  { kind:"file-meta", transferId, name, mimeType, size }
    //   binary frames  [36-byte UUID][4-byte seq BE][raw data]  × N
    //     (dispatched as { kind:"file-chunk", transferId, seq, data:Uint8Array }
    //      by usePeerMesh.ts onmessage binary branch)
    //   text frame  { kind:"file-end", transferId }
    if (p.kind === "file-meta" && typeof p.transferId === "string") {
      const declaredSize = Number(p.size ?? 0);
      // Reject files larger than our receive limit — prevents a malicious
      // peer from exhausting memory by advertising a huge file.
      if (declaredSize > MAX_FILE_BYTES) return;
      fileTransfersRef.current.set(p.transferId, {
        name: String(p.name ?? "file"),
        mimeType: String(p.mimeType ?? "application/octet-stream"),
        size: declaredSize,
        roomId: typeof p.roomId === "number" ? p.roomId : activeRoomIdRef.current,
        chunks: [],
        received: 0,
        fromNickname: msg.fromNickname,
        fromColor: msg.fromColor,
        fromSessionId: msg.fromSessionId,
      });
      return;
    }
    // Chunks arrive as Uint8Array (binary DataChannel frame, decoded by
    // usePeerMesh.ts). Legacy base64-string path is intentionally removed.
    if (p.kind === "file-chunk" && typeof p.transferId === "string" && p.data instanceof Uint8Array) {
      const entry = fileTransfersRef.current.get(p.transferId);
      if (!entry) return;
      // Abort if this chunk would push us past the declared size (malformed sender).
      if (entry.received + p.data.length > entry.size + 1) {
        fileTransfersRef.current.delete(p.transferId);
        return;
      }
      entry.chunks.push(p.data);
      entry.received += p.data.length;
      return;
    }
    if (p.kind === "file-end" && typeof p.transferId === "string") {
      const entry = fileTransfersRef.current.get(p.transferId);
      if (!entry) return;
      fileTransfersRef.current.delete(p.transferId);
      // Only assemble if we received a plausible amount of data (>50% of
      // declared size) — avoids creating a corrupt blob from a partial transfer.
      if (entry.received < entry.size * 0.5 && entry.size > 0) return;
      const blob = new Blob(entry.chunks as BlobPart[], { type: entry.mimeType });
      const url = URL.createObjectURL(blob);
      const isImage = entry.mimeType.startsWith("image/");
      const attachment: ChatAttachment = {
        type: isImage ? "image" : "file",
        url,
        mimeType: entry.mimeType,
        name: entry.name,
      };
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      historyAppend({
        id,
        groupId: fingerprint.state === "ready" ? fingerprint.groupId : "unknown",
        roomId: entry.roomId,
        nickname: entry.fromNickname,
        color: entry.fromColor,
        content: "",
        attachments: [attachment],
        createdAt,
        ownByMe: false,
      });
      setMessages((prev) => [...prev, {
        id: hashId(id),
        roomId: entry.roomId,
        nickname: entry.fromNickname,
        color: entry.fromColor,
        content: "",
        attachments: [attachment],
        createdAt: new Date(createdAt).toISOString(),
        ownByMe: false,
      }]);
    }
  }, [fingerprint]);

  const mesh = usePeerMesh({
    socket: socketState,
    mySessionId: session?.sessionId ?? null,
    myNickname: session?.nickname ?? "",
    desiredPeers,
    onMessage: handlePeerMessage,
    onPeerDrop: handlePeerDrop,
  });

  const send = useCallback(async (content: string, attachments?: PendingAttachment[]) => {
    if (!session || fingerprint.state !== "ready") return;
    const groupId = fingerprint.groupId;
    const roomId = activeRoomIdRef.current;

    // File attachments (have a backing File) travel as their own message
    // via the separate file-meta/chunk/end frames — the blob: URL is only
    // valid in the sender's tab, so peers reconstruct from the frames. We
    // mirror that locally so sender and receiver render identically.
    const fileAtts = (attachments ?? []).filter((a) => a.file);
    // URL attachments (dragged in from the canvas, no backing File) carry a
    // shareable http(s)/data URL the receiver can load directly, so they
    // ride along inside the chat message instead.
    const urlAtts = (attachments ?? []).filter((a) => !a.file);

    for (const att of fileAtts) {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const localAtt: ChatAttachment = { type: att.type, url: att.url, name: att.name, mimeType: att.mimeType };
      historyAppend({
        id, groupId, roomId, nickname: session.nickname, color: session.color,
        content: "", attachments: [localAtt], createdAt, ownByMe: true,
      });
      setMessages((prev) => [...prev, {
        id: hashId(id), roomId, nickname: session.nickname, color: session.color,
        content: "", attachments: [localAtt], createdAt: new Date(createdAt).toISOString(), ownByMe: true,
      }]);
      // Now actually transmit the file — only on send, never on select.
      const transferId = crypto.randomUUID();
      mesh.broadcastChunked(
        transferId,
        { kind: "file-meta", name: att.file!.name, mimeType: att.file!.type, size: att.file!.size, roomId },
        att.file!,
      ).catch((err) => console.warn("[lan-chat] file broadcast failed:", err));
    }

    // Text message + any URL attachments (only if there's something to send).
    const text = content.trim();
    if (text || urlAtts.length > 0) {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const cleanUrlAtts: ChatAttachment[] = urlAtts.map((a) => ({ type: a.type, url: a.url, name: a.name, mimeType: a.mimeType }));
      historyAppend({
        id, groupId, roomId, nickname: session.nickname, color: session.color,
        content: text, attachments: cleanUrlAtts.length ? cleanUrlAtts : undefined, createdAt, ownByMe: true,
      });
      setMessages((prev) => [...prev, {
        id: hashId(id), roomId, nickname: session.nickname, color: session.color,
        content: text, attachments: cleanUrlAtts.length ? cleanUrlAtts : null, createdAt: new Date(createdAt).toISOString(), ownByMe: true,
      }]);
      mesh.broadcast({ kind: "chat", id, content: text, roomId, attachments: cleanUrlAtts.length ? cleanUrlAtts : undefined, createdAt });
    }
  }, [session, fingerprint, mesh]);

  const sendTyping = useCallback(() => {
    socketRef.current?.emit("lan-chat:typing", { roomId: activeRoomId });
  }, [activeRoomId]);

  const createRoom = useCallback(async (name: string, password?: string): Promise<LanChatRoom | undefined> => {
    if (!session) return undefined;
    const room = await createRoomMu.mutateAsync({
      sessionId: session.sessionId,
      name,
      password: password || undefined,
    });
    return room;
  }, [session, createRoomMu]);

  const deleteRoom = useCallback(async (roomId: number) => {
    if (!session) return;
    await deleteRoomMu.mutateAsync({ sessionId: session.sessionId, roomId });
  }, [session, deleteRoomMu]);

  // Wire up enter-room ack/deny socket events so callers know whether
  // the password they supplied was accepted. Resolves true on
  // lan-chat:enter-granted, false on lan-chat:enter-denied, timeouts
  // after 4 s (fail closed — caller should re-prompt).
  const enterRoom = useCallback((roomId: number, password?: string): Promise<boolean> => {
    if (!socketRef.current) return Promise.resolve(false);
    const socket = socketRef.current;
    return new Promise<boolean>((resolve) => {
      let done = false;
      const onGranted = (d: { roomId: number }) => { if (d.roomId === roomId && !done) { done = true; cleanup(); resolve(true); } };
      const onDenied = (d: { roomId: number }) => { if (d.roomId === roomId && !done) { done = true; cleanup(); resolve(false); } };
      const cleanup = () => {
        socket.off("lan-chat:enter-granted", onGranted);
        socket.off("lan-chat:enter-denied", onDenied);
      };
      socket.on("lan-chat:enter-granted", onGranted);
      socket.on("lan-chat:enter-denied", onDenied);
      socket.emit("lan-chat:enter-room", { roomId, password });
      window.setTimeout(() => { if (!done) { done = true; cleanup(); resolve(false); } }, 4000);
    });
  }, []);

  /** Stage a file for sending. This ONLY builds a local preview and keeps
   *  the original File — it does NOT transmit anything. The actual P2P
   *  broadcast happens in send(), so selecting a file never sends it on
   *  its own; the user must hit send/Enter. The `url` is a same-origin
   *  blob: URL valid only in the sender's tab (for the local preview);
   *  receivers build their own blob URL when the file frames arrive. */
  const uploadMedia = useCallback(async (file: File): Promise<PendingAttachment | null> => {
    if (!session) return null;
    if (file.size > MAX_FILE_BYTES) {
      throw new Error("文件超过 256 MB，P2P 传输已拒绝");
    }
    const localUrl = URL.createObjectURL(file);
    void uploadMu; // server upload path retired
    return {
      url: localUrl,
      type: file.type.startsWith("image/") ? "image" : "file",
      mimeType: file.type,
      name: file.name,
      file,
    };
  }, [session, uploadMu]);

  const clearSession = useCallback(() => setSessionState(null), [setSessionState]);

  // Messages are isolated per room: peers are group-wide so `messages` holds
  // every room's traffic, but the UI only shows the active room's.
  const visibleMessages = useMemo(
    () => messages.filter((m) => m.roomId === activeRoomId),
    [messages, activeRoomId],
  );

  const value: LanChatContextValue = {
    fingerprint,
    session,
    join,
    clearSession,
    rooms: roomsQ.data ?? [],
    activeRoomId,
    setActiveRoomId,
    createRoom,
    deleteRoom,
    enterRoom,
    messages: visibleMessages,
    online,
    peers: mesh.peers,
    typing,
    connected,
    send,
    sendTyping,
    uploadMedia,
    reconnect,
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
