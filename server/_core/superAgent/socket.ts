// 超级智能体 —— 活动日志的 socket 流式（复用 comfyui.ts 的 project 房间范式）。
// Phase 1（ComfyUI 工具环）与 Phase 2（代码任务）共用此通道。
import type { Server as SocketIOServer } from "socket.io";

let _io: SocketIOServer | null = null;

/** Phase 1/2 事件的最小共同形状（AgentEvent 与 CodeRunEvent 都满足）。 */
export interface SuperAgentEmitEvent {
  type: string;
  iteration?: number;
  message: string;
  data?: unknown;
}

/** 由 index.ts 在建好 io 后注入（与 setComfySocketIO 同范式）。 */
export function setSuperAgentSocketIO(io: SocketIOServer): void {
  _io = io;
}

/** 把一条智能体事件推给项目房间的订阅者（画布节点据此实时滚动活动日志）。 */
export function emitSuperAgentEvent(projectId: number, nodeId: string | undefined, event: SuperAgentEmitEvent): void {
  _io?.to(`project:${projectId}`).emit("superagent:event", { nodeId: nodeId ?? null, event: { iteration: 0, ...event } });
}
