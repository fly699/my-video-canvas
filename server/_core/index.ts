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

  // Track users per project room
  const projectUsers = new Map<number, Map<number, { userName: string; color: string }>>();

  io.on("connection", (socket) => {
    let currentProjectId: number | null = null;
    let currentUserId: number | null = null;

    socket.on("join-project", (data: { projectId: number; userId: number; userName: string; color: string }) => {
      currentProjectId = data.projectId;
      currentUserId = data.userId;
      const room = `project:${data.projectId}`;
      socket.join(room);

      if (!projectUsers.has(data.projectId)) {
        projectUsers.set(data.projectId, new Map());
      }
      projectUsers.get(data.projectId)!.set(data.userId, {
        userName: data.userName,
        color: data.color,
      });

      // Notify others
      socket.to(room).emit("collaboration-event", {
        type: "user:join",
        userId: data.userId,
        userName: data.userName,
        color: data.color,
        projectId: data.projectId,
        payload: {},
      });
    });

    socket.on("leave-project", (data: { projectId: number; userId: number }) => {
      const room = `project:${data.projectId}`;
      socket.leave(room);
      projectUsers.get(data.projectId)?.delete(data.userId);

      socket.to(room).emit("collaboration-event", {
        type: "user:leave",
        userId: data.userId,
        userName: "",
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
      const room = `project:${event.projectId}`;
      socket.to(room).emit("collaboration-event", event);
    });

    socket.on("disconnect", () => {
      if (currentProjectId !== null && currentUserId !== null) {
        const room = `project:${currentProjectId}`;
        projectUsers.get(currentProjectId)?.delete(currentUserId);
        socket.to(room).emit("collaboration-event", {
          type: "user:leave",
          userId: currentUserId,
          userName: "",
          color: "",
          projectId: currentProjectId,
          payload: {},
        });
      }
    });
  });

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
