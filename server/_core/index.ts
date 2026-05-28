import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerEmailAuthRoutes } from "./emailAuth";
import { registerStorageProxy } from "./storageProxy";
import { registerVideoProxy } from "./videoProxy";
import { registerImageProxy } from "./imageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { Server as SocketIOServer } from "socket.io";
import { setupVideoTaskPoller } from "../videoTaskPoller";
import { setComfySocketIO } from "./comfyui";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { getProjectAccess } from "../db";
import type { User } from "../../drizzle/schema";
import { lanChatBus } from "./lanChatBus";
import { registerLanChatBroadcaster } from "../routers/lanChat";
import type { LanChatMessage } from "../../shared/types";
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
  const server = createServer(app);

  // Trust the first proxy hop so req.ip reflects the real client IP from X-Forwarded-For.
  // This prevents IP spoofing via direct connections while supporting reverse-proxy deployments.
  app.set("trust proxy", 1);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerVideoProxy(app);
  registerImageProxy(app);
  registerOAuthRoutes(app);
  registerEmailAuthRoutes(app);

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
    role: "user",
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
      projectRoles.delete(projectId);
      // Best-effort: tell the client to re-derive UI state. Client may
      // refetch listMembers / projects.get to learn the new role.
      socket.emit("role-invalidated", { projectId });
    });

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
      projectUsers.get(data.projectId)?.delete(user.id);
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
      if (currentProjectId !== null) {
        const room = `project:${currentProjectId}`;
        projectUsers.get(currentProjectId)?.delete(user.id);
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

  // ── LAN chat socket namespace ──────────────────────────────────────────────
  // Isolated namespace (/lan-chat) so the cookie-auth middleware above doesn't
  // apply. Auth here is by sessionId only — the "LAN" semantics are enforced
  // at the room layer (rooms scoped to the user's networkGroupId = their
  // clientIp), so users behind different NATs see independent chats even
  // though they all connect through the same global socket.
  const lanNs = io.of("/lan-chat");

  lanNs.use((socket, next) => {
    const sid = (socket.handshake.auth as { sessionId?: string } | undefined)?.sessionId;
    if (!sid) return next(new Error("session-required"));
    const sess = lanChatBus.getSession(sid);
    if (!sess) return next(new Error("session-not-found"));
    (socket.data as { sessionId: string }).sessionId = sid;
    next();
  });

  lanNs.on("connection", (socket) => {
    const sessionId = (socket.data as { sessionId: string }).sessionId;
    const joinedRooms = new Set<number>();

    socket.on("lan-chat:enter-room", ({ roomId }: { roomId: number }) => {
      if (typeof roomId !== "number") return;
      lanChatBus.enterRoom(sessionId, roomId);
      socket.join(`lan-room:${roomId}`);
      joinedRooms.add(roomId);
      lanNs.to(`lan-room:${roomId}`).emit("lan-chat:presence", {
        roomId,
        online: lanChatBus.listOnline(roomId),
      });
    });

    socket.on("lan-chat:leave-room", ({ roomId }: { roomId: number }) => {
      lanChatBus.leaveRoom(sessionId, roomId);
      socket.leave(`lan-room:${roomId}`);
      joinedRooms.delete(roomId);
      lanNs.to(`lan-room:${roomId}`).emit("lan-chat:presence", {
        roomId,
        online: lanChatBus.listOnline(roomId),
      });
    });

    socket.on("lan-chat:typing", ({ roomId }: { roomId: number }) => {
      const sess = lanChatBus.getSession(sessionId);
      if (!sess) return;
      socket.to(`lan-room:${roomId}`).emit("lan-chat:typing", {
        sessionId: sess.id,
        nickname: sess.nickname,
        roomId,
      });
    });

    // ── WebRTC signaling (P2P E2E chat) ───────────────────────────────────
    // Server only relays SDP/ICE between peers — never sees DataChannel
    // payload (encrypted DTLS-SRTP between browsers). Peers in the same
    // group find each other via the existing presence map; once
    // RTCPeerConnection is established they exchange chat messages
    // peer-to-peer.
    //
    // Event shapes (all addressed by targetSessionId so the server just
    // forwards):
    //   webrtc:offer    { to: sessionId, sdp }
    //   webrtc:answer   { to: sessionId, sdp }
    //   webrtc:ice      { to: sessionId, candidate }
    //
    // Forwarded as the same event name to the target's socket(s) with
    // `from` populated.
    const relayToPeer = (event: string, to: string, payload: Record<string, unknown>) => {
      // Each sessionId may have multiple sockets (browser tabs). Walk
      // the namespace and forward to any socket whose session matches.
      lanNs.sockets.forEach((s) => {
        if ((s.data as { sessionId?: string }).sessionId === to) {
          s.emit(event, { ...payload, from: sessionId });
        }
      });
    };
    socket.on("webrtc:offer", (d: { to: string; sdp: string }) => {
      if (!d?.to || typeof d.sdp !== "string") return;
      relayToPeer("webrtc:offer", d.to, { sdp: d.sdp });
    });
    socket.on("webrtc:answer", (d: { to: string; sdp: string }) => {
      if (!d?.to || typeof d.sdp !== "string") return;
      relayToPeer("webrtc:answer", d.to, { sdp: d.sdp });
    });
    socket.on("webrtc:ice", (d: { to: string; candidate: unknown }) => {
      if (!d?.to) return;
      relayToPeer("webrtc:ice", d.to, { candidate: d.candidate });
    });

    socket.on("disconnect", () => {
      // Don't delete the session itself — the user may have multiple tabs;
      // just leave the rooms this socket had joined. The bus's reapStale
      // will GC truly idle sessions later.
      Array.from(joinedRooms).forEach((r) => {
        lanChatBus.leaveRoom(sessionId, r);
        lanNs.to(`lan-room:${r}`).emit("lan-chat:presence", {
          roomId: r,
          online: lanChatBus.listOnline(r),
        });
      });
    });
  });

  // tRPC sendMessage handler broadcasts via this wired-up function — avoids
  // routers/lanChat.ts having to import index.ts (cycle).
  registerLanChatBroadcaster((roomId: number, msg: LanChatMessage) => {
    lanNs.to(`lan-room:${roomId}`).emit("lan-chat:message", msg);
  });

  // ── ComfyUI progress relay ────────────────────────────────────────────────
  setComfySocketIO(io);

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

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
