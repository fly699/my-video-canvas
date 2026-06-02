import type { Server as SocketIOServer } from "socket.io";

// Socket.IO instance is injected from index.ts (same pattern as comfyStress /
// comfyui). Admins join the "admins" room on connect; new download requests are
// pushed there so online admins get an in-app popup to authorize on the spot.
let _io: SocketIOServer | null = null;
export const ADMIN_ROOM = "admins";
export function setDownloadSocketIO(io: SocketIOServer): void { _io = io; }

export interface DownloadRequestNotice {
  grantId: number;
  userId: number;
  requesterName: string | null;
  fileName: string | null;
  fileType: string | null;
  projectName: string | null;
  reason: string | null;
  createdAt: number;
}

export function notifyAdminsOfDownloadRequest(notice: DownloadRequestNotice): void {
  if (!_io) return;
  try { _io.to(ADMIN_ROOM).emit("download:request", notice); } catch { /* best-effort */ }
}
