import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createServer as createHttpsServer } from "https";
import fs from "fs";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerEmailAuthRoutes } from "./emailAuth";
import { registerGoogleAuthRoutes } from "./googleAuth";
import { registerStorageProxy, registerStorageUploadProxy } from "./storageProxy";
import { registerFileRelay } from "./fileRelay";
import { registerVideoProxy } from "./videoProxy";
import { registerImageProxy } from "./imageProxy";
import { appRouter } from "../routers";
import { createContext, resolveRequestUser } from "./context";
import { getTunnelGate, initTunnel, setTunnelOrigin, getTunnelListenerPort } from "./tunnel";
import { isTunnelRequest, isTunnelExemptPath, isTunnelAllowed } from "./tunnelGate";
import { serveStatic, setupVite } from "./vite";
import { Server as SocketIOServer } from "socket.io";
import { setupVideoTaskPoller } from "../videoTaskPoller";
import { setComfySocketIO } from "./comfyui";
import { setStressSocketIO, STRESS_ROOM } from "./comfyStress";
import {
  setOpsTerminalSocketIO, openTerminalSession, writeToSession,
  resizeSession, closeSession, closeSessionsForSocket,
} from "./ops/sshTerminal";
import { setupOpsAlerts } from "./ops/opsAlerts";
import { setDownloadSocketIO, ADMIN_ROOM } from "./downloadNotify";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { getProjectAccess, isChatMember } from "../db";
import type { User } from "../../drizzle/schema";
import {
  registerChatBroadcaster,
  registerChatEventBroadcaster,
  registerChatUserBroadcaster,
} from "../routers/chat";
import type { ChatWireMessage, ChatRelayPayload, ChatPresenceUser } from "../../shared/types";
import { collabBus } from "./collabBus";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();

  // HTTPS when a self-signed (or real) cert pair exists — gives a secure
  // context so end-to-end encryption + PWA install work on LAN.
  let httpsCert: Buffer | null = null;
  let httpsKey: Buffer | null = null;
  try {
    if (fs.existsSync(ENV.httpsCertFile) && fs.existsSync(ENV.httpsKeyFile)) {
      httpsCert = fs.readFileSync(ENV.httpsCertFile);
      httpsKey = fs.readFileSync(ENV.httpsKeyFile);
    }
  } catch (e) { console.warn("[HTTPS] cert read failed, falling back to HTTP:", e); }
  const isHttps = !!(httpsCert && httpsKey);
  const server = isHttps ? createHttpsServer({ cert: httpsCert!, key: httpsKey! }, app) : createServer(app);

  // Let LAN clients download the public cert to trust it (no browser warning).
  app.get("/cert.crt", (_req, res) => {
    if (!httpsCert) { res.status(404).send("HTTPS not configured"); return; }
    res.setHeader("Content-Type", "application/x-x509-ca-cert");
    res.setHeader("Content-Disposition", "attachment; filename=avc-cert.crt");
    res.send(httpsCert);
  });

  // Trust the first proxy hop so req.ip reflects the real client IP from X-Forwarded-For.
  // This prevents IP spoofing via direct connections while supporting reverse-proxy deployments.
  app.set("trust proxy", 1);

  // ── Public-tunnel access gate ───────────────────────────────────────────────
  // When the built-in cloudflared tunnel is enabled, requests arriving THROUGH it
  // (Host == tunnel hostname) are gated by a SEPARATE tunnel whitelist: non-whitelisted
  // visitors may only load the page + sign in (so a whitelisted USER can log in); every
  // other resource (tRPC/storage/proxies/socket) returns 403. Local/LAN traffic is
  // untouched. Placed first so it covers all downstream routes.
  app.use(async (req, res, next) => {
    const g = getTunnelGate();
    if (!g.enabled) return next();
    if (!isTunnelRequest(req.socket?.localPort, getTunnelListenerPort(), req.headers, g.host)) return next();   // not via our tunnel
    if (isTunnelExemptPath(req.path)) return next();                  // auth + static SPA
    // Real public visitor IP for the IP-whitelist: cloudflared/Cloudflare passes it in
    // cf-connecting-ip (req.ip would be the localhost origin hop).
    const cfIp = (Array.isArray(req.headers["cf-connecting-ip"]) ? req.headers["cf-connecting-ip"][0] : req.headers["cf-connecting-ip"]) as string | undefined;
    const ip = cfIp || req.ip || req.socket?.remoteAddress || "unknown";
    let userId: number | undefined;
    try { userId = (await resolveRequestUser(req))?.id; } catch { /* unauthenticated */ }
    if (isTunnelAllowed(ip, userId, g.wl)) return next();
    res.status(403).json({ error: "此公网隧道仅对白名单内用户开放，请联系管理员把你的账号或 IP 加入隧道白名单。" });
  });

  // Streamed upload proxy must be registered BEFORE the body parsers so the raw
  // file stream reaches S3/MinIO untouched (no 50MB JSON limit, no base64).
  registerStorageUploadProxy(app);

  // 局域网大文件中转站（同样需在 body 解析器之前注册，PUT 走原始流式写盘）。
  registerFileRelay(app);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerVideoProxy(app);
  registerImageProxy(app);
  registerOAuthRoutes(app);
  registerEmailAuthRoutes(app);
  registerGoogleAuthRoutes(app);

  // Runtime auth-provider discovery — lets the login page decide which buttons
  // to show without baking VITE_* flags in at build time.
  app.get("/api/auth/providers", (_req, res) => {
    res.json({
      google: !!(ENV.googleClientId && ENV.googleClientSecret),
      manus: !!(ENV.oAuthServerUrl && ENV.appId),
    });
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // ── Socket.io for real-time collaboration ──────────────────────────────────
  const io = new SocketIOServer(server, {
    path: "/api/socket",
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["websocket", "polling"],
    // Allow large serverless chat file chunks (default is only 1MB).
    maxHttpBufferSize: 8 * 1024 * 1024,
  });

  // Authenticate every socket via the session cookie sent in the upgrade
  // request. Dev bypass mirrors createContext: when no OAuth + no DB are
  // configured, every connection is the dev user.
  const isDevBypass =
    process.env.NODE_ENV === "development" && !ENV.oAuthServerUrl && !process.env.DATABASE_URL;

  const DEV_USER_FOR_SOCKET: User = {
    id: 1,
    openId: "dev_user_local",
    name: "Dev User",
    email: "dev@localhost",
    loginMethod: "dev",
    passwordHash: null,
    role: "admin",
    adminLevel: 4,
    disabled: false,
    emailVerified: true,
    verifyCode: null,
    verifyCodeExpiresAt: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    lastSignedIn: new Date(),
  };

  io.use(async (socket, next) => {
    try {
      if (isDevBypass) {
        (socket.data as { user: User }).user = DEV_USER_FOR_SOCKET;
        return next();
      }
      // socket.request is a Node IncomingMessage; sdk.authenticateRequest only
      // touches the cookie header, so the shape matches Express's Request enough.
      const user = await sdk.authenticateRequest(
        socket.request as unknown as Parameters<typeof sdk.authenticateRequest>[0],
      );
      (socket.data as { user: User }).user = user;
      next();
    } catch {
      next(new Error("unauthenticated"));
    }
  });

  // Track users per project room
  const projectUsers = new Map<number, Map<number, { userName: string; color: string }>>();

  io.on("connection", (socket) => {
    const user = (socket.data as { user: User }).user;
    let currentProjectId: number | null = null;
    // Cache the user's effective role per joined project so the high-frequency
    // node:move stream doesn't run a DB query per event. The cache is
    // invalidated reactively via collabBus when an admin mutation changes
    // membership (role update / removal / link revocation), so a demoted
    // editor stops being able to broadcast mutating events within the same
    // session — not just on reconnect.
    const projectRoles = new Map<number, "viewer" | "editor" | "admin" | "owner">();
    const unsubscribeBus = collabBus.onRoleInvalidated(({ projectId, userId }) => {
      if (userId != null && userId !== user.id) return;
      if (!projectRoles.has(projectId)) return; // this socket isn't in that project room
      // Re-derive access instead of only clearing the cache:
      //  - revoked (removed member / public-access turned off) → LEAVE the room,
      //    otherwise the socket keeps receiving the project's realtime edit stream
      //    after losing access (info leak);
      //  - still a member → refresh the cached role. Bulk invalidations (userId
      //    unset, e.g. someone ELSE's role changed) would otherwise clear the cache
      //    and never refill it, silently dropping a still-valid editor's broadcasts
      //    until reconnect.
      void (async () => {
        let access: Awaited<ReturnType<typeof getProjectAccess>>;
        try { access = await getProjectAccess(projectId, user.id); }
        catch { return; } // transient DB error → keep prior state (next event re-gates)
        const room = `project:${projectId}`;
        if (!access) {
          projectRoles.delete(projectId);
          socket.leave(room);
          const lu = projectUsers.get(projectId);
          lu?.delete(user.id);
          if (lu && lu.size === 0) projectUsers.delete(projectId);
          if (currentProjectId === projectId) currentProjectId = null;
          socket.to(room).emit("collaboration-event", {
            type: "user:leave", userId: user.id, userName: user.name ?? "", color: "", projectId, payload: {},
          });
        } else {
          projectRoles.set(projectId, access.role);
        }
        // Tell the client to re-derive its UI state (refetch members / role).
        socket.emit("role-invalidated", { projectId });
      })();
    });

    // 管理员订阅 ComfyUI 压测进度房间（非管理员忽略）。
    socket.on("comfystress:subscribe", () => {
      if (user.role === "admin") socket.join(STRESS_ROOM);
    });
    socket.on("comfystress:unsubscribe", () => { socket.leave(STRESS_ROOM); });

    // ── ComfyUI 运维中心：交互式 SSH 终端（仅管理员）──────────────────────────
    // Each session is bound to this socket; writes/resize are owner-checked in
    // sshTerminal so a leaked sessionId can't inject into another admin's shell.
    socket.on("ops:term:open", async (data: { serverId: number; cols?: number; rows?: number }, ack?: (r: { sessionId?: string; error?: string }) => void) => {
      if (user.role !== "admin") { ack?.({ error: "forbidden" }); return; }
      try {
        const sessionId = await openTerminalSession(socket, user.id, data.serverId, { cols: data.cols ?? 80, rows: data.rows ?? 24 });
        ack?.({ sessionId });
      } catch (e) {
        ack?.({ error: e instanceof Error ? e.message : String(e) });
      }
    });
    socket.on("ops:term:input", (data: { sessionId: string; data: string }) => {
      if (user.role !== "admin") return;
      writeToSession(socket.id, data.sessionId, data.data);
    });
    socket.on("ops:term:resize", (data: { sessionId: string; cols: number; rows: number }) => {
      if (user.role !== "admin") return;
      resizeSession(socket.id, data.sessionId, data.cols, data.rows);
    });
    socket.on("ops:term:close", (data: { sessionId: string }) => {
      closeSession(socket.id, data.sessionId);
    });

    // Admins auto-join the notifications room so new download requests reach
    // them in-app (anywhere — canvas, library, etc.) for on-the-spot approval.
    if (user.role === "admin") socket.join(ADMIN_ROOM);

    socket.on("join-project", async (data: { projectId: number; userName: string; color: string }) => {
      try {
        const access = await getProjectAccess(data.projectId, user.id);
        if (!access) {
          socket.emit("auth-error", { code: "forbidden", projectId: data.projectId });
          return;
        }
        currentProjectId = data.projectId;
        projectRoles.set(data.projectId, access.role);
        const room = `project:${data.projectId}`;
        socket.join(room);

        if (!projectUsers.has(data.projectId)) {
          projectUsers.set(data.projectId, new Map());
        }
        projectUsers.get(data.projectId)!.set(user.id, {
          userName: data.userName,
          color: data.color,
        });

        socket.to(room).emit("collaboration-event", {
          type: "user:join",
          userId: user.id,
          userName: data.userName,
          color: data.color,
          projectId: data.projectId,
          payload: { role: access.role },
        });
      } catch (err) {
        console.error("[Socket] join-project error", err);
      }
    });

    socket.on("leave-project", (data: { projectId: number }) => {
      const room = `project:${data.projectId}`;
      socket.leave(room);
      const lu = projectUsers.get(data.projectId);
      lu?.delete(user.id);
      if (lu && lu.size === 0) projectUsers.delete(data.projectId); // reclaim empty room
      projectRoles.delete(data.projectId);

      socket.to(room).emit("collaboration-event", {
        type: "user:leave",
        userId: user.id,
        userName: user.name ?? "",
        color: "",
        projectId: data.projectId,
        payload: {},
      });
    });

    socket.on("collaboration-event", (event: {
      type: string;
      userId: number;
      userName: string;
      color: string;
      projectId: number;
      payload: unknown;
    }) => {
      // Reject mismatched identity (server uses the verified id, not client claim).
      if (event.userId !== user.id) return;
      const room = `project:${event.projectId}`;
      if (!socket.rooms.has(room)) return;
      const role = projectRoles.get(event.projectId);
      if (!role) return; // not joined / no cached access
      // For state-mutating events, require editor+. cursor:move and other
      // ephemeral events pass through without the role gate.
      const mutating = event.type === "node:move" || event.type === "node:add" ||
                       event.type === "node:delete" || event.type === "node:update" ||
                       event.type === "edge:add" || event.type === "edge:delete";
      if (mutating && role === "viewer") return;
      socket.to(room).emit("collaboration-event", { ...event, userId: user.id });
    });

    socket.on("disconnect", () => {
      unsubscribeBus();
      closeSessionsForSocket(socket.id);
      if (currentProjectId !== null) {
        const room = `project:${currentProjectId}`;
        const du = projectUsers.get(currentProjectId);
        du?.delete(user.id);
        if (du && du.size === 0) projectUsers.delete(currentProjectId); // reclaim empty room
        socket.to(room).emit("collaboration-event", {
          type: "user:leave",
          userId: user.id,
          userName: user.name ?? "",
          color: "",
          projectId: currentProjectId,
          payload: {},
        });
      }
    });
  });

  // ── Account-based Chat namespace (/chat) ───────────────────────────────────
  // Replaces the old /lan-chat namespace. Authenticated with the SAME cookie
  // middleware as the main namespace (resolves socket.data.user). Handles both
  // modes:
  //   - server mode: messages persist via tRPC then broadcast here as
  //     "chat:message:new".
  //   - serverless mode: clients emit "chat:relay" (E2E ciphertext) and
  //     "chat:file-chunk"; the server forwards to room peers WITHOUT persisting.
  const chatNs = io.of("/chat");

  chatNs.use(async (socket, next) => {
    try {
      if (isDevBypass) {
        // Allow a second dev identity for multi-user testing: ?devUser=2.
        const devUserParam = (socket.handshake.auth as { devUser?: number } | undefined)?.devUser;
        const u = { ...DEV_USER_FOR_SOCKET };
        if (devUserParam === 2) { u.id = 2; u.name = "Dev User 2"; u.openId = "dev_user_local_2"; }
        (socket.data as { user: User }).user = u;
        return next();
      }
      const user = await sdk.authenticateRequest(
        socket.request as unknown as Parameters<typeof sdk.authenticateRequest>[0],
      );
      (socket.data as { user: User }).user = user;
      next();
    } catch {
      next(new Error("unauthenticated"));
    }
  });

  // conversationId -> Map<userId, name> of online members (across sockets/tabs).
  const chatPresence = new Map<number, Map<number, string>>();
  const presenceList = (convId: number): ChatPresenceUser[] =>
    Array.from(chatPresence.get(convId)?.entries() ?? []).map(([userId, name]) => ({ userId, name }));

  chatNs.on("connection", (socket) => {
    const user = (socket.data as { user: User }).user;
    const joined = new Set<number>();
    // Personal room for new-DM / invite notifications.
    socket.join(`chat:user:${user.id}`);

    socket.on("chat:join", async ({ conversationId }: { conversationId: number }) => {
      if (typeof conversationId !== "number") return;
      try {
        if (!(await isChatMember(conversationId, user.id))) return;
      } catch { return; }
      socket.join(`chat:conv:${conversationId}`);
      joined.add(conversationId);
      let m = chatPresence.get(conversationId);
      if (!m) { m = new Map(); chatPresence.set(conversationId, m); }
      m.set(user.id, user.name ?? `用户${user.id}`);
      chatNs.to(`chat:conv:${conversationId}`).emit("chat:presence", { conversationId, online: presenceList(conversationId) });
    });

    socket.on("chat:leave", ({ conversationId }: { conversationId: number }) => {
      socket.leave(`chat:conv:${conversationId}`);
      joined.delete(conversationId);
      // Only drop presence if no other socket of this user is still in the room.
      const stillHere = Array.from(chatNs.sockets.values()).some(
        (s) => s.id !== socket.id && (s.data as { user?: User }).user?.id === user.id && s.rooms.has(`chat:conv:${conversationId}`),
      );
      if (!stillHere) chatPresence.get(conversationId)?.delete(user.id);
      chatNs.to(`chat:conv:${conversationId}`).emit("chat:presence", { conversationId, online: presenceList(conversationId) });
    });

    socket.on("chat:typing", ({ conversationId }: { conversationId: number }) => {
      if (!joined.has(conversationId)) return;
      socket.to(`chat:conv:${conversationId}`).emit("chat:typing", { conversationId, userId: user.id, name: user.name ?? `用户${user.id}` });
    });

    // Serverless E2E relay — server forwards opaque ciphertext, never persists.
    socket.on("chat:relay", async (payload: ChatRelayPayload) => {
      if (!payload || typeof payload.conversationId !== "number") return;
      if (!joined.has(payload.conversationId)) {
        if (!(await isChatMember(payload.conversationId, user.id).catch(() => false))) return;
      }
      socket.to(`chat:conv:${payload.conversationId}`).emit("chat:relay", { ...payload, senderId: user.id, senderName: user.name ?? `用户${user.id}` });
    });

    // Serverless file chunks — relayed, not stored.
    socket.on("chat:file-chunk", (frame: { conversationId: number; transferId: string; seq: number; last: boolean; data: string; meta?: unknown }) => {
      if (!frame || typeof frame.conversationId !== "number") return;
      if (!joined.has(frame.conversationId)) return;
      socket.to(`chat:conv:${frame.conversationId}`).emit("chat:file-chunk", { ...frame, senderId: user.id });
    });

    socket.on("disconnect", () => {
      for (const convId of Array.from(joined)) {
        const stillHere = Array.from(chatNs.sockets.values()).some(
          (s) => s.id !== socket.id && (s.data as { user?: User }).user?.id === user.id && s.rooms.has(`chat:conv:${convId}`),
        );
        if (!stillHere) {
          chatPresence.get(convId)?.delete(user.id);
          chatNs.to(`chat:conv:${convId}`).emit("chat:presence", { conversationId: convId, online: presenceList(convId) });
        }
      }
    });
  });

  // Wire tRPC → socket broadcasters (avoids routers/chat.ts importing index.ts).
  registerChatBroadcaster((conversationId: number, msg: ChatWireMessage) => {
    chatNs.to(`chat:conv:${conversationId}`).emit("chat:message:new", msg);
  });
  registerChatEventBroadcaster((conversationId: number, event: string, payload: unknown) => {
    chatNs.to(`chat:conv:${conversationId}`).emit(event, payload);
  });
  registerChatUserBroadcaster((userId: number, event: string, payload: unknown) => {
    chatNs.to(`chat:user:${userId}`).emit(event, payload);
  });

  // ── ComfyUI progress relay ────────────────────────────────────────────────
  setComfySocketIO(io);
  setStressSocketIO(io);
  setDownloadSocketIO(io);
  setOpsTerminalSocketIO(io);
  setupOpsAlerts(io);

  // ── Video task background poller ───────────────────────────────────────────
  setupVideoTaskPoller(io);

  // Development or production static
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, async () => {
    const proto = isHttps ? "https" : "http";
    console.log(`Server running on ${proto}://localhost:${port}/`);
    if (isHttps) console.log(`[HTTPS] self-signed cert active — LAN clients can trust it via ${proto}://<本机IP>:${port}/cert.crt`);
    // Dedicated 127.0.0.1 loopback listener that cloudflared forwards to (plain HTTP →
    // no self-signed-TLS 502). Any request arriving on THIS port is unambiguously tunnel
    // traffic, so the access gate identifies it by socket.localPort — no header guessing.
    try {
      const tunnelPort = await findAvailablePort(port + 1);
      const tunnelServer = createServer(app);
      // 关键：把 Socket.IO 也挂到这台隧道回环服务器上。否则经公网隧道进来的 WebSocket
      // 升级请求落在这台没有 io 的服务器上无人处理 → 聊天/协作 socket 永远「连接中」。
      io.attach(tunnelServer);
      tunnelServer.listen(tunnelPort, "127.0.0.1", () => {
        setTunnelOrigin(tunnelPort);
        console.log(`[Tunnel] internal origin on http://127.0.0.1:${tunnelPort} (socket.io attached)`);
        void initTunnel(); // 隧道监听就绪后再拉起 cloudflared + 预热门控缓存
      });
    } catch (e) { console.warn("[Tunnel] internal listener failed:", e); }
  });

  // When HTTPS is on, run a tiny HTTP listener that 301-redirects to HTTPS so
  // visitors who type http:// land on https://. Default port 80 (override via
  // HTTP_REDIRECT_PORT, set 0 to disable). Skips quietly if the port is busy.
  if (isHttps) {
    const redirectPort = parseInt(process.env.HTTP_REDIRECT_PORT || "80");
    if (redirectPort > 0) {
      const redirector = createServer((req, res) => {
        const host = (req.headers.host || `localhost:${redirectPort}`).replace(/:\d+$/, "");
        const target = `https://${host}${port === 443 ? "" : `:${port}`}${req.url || "/"}`;
        res.writeHead(301, { Location: target });
        res.end();
      });
      redirector.on("error", (e) => console.warn(`[HTTPS] HTTP→HTTPS redirect on :${redirectPort} skipped:`, (e as Error).message));
      redirector.listen(redirectPort, () => console.log(`[HTTPS] HTTP→HTTPS redirect listening on :${redirectPort}`));
    }
  }
}

startServer().catch(console.error);
