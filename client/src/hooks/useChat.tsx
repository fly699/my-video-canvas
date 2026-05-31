import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { trpc } from "@/lib/trpc";
import type {
  ChatWireMessage, ChatPresenceUser, ChatRelayPayload, ChatFileRef,
} from "@shared/types";
import {
  generateIdentityKeyPair, importPrivateKeyJwk, exportPrivateKeyJwk,
  deriveSharedKey, generateRoomKey, encryptText, decryptText,
  wrapRoomKeyForMember, unwrapRoomKey, type Encrypted,
} from "@/lib/chatCrypto";
import { loadPrivateKeyJwk, savePrivateKeyJwk, loadLocalHistory, appendLocalHistory } from "@/lib/chatKeyStore";
import { Lightbox } from "@/components/chat/chatLightbox";

export interface ConversationSummary {
  id: number; type: string; mode: string; title: string | null;
  isPrivate: boolean; memberCount: number; lastMessage: ChatWireMessage | null;
  unread: number; peer?: { id: number; name: string | null };
}

export interface JoinableRoom { id: number; title: string | null; isPrivate: boolean; mode: string }

interface ChatContextValue {
  conversations: ConversationSummary[];
  refetchConversations: () => void;
  joinableRooms: JoinableRoom[];
  myUserId: number | null;
  activeId: number | null;
  activeConv: ConversationSummary | null;
  selectConversation: (id: number) => void;
  joinRoom: (id: number, password?: string) => Promise<void>;
  deleteRoom: (id: number) => Promise<void>;
  leaveRoom: (id: number) => Promise<void>;
  openDm: (userId: number) => Promise<void>;
  createGroupWith: (title: string, userIds: number[]) => Promise<void>;
  messages: ChatWireMessage[];
  presence: ChatPresenceUser[];
  typingUsers: string[];
  connected: boolean;
  sendText: (text: string) => Promise<void>;
  sendFile: (file: File, opts?: { encrypt?: boolean }) => Promise<void>;
  emitTyping: () => void;
  loadingMessages: boolean;
  /** Admin-configured single-file size limit (MB). */
  maxFileMb: number;
  /** Whether the admin allows serverless (E2E) mode. */
  serverlessAllowed: boolean;
  /** Whether the browser can do E2E crypto (requires HTTPS or localhost / secure context). */
  e2eAvailable: boolean;
}

// Web Crypto's subtle API is only available in a secure context (HTTPS or
// localhost). Over plain-HTTP LAN it is undefined, so E2E mode cannot work.
const E2E_AVAILABLE = typeof crypto !== "undefined" && !!crypto.subtle;

/** Serverless files above this size prompt the user to optionally skip encryption for speed. */
export const SERVERLESS_ENCRYPT_PROMPT_BYTES = 100 * 1024 * 1024;

const ChatContext = createContext<ChatContextValue | null>(null);
export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside ChatProvider");
  return ctx;
};

const CHUNK = 256 * 1024; // 256KB per chunk (under the 8MB socket buffer)

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const utils = trpc.useUtils();
  const convQuery = trpc.chat.listConversations.useQuery(undefined, { refetchOnWindowFocus: false });
  const conversations = useMemo(() => (convQuery.data as ConversationSummary[] | undefined) ?? [], [convQuery.data]);
  const settingsQuery = trpc.chat.getSettings.useQuery(undefined, { refetchOnWindowFocus: false });
  const maxFileMb = settingsQuery.data?.maxFileMb ?? 16;
  const serverlessAllowed = settingsQuery.data?.serverlessAllowed ?? true;
  const joinableQuery = trpc.chat.listJoinableRooms.useQuery(undefined, { refetchOnWindowFocus: false });
  const joinableRooms = useMemo(() => (joinableQuery.data as JoinableRoom[] | undefined) ?? [], [joinableQuery.data]);
  const meQuery = trpc.auth.me.useQuery(undefined, { refetchOnWindowFocus: false });
  const myUserId = meQuery.data?.id ?? null;

  const joinRoomMut = trpc.chat.joinRoom.useMutation();
  const deleteRoomMut = trpc.chat.deleteRoom.useMutation();
  const leaveRoomMut = trpc.chat.leaveRoom.useMutation();
  const startDmMut = trpc.chat.startDm.useMutation();
  const createRoomMut2 = trpc.chat.createRoom.useMutation();
  const inviteMut = trpc.chat.inviteToRoom.useMutation();

  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatWireMessage[]>([]);
  const [presence, setPresence] = useState<ChatPresenceUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const privateKeyRef = useRef<CryptoKey | null>(null);
  // per-conversation symmetric key cache for serverless mode
  const convKeyRef = useRef<Map<number, CryptoKey>>(new Map());
  const activeIdRef = useRef<number | null>(null);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // serverless inbound file reassembly
  const fileBufs = useRef<Map<string, { chunks: Uint8Array[]; meta: ChatFileRef }>>(new Map());

  const sendMessageMut = trpc.chat.sendMessage.useMutation();
  const uploadFileMut = trpc.chat.uploadFile.useMutation();
  const createUploadUrlMut = trpc.chat.createUploadUrl.useMutation();
  const confirmUploadMut = trpc.chat.confirmUpload.useMutation();
  const publishKeyMut = trpc.chat.publishPublicKey.useMutation();

  const activeConv = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId]);
  const didAutoSelectRef = useRef(false);

  // ── identity key bootstrap ────────────────────────────────────────────────
  useEffect(() => {
    if (!E2E_AVAILABLE) return; // no Web Crypto (insecure context) — skip E2E setup
    (async () => {
      try {
        let jwk = await loadPrivateKeyJwk();
        let pubJwk: JsonWebKey;
        if (jwk) {
          privateKeyRef.current = await importPrivateKeyJwk(jwk);
          // derive public from stored private (re-export public part)
          const kp = await importPrivateKeyJwk(jwk);
          privateKeyRef.current = kp;
          // public JWK is the private JWK without 'd'
          const { d: _d, ...pub } = jwk as JsonWebKey & { d?: string };
          pubJwk = { ...pub, key_ops: [] } as JsonWebKey;
        } else {
          const idk = await generateIdentityKeyPair();
          privateKeyRef.current = idk.privateKey;
          const privJwk = await exportPrivateKeyJwk(idk.privateKey);
          await savePrivateKeyJwk(privJwk);
          pubJwk = idk.publicKeyJwk;
          jwk = privJwk;
        }
        await publishKeyMut.mutateAsync({ publicKeyJwk: pubJwk as Record<string, unknown> });
      } catch (e) {
        console.warn("[chat] identity key bootstrap failed", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── socket connection ─────────────────────────────────────────────────────
  useEffect(() => {
    const devUser = new URLSearchParams(window.location.search).get("devUser");
    const socket = io("/chat", {
      path: "/api/socket",
      transports: ["websocket", "polling"],
      withCredentials: true,
      auth: devUser ? { devUser: Number(devUser) } : {},
    });
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("chat:message:new", (msg: ChatWireMessage) => {
      if (msg.conversationId === activeIdRef.current) {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      }
      utils.chat.listConversations.invalidate();
    });

    socket.on("chat:presence", (p: { conversationId: number; online: ChatPresenceUser[] }) => {
      if (p.conversationId === activeIdRef.current) setPresence(p.online);
    });

    socket.on("chat:typing", (t: { conversationId: number; userId: number; name: string }) => {
      if (t.conversationId !== activeIdRef.current) return;
      setTypingUsers((prev) => (prev.includes(t.name) ? prev : [...prev, t.name]));
      const key = String(t.userId);
      clearTimeout(typingTimers.current.get(key));
      typingTimers.current.set(key, setTimeout(() => {
        setTypingUsers((prev) => prev.filter((n) => n !== t.name));
      }, 3000));
    });

    socket.on("conversation:created", () => { utils.chat.listConversations.invalidate(); utils.chat.listJoinableRooms.invalidate(); });
    socket.on("conversation:deleted", (p: { conversationId: number }) => {
      if (p.conversationId === activeIdRef.current) { activeIdRef.current = null; setActiveId(null); setMessages([]); }
      utils.chat.listConversations.invalidate();
      utils.chat.listJoinableRooms.invalidate();
    });
    socket.on("conversation:mode-changed", () => {
      utils.chat.listConversations.invalidate();
      if (activeIdRef.current) void reloadMessages(activeIdRef.current);
    });

    socket.on("chat:relay", (payload: ChatRelayPayload) => { void handleRelay(payload); });
    socket.on("chat:file-chunk", (frame: { conversationId: number; transferId: string; seq: number; last: boolean; data: string; meta?: ChatFileRef; senderId: number; senderName?: string }) => {
      void handleFileChunk(frame);
    });

    return () => { socket.disconnect(); socketRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── conversation key derivation (serverless) ──────────────────────────────
  const getConversationKey = useCallback(async (convId: number, type: string): Promise<CryptoKey | null> => {
    const cached = convKeyRef.current.get(convId);
    if (cached) return cached;
    if (!privateKeyRef.current) return null;

    if (type === "dm") {
      const detail = await utils.chat.getConversation.fetch({ conversationId: convId });
      const me = detail.members.find((m) => m.name); // any; we need peer
      const myId = detail.members.length === 2 ? undefined : me?.userId;
      void myId;
      // peer = the member whose key we can fetch and we are not
      const peers = detail.members;
      const keys = await utils.chat.getPublicKeys.fetch({ userIds: peers.map((p) => p.userId) });
      // derive with the first peer key that isn't ours — for a DM there are 2 members
      for (const k of keys) {
        try {
          const shared = await deriveSharedKey(privateKeyRef.current, k.publicKeyJwk as JsonWebKey);
          // store and return — both sides derive the same key regardless of order
          convKeyRef.current.set(convId, shared);
          return shared;
        } catch { /* try next */ }
      }
      return null;
    }

    // group: request the room key from peers; if none respond shortly, mint one.
    const socket = socketRef.current;
    if (!socket) return null;
    socket.emit("chat:relay", {
      conversationId: convId, kind: "key-request", ciphertext: "", iv: "",
      clientMsgId: crypto.randomUUID(), senderId: 0, senderName: "",
    } as ChatRelayPayload);
    // wait briefly for a key-bundle response
    await new Promise((r) => setTimeout(r, 800));
    const afterWait = convKeyRef.current.get(convId);
    if (afterWait) return afterWait;
    // mint a fresh room key (first member in)
    const roomKey = await generateRoomKey();
    convKeyRef.current.set(convId, roomKey);
    return roomKey;
  }, [utils]);

  // distribute room key to a requesting member
  const answerKeyRequest = useCallback(async (convId: number, requesterId: number) => {
    const key = convKeyRef.current.get(convId);
    if (!key || !privateKeyRef.current) return;
    const socket = socketRef.current;
    if (!socket) return;
    const keys = await utils.chat.getPublicKeys.fetch({ userIds: [requesterId] });
    const reqKey = keys[0];
    if (!reqKey) return;
    const wrapping = await deriveSharedKey(privateKeyRef.current, reqKey.publicKeyJwk as JsonWebKey);
    const wrapped = await wrapRoomKeyForMember(key, wrapping);
    socket.emit("chat:relay", {
      conversationId: convId, kind: "key-bundle", target: requesterId,
      ciphertext: wrapped.ciphertext, iv: wrapped.iv,
      clientMsgId: crypto.randomUUID(), senderId: 0, senderName: "",
    } as ChatRelayPayload);
  }, [utils]);

  const handleRelay = useCallback(async (payload: ChatRelayPayload) => {
    if (payload.kind === "key-request") {
      void answerKeyRequest(payload.conversationId, payload.senderId);
      return;
    }
    if (payload.kind === "key-bundle") {
      // only consume if addressed to me — derive wrapping key from sender pub
      if (!privateKeyRef.current) return;
      try {
        const keys = await utils.chat.getPublicKeys.fetch({ userIds: [payload.senderId] });
        const sk = keys[0];
        if (!sk) return;
        const wrapping = await deriveSharedKey(privateKeyRef.current, sk.publicKeyJwk as JsonWebKey);
        const roomKey = await unwrapRoomKey({ ciphertext: payload.ciphertext, iv: payload.iv }, wrapping);
        convKeyRef.current.set(payload.conversationId, roomKey);
      } catch { /* not for me / wrong key */ }
      return;
    }
    // message
    const conv = conversations.find((c) => c.id === payload.conversationId);
    const key = await getConversationKey(payload.conversationId, conv?.type ?? "group");
    if (!key) return;
    let text = "[无法解密]";
    try { text = await decryptText(key, { ciphertext: payload.ciphertext, iv: payload.iv }); } catch { /* keep placeholder */ }
    const wire: ChatWireMessage = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      conversationId: payload.conversationId,
      senderId: payload.senderId,
      senderName: payload.senderName,
      content: text,
      attachments: payload.fileMeta ? [payload.fileMeta] : null,
      createdAt: new Date().toISOString(),
    };
    await appendLocalHistory(payload.conversationId, wire);
    if (payload.conversationId === activeIdRef.current) {
      setMessages((prev) => [...prev, wire]);
    }
  }, [conversations, getConversationKey, answerKeyRequest, utils]);

  const handleFileChunk = useCallback(async (frame: { conversationId: number; transferId: string; seq: number; last: boolean; data: string; meta?: ChatFileRef; encrypted?: boolean; senderId: number; senderName?: string }) => {
    const conv = conversations.find((c) => c.id === frame.conversationId);
    const encrypted = frame.encrypted !== false;
    const key = encrypted ? await getConversationKey(frame.conversationId, conv?.type ?? "group") : null;
    if (encrypted && !key) return;
    let entry = fileBufs.current.get(frame.transferId);
    if (!entry) {
      if (!frame.meta) return;
      entry = { chunks: [], meta: frame.meta };
      fileBufs.current.set(frame.transferId, entry);
    }
    try {
      const raw = Uint8Array.from(atob(frame.data), (c) => c.charCodeAt(0));
      if (encrypted && key) {
        // chunk is iv(12) + ciphertext — decrypt
        const iv = raw.slice(0, 12);
        const ct = raw.slice(12);
        const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
        entry.chunks[frame.seq] = new Uint8Array(dec);
      } else {
        entry.chunks[frame.seq] = raw; // plaintext fast path
      }
    } catch { return; }
    if (frame.last) {
      const blob = new Blob(entry.chunks as unknown as BlobPart[], { type: entry.meta.mimeType });
      const url = URL.createObjectURL(blob);
      fileBufs.current.delete(frame.transferId);
      const wire: ChatWireMessage = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        conversationId: frame.conversationId, senderId: frame.senderId,
        senderName: frame.senderName ?? "",
        content: "", attachments: [{ ...entry.meta, url }],
        createdAt: new Date().toISOString(),
      };
      await appendLocalHistory(frame.conversationId, wire);
      if (frame.conversationId === activeIdRef.current) setMessages((prev) => [...prev, wire]);
    }
  }, [conversations, getConversationKey]);

  // ── message loading on conversation switch ────────────────────────────────
  const reloadMessages = useCallback(async (convId: number) => {
    const conv = conversations.find((c) => c.id === convId);
    setLoadingMessages(true);
    try {
      if (conv?.mode === "serverless") {
        const local = await loadLocalHistory(convId);
        setMessages(local);
      } else {
        const rows = await utils.chat.getMessages.fetch({ conversationId: convId, limit: 50 });
        setMessages(rows as ChatWireMessage[]);
      }
    } catch { setMessages([]); }
    finally { setLoadingMessages(false); }
  }, [conversations, utils]);

  const selectConversation = useCallback((id: number) => {
    const prev = activeIdRef.current;
    if (prev && socketRef.current) socketRef.current.emit("chat:leave", { conversationId: prev });
    activeIdRef.current = id;
    setActiveId(id);
    setMessages([]); setPresence([]); setTypingUsers([]);
    if (socketRef.current) socketRef.current.emit("chat:join", { conversationId: id });
    void reloadMessages(id);
  }, [reloadMessages]);

  // ── 首次进入默认选中大厅 ───────────────────────────────────────────────────
  useEffect(() => {
    if (didAutoSelectRef.current) return;
    if (activeIdRef.current !== null) return; // 用户已手动选择
    if (conversations.length === 0) return; // 会话尚未加载
    const lobby = conversations.find((c) => c.type === "lobby");
    if (!lobby) return; // 大厅未启用
    didAutoSelectRef.current = true;
    selectConversation(lobby.id);
  }, [conversations, selectConversation]);

  // ── sending ───────────────────────────────────────────────────────────────
  const sendText = useCallback(async (text: string) => {
    const id = activeIdRef.current;
    if (!id || !text.trim()) return;
    const conv = conversations.find((c) => c.id === id);
    if (conv?.mode === "serverless") {
      const key = await getConversationKey(id, conv.type);
      if (!key) throw new Error(E2E_AVAILABLE ? "加密密钥未就绪，请稍候重试" : "端到端加密需在 HTTPS 或 localhost 环境下使用");
      const enc: Encrypted = await encryptText(key, text);
      const payload: ChatRelayPayload = {
        conversationId: id, senderId: 0, senderName: "",
        ciphertext: enc.ciphertext, iv: enc.iv, kind: "message", clientMsgId: crypto.randomUUID(),
      };
      socketRef.current?.emit("chat:relay", payload);
      // optimistic local echo
      const wire: ChatWireMessage = {
        id: Date.now(), conversationId: id, senderId: -1, senderName: "我",
        content: text, attachments: null, createdAt: new Date().toISOString(),
      };
      await appendLocalHistory(id, wire);
      setMessages((prev) => [...prev, wire]);
    } else {
      await sendMessageMut.mutateAsync({ conversationId: id, content: text });
    }
  }, [conversations, getConversationKey, sendMessageMut]);

  const sendFile = useCallback(async (file: File, opts?: { encrypt?: boolean }) => {
    const id = activeIdRef.current;
    if (!id) return;
    const conv = conversations.find((c) => c.id === id);
    const kind: ChatFileRef["kind"] = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file";

    // Enforce the admin-configured single-file limit for BOTH modes (single source of truth).
    const maxBytes = maxFileMb * 1024 * 1024;
    if (file.size > maxBytes) throw new Error(`文件超过管理员设置的上限 ${maxFileMb}MB`);

    if (conv?.mode === "serverless") {
      const encrypt = opts?.encrypt !== false; // default: encrypt
      const key = encrypt ? await getConversationKey(id, conv.type) : null;
      if (encrypt && !key) throw new Error(E2E_AVAILABLE ? "加密密钥未就绪，请稍候重试" : "端到端加密需在 HTTPS 或 localhost 环境下使用");
      const transferId = crypto.randomUUID();
      const meta: ChatFileRef = { name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, url: "", kind };
      const total = Math.ceil(file.size / CHUNK) || 1;
      for (let seq = 0; seq < total; seq++) {
        // Stream the file chunk-by-chunk from disk — never hold the whole file in memory.
        const slice = new Uint8Array(await file.slice(seq * CHUNK, (seq + 1) * CHUNK).arrayBuffer());
        let framed: Uint8Array;
        if (encrypt && key) {
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, slice));
          framed = new Uint8Array(12 + ct.length);
          framed.set(iv, 0); framed.set(ct, 12);
        } else {
          framed = slice; // plaintext fast path
        }
        let bin = ""; for (let i = 0; i < framed.length; i++) bin += String.fromCharCode(framed[i]);
        socketRef.current?.emit("chat:file-chunk", {
          conversationId: id, transferId, seq, last: seq === total - 1,
          data: btoa(bin), encrypted: encrypt, meta: seq === 0 ? meta : undefined,
        });
        // yield to the event loop so the UI stays responsive on big files
        if (seq % 8 === 7) await new Promise((r) => setTimeout(r, 0));
      }
      const localUrl = URL.createObjectURL(file);
      const wire: ChatWireMessage = {
        id: Date.now(), conversationId: id, senderId: -1, senderName: "我",
        content: "", attachments: [{ ...meta, url: localUrl }], createdAt: new Date().toISOString(),
      };
      await appendLocalHistory(id, wire);
      setMessages((prev) => [...prev, wire]);
    } else {
      // Server mode: prefer direct-to-storage presigned PUT (handles huge files,
      // bypasses the body limit). Falls back to base64 tRPC when storage is unset.
      const up = await createUploadUrlMut.mutateAsync({
        conversationId: id, filename: file.name, mimeType: file.type || "application/octet-stream", size: file.size,
      });
      let attachmentId: number;
      if (up.mode === "presigned") {
        const putResp = await fetch(up.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        if (!putResp.ok) throw new Error("上传到存储失败");
        const att = await confirmUploadMut.mutateAsync({
          conversationId: id, key: up.key, url: up.url, name: up.name, mimeType: file.type || "application/octet-stream", size: file.size,
        });
        attachmentId = att.attachmentId;
      } else {
        const base64 = await fileToBase64(file);
        const att = await uploadFileMut.mutateAsync({ conversationId: id, base64, mimeType: file.type || "application/octet-stream", filename: file.name });
        attachmentId = att.attachmentId;
      }
      await sendMessageMut.mutateAsync({ conversationId: id, content: "", attachmentIds: [attachmentId] });
    }
  }, [conversations, getConversationKey, uploadFileMut, createUploadUrlMut, confirmUploadMut, sendMessageMut, maxFileMb]);

  const emitTyping = useCallback(() => {
    const id = activeIdRef.current;
    if (id) socketRef.current?.emit("chat:typing", { conversationId: id });
  }, []);

  const joinRoom = useCallback(async (id: number, password?: string) => {
    await joinRoomMut.mutateAsync({ conversationId: id, password });
    await Promise.all([convQuery.refetch(), joinableQuery.refetch()]);
    selectConversation(id);
  }, [joinRoomMut, convQuery, joinableQuery, selectConversation]);

  const deleteRoom = useCallback(async (id: number) => {
    await deleteRoomMut.mutateAsync({ conversationId: id });
    if (activeIdRef.current === id) { activeIdRef.current = null; setActiveId(null); setMessages([]); }
    await Promise.all([convQuery.refetch(), joinableQuery.refetch()]);
  }, [deleteRoomMut, convQuery, joinableQuery]);

  const leaveRoom = useCallback(async (id: number) => {
    await leaveRoomMut.mutateAsync({ conversationId: id });
    if (activeIdRef.current === id) { activeIdRef.current = null; setActiveId(null); setMessages([]); }
    await Promise.all([convQuery.refetch(), joinableQuery.refetch()]);
  }, [leaveRoomMut, convQuery, joinableQuery]);

  const openDm = useCallback(async (userId: number) => {
    const res = await startDmMut.mutateAsync({ targetUserId: userId });
    await convQuery.refetch();
    selectConversation(res.id);
  }, [startDmMut, convQuery, selectConversation]);

  const createGroupWith = useCallback(async (title: string, userIds: number[]) => {
    const res = await createRoomMut2.mutateAsync({ title, mode: "server" });
    for (const uid of userIds) {
      try { await inviteMut.mutateAsync({ conversationId: res.id, targetUserId: uid }); } catch { /* skip */ }
    }
    await Promise.all([convQuery.refetch(), joinableQuery.refetch()]);
    selectConversation(res.id);
  }, [createRoomMut2, inviteMut, convQuery, joinableQuery, selectConversation]);

  const value: ChatContextValue = {
    conversations, refetchConversations: () => { convQuery.refetch(); joinableQuery.refetch(); },
    joinableRooms, myUserId,
    activeId, activeConv, selectConversation, joinRoom, deleteRoom, leaveRoom,
    openDm, createGroupWith,
    messages, presence, typingUsers,
    connected, sendText, sendFile, emitTyping, loadingMessages,
    maxFileMb, serverlessAllowed, e2eAvailable: E2E_AVAILABLE,
  };
  return <ChatContext.Provider value={value}>{children}<Lightbox /></ChatContext.Provider>;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      resolve(res.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
