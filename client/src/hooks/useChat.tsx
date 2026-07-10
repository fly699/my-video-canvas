import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { trpc } from "@/lib/trpc";
import type {
  ChatWireMessage, ChatPresenceUser, ChatRelayPayload, ChatFileRef,
} from "@shared/types";
import {
  generateIdentityKeyPair, importPrivateKeyJwk, exportPrivateKeyJwk,
  deriveSharedKey, generateRoomKey, encryptText, decryptText,
  wrapRoomKeyForMember, unwrapRoomKey, roomKeyToB64, roomKeyFromB64, type Encrypted,
} from "@/lib/chatCrypto";
import { loadPrivateKeyJwk, savePrivateKeyJwk, loadLocalHistory, appendLocalHistory, loadRoomKey, saveRoomKey, saveLocalHistory } from "@/lib/chatKeyStore";
import { playMessageSound, showCompletionNotification, ensureNotificationPermission } from "@/lib/notify";
import { toast } from "sonner";

/** 聊天静音开关（横幅 + 声音 + 桌面通知）。持久化在 localStorage，头部铃铛按钮切换。 */
export const CHAT_MUTED_KEY = "avc:chat-muted";
function isChatMuted(): boolean {
  try { return localStorage.getItem(CHAT_MUTED_KEY) === "1"; } catch { return false; }
}
import { Lightbox } from "@/components/chat/chatLightbox";

export interface ConversationSummary {
  id: number; type: string; mode: string; title: string | null;
  isPrivate: boolean; memberCount: number; lastMessage: ChatWireMessage | null;
  unread: number; peer?: { id: number; name: string | null }; isBroadcast?: boolean;
}

export interface JoinableRoom { id: number; title: string | null; isPrivate: boolean; mode: string }

// Monotonic client-side message id for optimistic echoes and E2E-relayed messages (which
// have no server row id). Bare Date.now()(+rand) collided when two were minted in the same
// millisecond → appendLocalHistory dedupes by id and silently dropped one on the next reload.
// Strictly-increasing + large (≫ any real DB id) avoids both collisions and server-id clashes.
let _lastLocalMsgId = 0;
function nextLocalMsgId(): number {
  _lastLocalMsgId = Math.max(_lastLocalMsgId + 1, Date.now() * 1000);
  return _lastLocalMsgId;
}

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
  /** Force-reload the active conversation's messages from the server (authoritative,
   *  no socket dependency). Used by AI 助手「新对话」after clearing history. */
  reloadActiveMessages: () => void;
  /** 加载当前会话更早的历史消息（server 模式分页；serverless 本地已全量，无需分页）。 */
  loadEarlierMessages: () => Promise<void>;
  /** 是否可能还有更早的消息（上次分页取满一页即认为还有）。 */
  hasMoreMessages: boolean;
  /** 正在加载更早消息。 */
  loadingEarlier: boolean;
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
/** 聊天历史分页每页条数（server 模式）。 */
const MESSAGE_PAGE = 50;

const ChatContext = createContext<ChatContextValue | null>(null);
export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside ChatProvider");
  return ctx;
};

const CHUNK = 256 * 1024; // 256KB per chunk (under the 8MB socket buffer)

// Local-only augmentation: a message we couldn't decrypt yet keeps its ciphertext so it
// can be re-decrypted once the room key finally arrives (never sent to the server).
type StoredChatMsg = ChatWireMessage & { _enc?: { ciphertext: string; iv: string } };
const DECRYPT_FAIL = "[无法解密]";

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const utils = trpc.useUtils();
  const convQuery = trpc.chat.listConversations.useQuery(undefined, { refetchOnWindowFocus: false });
  const conversations = useMemo(() => (convQuery.data as ConversationSummary[] | undefined) ?? [], [convQuery.data]);
  const settingsQuery = trpc.chat.getSettings.useQuery(undefined, { refetchOnWindowFocus: false });
  const maxFileMb = settingsQuery.data?.maxFileMb ?? 5000;
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
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const privateKeyRef = useRef<CryptoKey | null>(null);
  // my identity public key (JWK) — stored so I can wrap room keys and stamp senderPubJwk.
  const publicKeyRef = useRef<JsonWebKey | null>(null);
  // per-conversation symmetric key cache for serverless mode
  const convKeyRef = useRef<Map<number, CryptoKey>>(new Map());
  const activeIdRef = useRef<number | null>(null);
  const myUserIdRef = useRef<number | null>(null);
  const convTitleRef = useRef<Map<number, string>>(new Map());
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // socket 连接 effect 依赖数组为 []（只建一次连接），若直接引用 reloadMessages/handleRelay/
  // handleFileChunk 会冻结成首帧闭包——那时 conversations 仍是 []，导致：重连后 serverless 会话
  // 被误当 server 拉取而清空、DM 中继/文件用错「group」密钥派生 →「[无法解密]」。用 ref 承接最新
  // 实例，socket 回调一律走 ref.current，始终拿到带最新 conversations 的版本。
  const reloadMessagesRef = useRef<(convId: number) => Promise<void>>(async () => {});
  const handleRelayRef = useRef<(p: ChatRelayPayload) => Promise<void>>(async () => {});
  type FileChunkFrame = { conversationId: number; transferId: string; seq: number; last: boolean; data: string; meta?: ChatFileRef; encrypted?: boolean; senderId: number; senderName?: string };
  const handleFileChunkRef = useRef<(f: FileChunkFrame) => Promise<void>>(async () => {});
  // serverless inbound file reassembly
  const fileBufs = useRef<Map<string, { chunks: Uint8Array[]; meta: ChatFileRef; received: Set<number>; total: number | null; done: boolean }>>(new Map());

  const sendMessageMut = trpc.chat.sendMessage.useMutation();
  const uploadFileMut = trpc.chat.uploadFile.useMutation();
  const createUploadUrlMut = trpc.chat.createUploadUrl.useMutation();
  const confirmUploadMut = trpc.chat.confirmUpload.useMutation();
  const publishKeyMut = trpc.chat.publishPublicKey.useMutation();
  const putRoomKeyBundlesMut = trpc.chat.putRoomKeyBundles.useMutation();

  const activeConv = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId]);
  // 供 socket 闭包（依赖 []）读取最新的「我的 id」与「会话标题」，用于新消息通知判断/文案。
  useEffect(() => { myUserIdRef.current = myUserId; }, [myUserId]);
  useEffect(() => {
    const m = convTitleRef.current;
    for (const c of conversations) m.set(c.id, c.type === "dm" ? (c.peer?.name ?? "私聊") : c.type === "lobby" ? "大厅" : (c.title ?? "群聊"));
  }, [conversations]);
  // 新消息提醒：别人发的、且（不在当前会话 或 窗口未聚焦）→ 声音 + 横幅 + 后台桌面通知。
  const notifyIncoming = useCallback((msg: { conversationId: number; senderId: number; senderName?: string | null; content?: string; hasMedia?: boolean }) => {
    if (isChatMuted()) return;
    const mine = myUserIdRef.current != null && msg.senderId === myUserIdRef.current;
    if (mine || msg.senderId === -1) return; // 自己发的/本地回显不提醒
    const isActive = msg.conversationId === activeIdRef.current;
    const focused = typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
    if (isActive && focused) return; // 正看着这个会话且聚焦 → 不打扰
    const who = msg.senderName || "新消息";
    const room = convTitleRef.current.get(msg.conversationId);
    const preview = msg.hasMedia ? "[媒体]" : (msg.content?.replace(/^\[#DLREQ:\d+\]\n?/, "📥 ").slice(0, 60) || "[新消息]");
    playMessageSound();
    if (focused) {
      // 前台但不在该会话：应用内横幅
      toast(`${who}${room ? ` · ${room}` : ""}`, { description: preview, duration: 4000 });
    } else {
      // 后台：系统桌面通知（无权限时静默）
      showCompletionNotification({ title: `${who}${room ? ` · ${room}` : ""}`, body: preview, tag: `chat-${msg.conversationId}` });
    }
  }, []);
  const didAutoSelectRef = useRef(false);
  const creatingAssistantRef = useRef(false);
  // 默认房间 = 内建「AI 助手」私聊。取其用户 id 以在会话列表里认出该 DM；无则创建。
  const assistantQuery = trpc.chat.assistantUserId.useQuery(undefined, { staleTime: 60 * 60_000, refetchOnWindowFocus: false });
  const assistantId = assistantQuery.data?.userId ?? null;
  const openAssistantMut = trpc.chat.openAssistant.useMutation();

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
        publicKeyRef.current = pubJwk;
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
    socket.on("connect", () => {
      setConnected(true);
      // `connect` fires on every reconnect too. socket.io assigns a fresh session
      // on reconnect, so the server-side room membership from the previous session
      // is gone — without re-joining, new messages silently stop arriving until the
      // user reselects a conversation. Re-join the active room to keep delivery live.
      const active = activeIdRef.current;
      if (active != null) {
        socket.emit("chat:join", { conversationId: active });
        void reloadMessagesRef.current(active); // resync（走 ref，避免首帧 conversations=[] 把 serverless 会话清空）
      }
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("chat:message:new", (msg: ChatWireMessage) => {
      if (msg.conversationId === activeIdRef.current) {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      }
      utils.chat.listConversations.invalidate();
      notifyIncoming({ conversationId: msg.conversationId, senderId: msg.senderId, senderName: msg.senderName, content: msg.content, hasMedia: !!(msg.attachments && msg.attachments.length) });
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
    // 管理员广播：定向到个人房，弹通知 + 刷新会话列表以显示「系统公告」房。senderId=-2=系统。
    socket.on("system:announce", (p: { roomId: number; title: string; body: string }) => {
      notifyIncoming({ conversationId: p.roomId, senderId: -2, senderName: "📢 系统公告", content: p.title });
      utils.chat.listConversations.invalidate();
    });
    // 持续公告 set/clear：刷新顶部常驻横幅（ChatView 内查询该接口渲染）。
    socket.on("system:announce:persistent", () => {
      utils.chat.getPersistentAnnouncement.invalidate();
    });
    socket.on("conversation:deleted", (p: { conversationId: number }) => {
      if (p.conversationId === activeIdRef.current) { activeIdRef.current = null; setActiveId(null); setMessages([]); }
      utils.chat.listConversations.invalidate();
      utils.chat.listJoinableRooms.invalidate();
    });
    // AI 助手「新对话」：历史被清空 → 所有会话清空本地消息列表，并刷新会话列表
    // （否则侧边栏「最后一条消息预览」会残留旧内容，与 conversation:deleted 对齐）。
    socket.on("conversation:cleared", (p: { conversationId: number }) => {
      if (p.conversationId === activeIdRef.current) setMessages([]);
      utils.chat.listConversations.invalidate();
    });
    socket.on("conversation:mode-changed", () => {
      utils.chat.listConversations.invalidate();
      if (activeIdRef.current) void reloadMessagesRef.current(activeIdRef.current);
    });

    socket.on("chat:relay", (payload: ChatRelayPayload) => { void handleRelayRef.current(payload); });
    socket.on("chat:file-chunk", (frame: { conversationId: number; transferId: string; seq: number; last: boolean; data: string; meta?: ChatFileRef; senderId: number; senderName?: string }) => {
      void handleFileChunkRef.current(frame);
    });

    return () => { socket.disconnect(); socketRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── conversation key derivation (serverless) ──────────────────────────────
  // Cache a room key in memory AND IndexedDB so a refresh never loses it (which would
  // otherwise force a divergent re-mint → the "[无法解密]" bug).
  const persistRoomKey = useCallback(async (convId: number, key: CryptoKey) => {
    convKeyRef.current.set(convId, key);
    try { await saveRoomKey(convId, await roomKeyToB64(key)); } catch { /* IndexedDB best-effort */ }
  }, []);

  // Re-decrypt any messages that were stored as "[无法解密]" once the correct key arrives.
  const reDecryptConversation = useCallback(async (convId: number, key: CryptoKey) => {
    const hist = (await loadLocalHistory(convId)) as StoredChatMsg[];
    // 只解密「[无法解密]」的行，得到 id → 明文 的补丁；解密期间不整覆盖历史。
    const patches = new Map<number, string>();
    await Promise.all(hist.map(async (m) => {
      if (m.content !== DECRYPT_FAIL || !m._enc) return;
      try { patches.set(m.id, await decryptText(key, m._enc)); } catch { /* keep placeholder */ }
    }));
    if (!patches.size) return;
    // 重新读「当前」历史再按 id 合并 —— 避免用陈旧快照整覆盖，丢掉解密这段时间里并发到达的新消息（finding4）。
    const current = (await loadLocalHistory(convId)) as StoredChatMsg[];
    const merged = current.map((m) => {
      const text = patches.get(m.id);
      if (text == null) return m;
      const { _enc, ...rest } = m; void _enc; // 解密成功 → 去掉暂存密文
      return { ...rest, content: text } as StoredChatMsg;
    });
    await saveLocalHistory(convId, merged as ChatWireMessage[]);
    if (convId === activeIdRef.current) setMessages(merged.map(({ _enc, ...r }) => { void _enc; return r as ChatWireMessage; }));
  }, []);

  // Wrap the room key for every member's published public key and upload the ciphertext
  // bundles to the server (server can't read them). Lets refreshing / offline / new
  // members converge on the same key instead of minting a divergent one.
  const distributeRoomKey = useCallback(async (convId: number, key: CryptoKey) => {
    if (!privateKeyRef.current || !publicKeyRef.current) return;
    try {
      const detail = await utils.chat.getConversation.fetch({ conversationId: convId });
      const memberIds = detail.members.map((m) => m.userId).filter((uid) => uid !== myUserId);
      if (!memberIds.length) return;
      const pubKeys = await utils.chat.getPublicKeys.fetch({ userIds: memberIds });
      const bundles: { memberUserId: number; wrappedKey: Encrypted }[] = [];
      for (const pk of pubKeys) {
        try {
          const wrapping = await deriveSharedKey(privateKeyRef.current, pk.publicKeyJwk as JsonWebKey);
          bundles.push({ memberUserId: pk.userId, wrappedKey: await wrapRoomKeyForMember(key, wrapping) });
        } catch { /* skip member whose key we can't wrap for */ }
      }
      if (bundles.length) await putRoomKeyBundlesMut.mutateAsync({ conversationId: convId, senderPublicKeyJwk: publicKeyRef.current as Record<string, unknown>, bundles });
    } catch { /* best-effort distribution */ }
  }, [utils, myUserId, putRoomKeyBundlesMut]);

  // Try to pull my wrapped room key from the server bundle. Returns the key or null.
  const tryServerBundle = useCallback(async (convId: number): Promise<CryptoKey | null> => {
    if (!privateKeyRef.current) return null;
    try {
      const bundle = await utils.chat.getRoomKeyBundle.fetch({ conversationId: convId });
      if (!bundle) return null;
      const wrapping = await deriveSharedKey(privateKeyRef.current, bundle.senderPubJwk as JsonWebKey);
      const k = await unwrapRoomKey(bundle.wrappedKey as Encrypted, wrapping);
      await persistRoomKey(convId, k);
      void reDecryptConversation(convId, k);
      return k;
    } catch { return null; }
  }, [utils, persistRoomKey, reDecryptConversation]);

  const getConversationKey = useCallback(async (convId: number, type: string): Promise<CryptoKey | null> => {
    const cached = convKeyRef.current.get(convId);
    if (cached) return cached;
    if (!privateKeyRef.current) return null;

    if (type === "dm") {
      const detail = await utils.chat.getConversation.fetch({ conversationId: convId });
      const keys = await utils.chat.getPublicKeys.fetch({ userIds: detail.members.map((p) => p.userId) });
      // derive with the PEER's key — must skip our own: deriveSharedKey(myPriv, myPub) is a valid
      // ECDH self-pairing that does NOT throw, so without this guard we could derive ECDH(myPriv,myPub)
      // (a key only we know) while the peer derives ECDH(peerPriv,myPub) → keys diverge → 永久「[无法解密]」。
      // ECDH is symmetric so ECDH(myPriv,peerPub)==ECDH(peerPriv,myPub); order among peers doesn't matter.
      for (const k of keys) {
        if (myUserId != null && k.userId === myUserId) continue; // never self-pair
        try {
          const shared = await deriveSharedKey(privateKeyRef.current, k.publicKeyJwk as JsonWebKey);
          convKeyRef.current.set(convId, shared);
          return shared;
        } catch { /* try next */ }
      }
      return null; // peer hasn't published a key yet → wait rather than mint a garbage key
    }

    // group: converge on ONE room key. Priority ladder (never blindly mint):
    // 1) IndexedDB (survives refresh)
    const savedB64 = await loadRoomKey(convId);
    if (savedB64) {
      try {
        const k = await roomKeyFromB64(savedB64);
        convKeyRef.current.set(convId, k);
        void reDecryptConversation(convId, k);
        return k;
      } catch { /* corrupt — fall through */ }
    }
    // 2) server-hosted wrapped bundle (created by whoever minted; survives offline/refresh/new-device)
    const fromServer = await tryServerBundle(convId);
    if (fromServer) return fromServer;
    // 3) ask live peers over socket; retry a few times, re-checking the server bundle each round
    const socket = socketRef.current;
    if (socket) {
      for (let i = 0; i < 3; i++) {
        socket.emit("chat:relay", {
          conversationId: convId, kind: "key-request", ciphertext: "", iv: "",
          clientMsgId: crypto.randomUUID(), senderId: 0, senderName: "",
        } as ChatRelayPayload);
        await new Promise((r) => setTimeout(r, 700));
        const got = convKeyRef.current.get(convId);
        if (got) return got;
        const late = await tryServerBundle(convId);
        if (late) return late;
      }
    }
    // 4) mint — but ONLY the designated minter (conversation creator, else lowest userId),
    //    so two members can't each mint a divergent key. Non-minters wait for the key.
    const detail = await utils.chat.getConversation.fetch({ conversationId: convId });
    const memberIds = detail.members.map((m) => m.userId);
    // 铸造者 = 建群者，但**仅当其仍在群内**；否则退到最小 userId——否则建群者退群后
    // minter 恒指向一个不会上线铸密钥的前成员，剩余成员全 [无法解密] 死锁（finding6）。
    const minter = (detail.createdBy != null && memberIds.includes(detail.createdBy))
      ? detail.createdBy
      : (memberIds.length ? Math.min(...memberIds) : null);
    if (myUserId != null && minter === myUserId) {
      const roomKey = await generateRoomKey();
      await persistRoomKey(convId, roomKey);
      void distributeRoomKey(convId, roomKey); // publish wrapped bundles for everyone
      return roomKey;
    }
    return null; // not the minter and no key yet → wait for the minter to come online
  }, [utils, myUserId, persistRoomKey, reDecryptConversation, tryServerBundle, distributeRoomKey]);

  // answer a key-request: wrap the room key for the requester and both relay it live AND
  // persist a server bundle (so it survives me going offline).
  const answerKeyRequest = useCallback(async (convId: number, requesterId: number) => {
    if (!requesterId || !privateKeyRef.current || !publicKeyRef.current) return;
    let key = convKeyRef.current.get(convId);
    if (!key) { // not in memory — try IndexedDB before giving up
      const b64 = await loadRoomKey(convId);
      if (b64) { try { key = await roomKeyFromB64(b64); convKeyRef.current.set(convId, key); } catch { /* corrupt */ } }
    }
    if (!key) return;
    const keys = await utils.chat.getPublicKeys.fetch({ userIds: [requesterId] });
    const reqKey = keys[0];
    if (!reqKey) return;
    const wrapping = await deriveSharedKey(privateKeyRef.current, reqKey.publicKeyJwk as JsonWebKey);
    const wrapped = await wrapRoomKeyForMember(key, wrapping);
    socketRef.current?.emit("chat:relay", {
      conversationId: convId, kind: "key-bundle", target: requesterId,
      ciphertext: wrapped.ciphertext, iv: wrapped.iv,
      clientMsgId: crypto.randomUUID(), senderId: 0, senderName: "",
    } as ChatRelayPayload);
    try { await putRoomKeyBundlesMut.mutateAsync({ conversationId: convId, senderPublicKeyJwk: publicKeyRef.current as Record<string, unknown>, bundles: [{ memberUserId: requesterId, wrappedKey: wrapped }] }); } catch { /* live relay still delivered */ }
  }, [utils, putRoomKeyBundlesMut]);

  const handleRelay = useCallback(async (payload: ChatRelayPayload) => {
    if (payload.kind === "key-request") {
      void answerKeyRequest(payload.conversationId, payload.senderId);
      return;
    }
    if (payload.kind === "key-bundle") {
      // only consume if addressed to me — derive wrapping key from sender pub
      if (payload.target != null && payload.target !== myUserId) return;
      if (!privateKeyRef.current) return;
      try {
        const keys = await utils.chat.getPublicKeys.fetch({ userIds: [payload.senderId] });
        const sk = keys[0];
        if (!sk) return;
        const wrapping = await deriveSharedKey(privateKeyRef.current, sk.publicKeyJwk as JsonWebKey);
        const roomKey = await unwrapRoomKey({ ciphertext: payload.ciphertext, iv: payload.iv }, wrapping);
        await persistRoomKey(payload.conversationId, roomKey);
        void reDecryptConversation(payload.conversationId, roomKey); // fix any earlier "[无法解密]"
      } catch { /* not for me / wrong key */ }
      return;
    }
    // message
    const conv = conversations.find((c) => c.id === payload.conversationId);
    const key = await getConversationKey(payload.conversationId, conv?.type ?? "group");
    let text = DECRYPT_FAIL;
    if (key) { try { text = await decryptText(key, { ciphertext: payload.ciphertext, iv: payload.iv }); } catch { /* keep placeholder */ } }
    const wire: StoredChatMsg = {
      id: nextLocalMsgId(),
      conversationId: payload.conversationId,
      senderId: payload.senderId,
      senderName: payload.senderName,
      content: text,
      attachments: payload.fileMeta ? [payload.fileMeta] : null,
      createdAt: new Date().toISOString(),
      // Retain ciphertext locally when we couldn't decrypt, so it can be re-decrypted
      // once the room key arrives (never uploaded to the server).
      ...(text === DECRYPT_FAIL ? { _enc: { ciphertext: payload.ciphertext, iv: payload.iv } } : {}),
    };
    await appendLocalHistory(payload.conversationId, wire);
    if (payload.conversationId === activeIdRef.current) {
      const { _enc, ...display } = wire; void _enc;
      setMessages((prev) => [...prev, display as ChatWireMessage]);
    }
    notifyIncoming({ conversationId: payload.conversationId, senderId: payload.senderId, senderName: payload.senderName, content: text, hasMedia: !!payload.fileMeta });
  }, [conversations, getConversationKey, answerKeyRequest, utils, myUserId, persistRoomKey, reDecryptConversation, notifyIncoming]);
  handleRelayRef.current = handleRelay;

  const handleFileChunk = useCallback(async (frame: { conversationId: number; transferId: string; seq: number; last: boolean; data: string; meta?: ChatFileRef; encrypted?: boolean; senderId: number; senderName?: string }) => {
    const conv = conversations.find((c) => c.id === frame.conversationId);
    const encrypted = frame.encrypted !== false;
    const key = encrypted ? await getConversationKey(frame.conversationId, conv?.type ?? "group") : null;
    if (encrypted && !key) return;
    let entry = fileBufs.current.get(frame.transferId);
    if (!entry) {
      if (!frame.meta) return;
      entry = { chunks: [], meta: frame.meta, received: new Set(), total: null, done: false };
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
      entry.received.add(frame.seq);
    } catch { return; }
    // Frames are dispatched fire-and-forget and decrypt concurrently, so the `last` frame can
    // finish BEFORE an earlier chunk (whose seq-0 decrypt triggered the key fetch). Assembling on
    // `last` alone could snapshot a chunks[] with undefined holes → corrupt file. Instead track the
    // total (last frame's seq+1) and the set of received seqs, and assemble only once EVERY chunk is
    // in — whichever frame completes the set wins (guarded by `done` so it runs exactly once).
    if (frame.last) entry.total = frame.seq + 1;
    if (entry.done || entry.total == null || entry.received.size < entry.total) return;
    entry.done = true; // synchronous from here to the map delete → no re-entry race
    const blob = new Blob(entry.chunks as unknown as BlobPart[], { type: entry.meta.mimeType });
    const url = URL.createObjectURL(blob);
    const meta = entry.meta;
    fileBufs.current.delete(frame.transferId);
    const wire: ChatWireMessage = {
      id: nextLocalMsgId(),
      conversationId: frame.conversationId, senderId: frame.senderId,
      senderName: frame.senderName ?? "",
      content: "", attachments: [{ ...meta, url }],
      createdAt: new Date().toISOString(),
    };
    await appendLocalHistory(frame.conversationId, wire);
    if (frame.conversationId === activeIdRef.current) setMessages((prev) => [...prev, wire]);
    // E2E 会话收到的文件/语音也要提醒（与 server 模式一致；此前遗漏）。
    notifyIncoming({ conversationId: frame.conversationId, senderId: frame.senderId, senderName: frame.senderName, hasMedia: true });
  }, [conversations, getConversationKey, notifyIncoming]);
  handleFileChunkRef.current = handleFileChunk;

  // ── message loading on conversation switch ────────────────────────────────
  const reloadMessages = useCallback(async (convId: number) => {
    const conv = conversations.find((c) => c.id === convId);
    setLoadingMessages(true);
    setHasMoreMessages(false);
    try {
      if (conv?.mode === "serverless") {
        const local = await loadLocalHistory(convId);
        setMessages(local); // serverless 历史本地全量，无分页
      } else {
        const rows = await utils.chat.getMessages.fetch({ conversationId: convId, limit: MESSAGE_PAGE });
        setMessages(rows as ChatWireMessage[]);
        setHasMoreMessages(rows.length >= MESSAGE_PAGE); // 取满一页 → 可能还有更早
      }
    } catch { setMessages([]); }
    finally { setLoadingMessages(false); }
  }, [conversations, utils]);
  reloadMessagesRef.current = reloadMessages;

  /** 加载更早历史：以当前最旧消息 id 为游标向前取一页，去重后前插；不改变滚动锚点由 UI 负责。 */
  const loadEarlierMessages = useCallback(async () => {
    const convId = activeIdRef.current;
    if (convId == null || loadingEarlier || !hasMoreMessages) return;
    const conv = conversations.find((c) => c.id === convId);
    if (conv?.mode === "serverless") { setHasMoreMessages(false); return; } // 本地已全量
    let oldestId: number | undefined;
    setMessages((prev) => { oldestId = prev[0]?.id; return prev; });
    if (oldestId == null) return;
    setLoadingEarlier(true);
    try {
      const older = await utils.chat.getMessages.fetch({ conversationId: convId, beforeId: oldestId, limit: MESSAGE_PAGE });
      if (activeIdRef.current !== convId) return; // 期间切换了会话 → 丢弃
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const fresh = (older as ChatWireMessage[]).filter((m) => !known.has(m.id));
        return [...fresh, ...prev];
      });
      setHasMoreMessages(older.length >= MESSAGE_PAGE);
    } catch { /* 加载失败：保留可重试状态 */ }
    finally { setLoadingEarlier(false); }
  }, [conversations, utils, loadingEarlier, hasMoreMessages]);

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
  // 默认直接进「AI 助手」房间：① 已有 AI 助手私聊 → 选中；② 无则创建后选中；
  // ③ 拿不到 AI 助手（未启用/出错）→ 回退大厅。仅自动选一次；用户手动选过则不干预。
  const assistantSettled = assistantQuery.isSuccess || assistantQuery.isError;
  useEffect(() => {
    if (didAutoSelectRef.current) return;
    if (activeIdRef.current !== null) return;   // 用户已手动选择
    if (!assistantSettled) return;              // 等 AI 助手 id 查询结束，避免过早回退大厅
    if (convQuery.isLoading) return;            // 会话列表仍在加载

    if (assistantId != null) {
      const ai = conversations.find((c) => c.type === "dm" && c.peer?.id === assistantId);
      if (ai) { didAutoSelectRef.current = true; selectConversation(ai.id); return; }
      if (!creatingAssistantRef.current) {      // 无 AI 助手会话 → 创建后进（只触发一次）
        creatingAssistantRef.current = true;
        didAutoSelectRef.current = true;
        openAssistantMut.mutateAsync()
          .then(async (r) => { await utils.chat.listConversations.refetch(); selectConversation(r.id); })
          .catch(() => { didAutoSelectRef.current = false; creatingAssistantRef.current = false; });
        return;
      }
      return;
    }
    // 回退：大厅
    const lobby = conversations.find((c) => c.type === "lobby");
    if (lobby) { didAutoSelectRef.current = true; selectConversation(lobby.id); }
  }, [conversations, assistantId, assistantSettled, convQuery.isLoading, selectConversation, openAssistantMut, utils]);

  // ── sending ───────────────────────────────────────────────────────────────
  const sendText = useCallback(async (text: string) => {
    const id = activeIdRef.current;
    if (!id || !text.trim()) return;
    // 首次发送即请求桌面通知权限（自然的用户手势），后续后台也能收系统提醒；被拒无碍（仍有声音+横幅）。
    if (!isChatMuted()) void ensureNotificationPermission();
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
        id: nextLocalMsgId(), conversationId: id, senderId: -1, senderName: "我",
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
        id: nextLocalMsgId(), conversationId: id, senderId: -1, senderName: "我",
        content: "", attachments: [{ ...meta, url: localUrl }], createdAt: new Date().toISOString(),
      };
      await appendLocalHistory(id, wire);
      setMessages((prev) => [...prev, wire]);
    } else {
      // Server mode: prefer direct-to-storage presigned PUT (handles huge files,
      // bypasses the body limit). Falls back to base64 tRPC when storage is unset.
      let attachmentId: number;
      try {
        const up = await createUploadUrlMut.mutateAsync({
          conversationId: id, filename: file.name, mimeType: file.type || "application/octet-stream", size: file.size,
        });
        if (up.mode === "presigned" || up.mode === "proxy") {
          // presigned → browser PUTs straight to S3; proxy → browser PUTs to the
          // app server which streams to internal MinIO. Same client flow either way.
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
      } catch (e) {
        // Without object storage the file is base64'd through tRPC; a large file
        // exceeds the server body limit and Express returns an HTML error page,
        // which tRPC then fails to parse ("Unexpected token '<', <!DOCTYPE…").
        // Translate that into an actionable message instead of the raw JSON error.
        const msg = e instanceof Error ? e.message : String(e);
        if (/<!DOCTYPE|Unexpected token '<'|not valid JSON|Payload Too Large|\b413\b/i.test(msg)) {
          throw new Error("上传失败：文件过大，超出服务器直传上限（约 37MB）。请改用更小的文件，或让管理员配置对象存储以支持大文件。");
        }
        throw e;
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
    reloadActiveMessages: () => { if (activeIdRef.current) void reloadMessages(activeIdRef.current); },
    loadEarlierMessages, hasMoreMessages, loadingEarlier,
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
