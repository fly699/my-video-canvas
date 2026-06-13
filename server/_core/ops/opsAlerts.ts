import type { Server as SocketIOServer } from "socket.io";
import { listOpsServers } from "../../db";
import { fetchComfyServerStatus } from "../comfyui";
import { ADMIN_ROOM } from "../downloadNotify";

// ComfyUI ops alerting: periodically sample every registered server's ComfyUI
// status and raise alerts (offline / low VRAM / queue backlog). Current alerts
// are held in memory and pushed to the admin socket room on change; the frontend
// also reads a snapshot via tRPC. Mirrors the videoTaskPoller "setInterval +
// socket emit to ADMIN_ROOM" shape. No-ops when no DB / no servers (dev bypass).

export interface OpsAlert {
  serverId: number;
  name: string;
  level: "error" | "warn";
  kind: "offline" | "low_vram" | "queue_backlog";
  message: string;
}

const SAMPLE_INTERVAL_MS = 30_000;
const LOW_VRAM_MB = 1024;       // < 1GB free while online
const QUEUE_BACKLOG = 20;       // pending jobs piling up

let _io: SocketIOServer | null = null;
let current: OpsAlert[] = [];
let timer: NodeJS.Timeout | null = null;

export function getCurrentOpsAlerts(): OpsAlert[] { return current; }

async function sample(): Promise<void> {
  const servers = (await listOpsServers().catch(() => [])).filter((s) => s.enabled && s.comfyBaseUrl);
  if (servers.length === 0) { setAlerts([]); return; }
  const next: OpsAlert[] = [];
  await Promise.all(servers.map(async (s) => {
    const st = await fetchComfyServerStatus(s.comfyBaseUrl!).catch(() => null);
    if (!st || !st.online) {
      next.push({ serverId: s.id, name: s.name, level: "error", kind: "offline", message: `${s.name} ComfyUI 离线/不可达` });
      return;
    }
    if (st.vramFreeMB != null && st.vramFreeMB < LOW_VRAM_MB) {
      next.push({ serverId: s.id, name: s.name, level: "warn", kind: "low_vram", message: `${s.name} 显存告急：剩余 ${Math.round(st.vramFreeMB)}MB` });
    }
    if ((st.queuePending ?? 0) >= QUEUE_BACKLOG) {
      next.push({ serverId: s.id, name: s.name, level: "warn", kind: "queue_backlog", message: `${s.name} 队列堆积：等待 ${st.queuePending}` });
    }
  }));
  setAlerts(next);
}

function setAlerts(next: OpsAlert[]): void {
  const key = (a: OpsAlert[]) => a.map((x) => `${x.serverId}:${x.kind}`).sort().join("|");
  if (key(next) === key(current)) { current = next; return; } // same set → update silently
  current = next;
  try { _io?.to(ADMIN_ROOM).emit("ops:alerts", next); } catch { /* best-effort */ }
}

export function setupOpsAlerts(io: SocketIOServer): void {
  _io = io;
  if (timer) return;
  // First sample shortly after boot, then on an interval.
  setTimeout(() => void sample().catch(() => {}), 8_000);
  timer = setInterval(() => void sample().catch(() => {}), SAMPLE_INTERVAL_MS);
  timer.unref?.();
}
