import { io, type Socket } from "socket.io-client";
import { getBaseUrlSync } from "./config";
import { getToken } from "./auth";

// 账号聊天命名空间 /chat。原生端无 Cookie，用 handshake.auth.token 传会话令牌（M0 服务端已支持）。
// path 与 Web 端一致：/api/socket。
export function connectChatSocket(): Socket {
  const base = getBaseUrlSync();
  return io(`${base}/chat`, {
    path: "/api/socket",
    transports: ["websocket"],
    auth: { token: getToken() || "" },
    autoConnect: true,
  });
}
