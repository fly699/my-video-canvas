import type { Server as SocketIOServer } from "socket.io";

// 画布助手共享对话的变更广播：saveHistory 落库后通知同项目房间的其他协作者
// 「从服务器权威重载」（只发信号不携带数据——血泪教训：UI 刷新不能单押 socket 载荷）。
let _io: SocketIOServer | null = null;
export function setAgentSocketIO(io: SocketIOServer): void { _io = io; }

export function broadcastAgentHistoryUpdated(projectId: number, byUserId: number): void {
  try {
    _io?.to(`project:${projectId}`).emit("agent:history-updated", { projectId, byUserId });
  } catch { /* best-effort */ }
}
