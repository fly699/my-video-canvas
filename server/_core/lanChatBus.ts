import { randomBytes } from "crypto";

// Palette intentionally distinct from the canvas collaboration colors so a
// LAN chat nickname doesn't accidentally appear identical to a canvas
// collaborator cursor. Hand-picked oklch values for visibility on both light
// and dark themes.
const NICKNAME_COLORS = [
  "#ef4444", "#f59e0b", "#eab308", "#84cc16", "#10b981",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#d946ef", "#ec4899",
] as const;

export interface LanSession {
  id: string;
  nickname: string;
  color: string;
  clientIp: string;
  /** Outbound NAT gateway IP — used to group users behind the same router
   *  into a shared "LAN" namespace. For this server clientIp IS the
   *  networkGroupId (server's view of the user is always the gateway). */
  networkGroupId: string;
  lastSeen: number;
}

interface JoinResult {
  sessionId: string;
  nickname: string;
  color: string;
  networkGroupId: string;
}

class LanChatBus {
  /** Active sessions keyed by sessionId. */
  private sessions = new Map<string, LanSession>();
  /** roomId → Set<sessionId> of who has the room open. */
  private presence = new Map<number, Set<string>>();
  /** Reverse index sessionId → Set<roomId> so disconnect can cleanly
   *  broadcast leave to every room the session was in. */
  private sessionRooms = new Map<string, Set<number>>();

  /** Pick a stable color for a nickname so re-joins keep the same chip color
   *  (same nickname on different days still looks consistent). Hash the
   *  lowercase nickname into the palette. */
  private pickColor(nickname: string): string {
    let h = 0;
    for (const ch of nickname.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return NICKNAME_COLORS[h % NICKNAME_COLORS.length];
  }

  /** Create or reuse a session. Same (nickname, clientIp) returns the
   *  existing session — refreshing or opening another tab on the same
   *  machine doesn't create a duplicate "Alice" in the online list. */
  joinSession(nickname: string, clientIp: string): JoinResult {
    const trimmed = nickname.trim();
    if (!trimmed) throw new Error("nickname required");
    const existing = Array.from(this.sessions.values()).find(
      (s) => s.nickname === trimmed && s.clientIp === clientIp,
    );
    if (existing) {
      existing.lastSeen = Date.now();
      return {
        sessionId: existing.id,
        nickname: existing.nickname,
        color: existing.color,
        networkGroupId: existing.networkGroupId,
      };
    }
    const sessionId = randomBytes(16).toString("base64url");
    const color = this.pickColor(trimmed);
    this.sessions.set(sessionId, {
      id: sessionId,
      nickname: trimmed,
      color,
      clientIp,
      networkGroupId: clientIp,
      lastSeen: Date.now(),
    });
    return { sessionId, nickname: trimmed, color, networkGroupId: clientIp };
  }

  getSession(sessionId: string): LanSession | undefined {
    const s = this.sessions.get(sessionId);
    if (s) s.lastSeen = Date.now();
    return s;
  }

  /** Track that a session has entered a room (for presence broadcasting). */
  enterRoom(sessionId: string, roomId: number): void {
    if (!this.sessions.has(sessionId)) return;
    let set = this.presence.get(roomId);
    if (!set) { set = new Set(); this.presence.set(roomId, set); }
    set.add(sessionId);
    let rooms = this.sessionRooms.get(sessionId);
    if (!rooms) { rooms = new Set(); this.sessionRooms.set(sessionId, rooms); }
    rooms.add(roomId);
  }

  leaveRoom(sessionId: string, roomId: number): void {
    this.presence.get(roomId)?.delete(sessionId);
    this.sessionRooms.get(sessionId)?.delete(roomId);
  }

  /** Returns rooms the session was in (so socket cleanup can broadcast
   *  presence changes to each). */
  removeSession(sessionId: string): number[] {
    const rooms = Array.from(this.sessionRooms.get(sessionId) ?? []);
    for (const r of rooms) this.presence.get(r)?.delete(sessionId);
    this.sessionRooms.delete(sessionId);
    this.sessions.delete(sessionId);
    return rooms;
  }

  listOnline(roomId: number): Array<{ sessionId: string; nickname: string; color: string }> {
    const ids = this.presence.get(roomId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.sessions.get(id))
      .filter((s): s is LanSession => !!s)
      .map((s) => ({ sessionId: s.id, nickname: s.nickname, color: s.color }));
  }

  /** Drop sessions idle > 10 min — usually they've closed the tab without
   *  emitting a clean disconnect. Returns rooms that lost members so the
   *  caller can rebroadcast presence. */
  reapStale(): Array<{ roomId: number; sessionId: string }> {
    const cutoff = Date.now() - 10 * 60 * 1000;
    const dropped: Array<{ roomId: number; sessionId: string }> = [];
    const stale = Array.from(this.sessions.entries()).filter(([, s]) => s.lastSeen < cutoff);
    stale.forEach(([id]) => {
      const rooms = this.removeSession(id);
      rooms.forEach((r) => dropped.push({ roomId: r, sessionId: id }));
    });
    return dropped;
  }
}

export const lanChatBus = new LanChatBus();

// Reap every 5 minutes. Long-lived process state; we don't bother clearing
// the interval — the process owns it for its full lifetime.
setInterval(() => { lanChatBus.reapStale(); }, 5 * 60 * 1000).unref();
