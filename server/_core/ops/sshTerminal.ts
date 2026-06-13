import type { Server as SocketIOServer, Socket } from "socket.io";
import { randomUUID } from "crypto";
import type { ClientChannel } from "ssh2";
import { getConnectedClient } from "./sshPool";

// Interactive SSH terminal bridge: an ssh2 shell channel <-> socket.io, wired in
// server/_core/index.ts. Each session is bound to the socket that opened it, so
// even a leaked sessionId cannot inject into another admin's shell. Admin-only
// (enforced at the socket event handlers in index.ts).

interface TermSession {
  serverId: number;
  ownerUserId: number;
  socketId: string;
  channel: ClientChannel;
}

const SESSIONS = new Map<string, TermSession>();

let _io: SocketIOServer | null = null;
export function setOpsTerminalSocketIO(io: SocketIOServer): void { _io = io; }

export function opsTermRoom(sessionId: string): string { return `ops:term:${sessionId}`; }

/** Open a new shell session for `socket` against `serverId`. Returns sessionId. */
export async function openTerminalSession(
  socket: Socket,
  userId: number,
  serverId: number,
  size: { cols: number; rows: number },
): Promise<string> {
  const client = await getConnectedClient(serverId);
  const sessionId = randomUUID();
  return new Promise<string>((resolve, reject) => {
    client.shell({ cols: size.cols || 80, rows: size.rows || 24, term: "xterm-256color" }, (err, channel) => {
      if (err) { reject(err); return; }
      const session: TermSession = { serverId, ownerUserId: userId, socketId: socket.id, channel };
      SESSIONS.set(sessionId, session);
      socket.join(opsTermRoom(sessionId));
      const emit = (chunk: Buffer) => {
        _io?.to(opsTermRoom(sessionId)).emit("ops:term:data", { sessionId, chunk: chunk.toString("utf8") });
      };
      channel.on("data", emit);
      channel.stderr.on("data", emit);
      channel.on("close", () => {
        _io?.to(opsTermRoom(sessionId)).emit("ops:term:exit", { sessionId });
        SESSIONS.delete(sessionId);
      });
      resolve(sessionId);
    });
  });
}

/** Write user keystrokes to a session, only if `socket` owns it. */
export function writeToSession(socketId: string, sessionId: string, data: string): boolean {
  const s = SESSIONS.get(sessionId);
  if (!s || s.socketId !== socketId) return false;
  try { s.channel.write(data); return true; } catch { return false; }
}

export function resizeSession(socketId: string, sessionId: string, cols: number, rows: number): void {
  const s = SESSIONS.get(sessionId);
  if (!s || s.socketId !== socketId) return;
  try { s.channel.setWindow(rows, cols, 0, 0); } catch { /* ignore */ }
}

export function closeSession(socketId: string, sessionId: string): void {
  const s = SESSIONS.get(sessionId);
  if (!s || s.socketId !== socketId) return;
  try { s.channel.close(); } catch { /* ignore */ }
  SESSIONS.delete(sessionId);
}

/** Close all sessions owned by a disconnected socket. */
export function closeSessionsForSocket(socketId: string): void {
  for (const [id, s] of Array.from(SESSIONS.entries())) {
    if (s.socketId === socketId) {
      try { s.channel.close(); } catch { /* ignore */ }
      SESSIONS.delete(id);
    }
  }
}
