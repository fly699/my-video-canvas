// 超级智能体 · Phase 1 —— 活动日志的 socket 流式（复用 comfyui.ts 的 project 房间范式）。
import type { Server as SocketIOServer } from "socket.io";
import type { AgentEvent } from "./comfyAgent";

let _io: SocketIOServer | null = null;

/** 由 index.ts 在建好 io 后注入（与 setComfySocketIO 同范式）。 */
export function setSuperAgentSocketIO(io: SocketIOServer): void {
  _io = io;
}

/** 把一条智能体事件推给项目房间的订阅者（画布节点据此实时滚动活动日志）。 */
export function emitSuperAgentEvent(projectId: number, nodeId: string | undefined, event: AgentEvent): void {
  _io?.to(`project:${projectId}`).emit("superagent:event", { nodeId: nodeId ?? null, event });
}
