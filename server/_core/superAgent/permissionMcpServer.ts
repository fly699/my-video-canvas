// 超级智能体 · Phase 2 —— 执行前拦截用的最小 stdio MCP 服务器（无外部依赖）。
//
// Claude Code 以 --permission-prompt-tool mcp__policy__approve_tool_use 调用本服务器：
// 每次工具执行「前」问一次；本服务器用 decidePermission(commandPolicy) 判定 allow/deny，
// 危险 Bash 在执行前被拦下。手写最小 JSON-RPC（initialize/tools/list/tools/call），
// 可用 canned 请求单测 + 冒烟。
//
// 注意：--permission-prompt-tool 的确切 wire 契约官方未文档化（社区 issue #1175），此处按
// 推断实现；即便 claude 侧未如期调用，codeAgent.ts 的事后 stream 监控仍作兜底（纵深防御）。
import { createInterface } from "node:readline";
import { decidePermission } from "./permissionPolicy";

export const PERMISSION_TOOL_NAME = "approve_tool_use";
const DEFAULT_PROTOCOL = "2025-06-18";

interface RpcRequest { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
interface RpcResponse { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } }

/**
 * 处理一条 JSON-RPC 请求，返回响应对象；通知（无 id 的 method，如 notifications/initialized）返回 null。
 * 纯函数（除 decidePermission 无副作用），便于单测。
 */
export function handleRpc(req: RpcRequest): RpcResponse | null {
  const id = req.id ?? null;
  const method = req.method;

  if (method === "initialize") {
    const clientProto = (req.params?.protocolVersion as string | undefined) ?? DEFAULT_PROTOCOL;
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: clientProto,
        capabilities: { tools: {} },
        serverInfo: { name: "superagent-policy", version: "1.0.0" },
      },
    };
  }

  // 通知（notifications/*）无需响应。
  if (method === "notifications/initialized" || (method?.startsWith("notifications/") && req.id == null)) {
    return null;
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0", id,
      result: {
        tools: [{
          name: PERMISSION_TOOL_NAME,
          description: "在执行某工具前，依据服务端安全策略（commandPolicy）判定 allow/deny。",
          inputSchema: {
            type: "object",
            properties: {
              tool_name: { type: "string", description: "待执行的工具名（如 Bash）" },
              tool_input: { type: "object", description: "该工具的入参（Bash 含 command）" },
            },
            required: ["tool_name"],
          },
        }],
      },
    };
  }

  if (method === "tools/call") {
    const name = req.params?.name as string | undefined;
    if (name !== PERMISSION_TOOL_NAME) {
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `未知工具：${name}` } };
    }
    const args = (req.params?.arguments ?? {}) as { tool_name?: string; tool_input?: Record<string, unknown> };
    const decision = decidePermission(args.tool_name ?? "", args.tool_input ?? {});
    // permission-prompt-tool 约定：以「文本内容里的 JSON 字符串」回传 {behavior, updatedInput?, message?}。
    return {
      jsonrpc: "2.0", id,
      result: { content: [{ type: "text", text: JSON.stringify(decision) }] },
    };
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `未实现的方法：${method}` } };
}

/** 作为独立进程运行：逐行读 stdin 的 JSON-RPC，逐行写 stdout 响应。 */
export function runPermissionMcpServer(): void {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const t = line.trim();
    if (!t) return;
    let req: RpcRequest;
    try { req = JSON.parse(t) as RpcRequest; } catch { return; }
    const res = handleRpc(req);
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  });
}

// 直接以脚本方式启动时运行服务器（claude 通过 --mcp-config 的 command/args 拉起本文件）。
if (process.argv[1] && /permissionMcpServer\.(ts|js|mjs|cjs)$/.test(process.argv[1])) {
  runPermissionMcpServer();
}
