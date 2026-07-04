// 本机 Claude（订阅）桥接：把「自建 OpenAI 兼容 LLM」的 /v1/chat/completions 请求，转成在服务器上
// 跑一次无头 `claude -p`（用 `claude setup-token` 的订阅额度，不按 token 计费），再把结果包成 OpenAI
// chat.completion 返回。于是后台「自建 LLM」填个本机地址，画布里的 AI 对话/规划就能用订阅跑。
//
// 安全：默认完全关闭——仅当服务端设置了 env CLAUDE_LOCAL_BRIDGE_KEY 才启用，且每个请求的
// Authorization: Bearer 必须与该 key 完全一致（防止公网下别人白嫖你的订阅）。纯文本进出：不授予任何
// 工具、不 --add-dir、cwd 为临时目录，比代码任务安全得多。
import type { Express, Request, Response } from "express";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolveClaudeSpawn, resolveClaudeBin } from "./superAgent/claudeProcess";

type OAContent = string | Array<string | { type?: string; text?: string }>;
export interface OAMessage { role?: string; content?: OAContent }

/** OpenAI 消息 content（字符串或分段数组）拍平成纯文本。纯函数。 */
export function contentToText(content: OAContent | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : p && typeof p === "object" ? String(p.text ?? "") : ""))
      .join("");
  }
  return "";
}

/** 一组 OpenAI 消息拼成给 `claude -p` 的单条提示（system 原样置顶，其余按「用户/助手」转写）。纯函数。 */
export function messagesToPrompt(messages: OAMessage[]): string {
  const parts: string[] = [];
  for (const m of messages ?? []) {
    const text = contentToText(m?.content).trim();
    if (!text) continue;
    if (m?.role === "system") parts.push(text);
    else if (m?.role === "assistant") parts.push(`助手：${text}`);
    else parts.push(`用户：${text}`);
  }
  return parts.join("\n\n");
}

/** 解析 `claude -p --output-format json` 的输出，取出回复文本与是否出错。纯函数（容错：整段/末尾 JSON/裸文本）。 */
export function parseClaudeJsonResult(stdout: string): { text: string; isError: boolean } {
  const s = (stdout ?? "").trim();
  if (!s) return { text: "", isError: true };
  const tryParse = (str: string): Record<string, unknown> | null => { try { return JSON.parse(str) as Record<string, unknown>; } catch { return null; } };
  let obj = tryParse(s);
  if (!obj) {
    const i = s.lastIndexOf("{"), j = s.lastIndexOf("}");
    if (i !== -1 && j > i) obj = tryParse(s.slice(i, j + 1));
  }
  if (obj) {
    const result = typeof obj.result === "string" ? obj.result : "";
    const isError = obj.is_error === true || obj.subtype === "error" || (!result && !!obj.error);
    return { text: result || (typeof obj.error === "string" ? obj.error : ""), isError };
  }
  return { text: s, isError: false }; // 非 JSON：把原始输出当回复兜底
}

/** 桥接是否启用（= 是否设了 CLAUDE_LOCAL_BRIDGE_KEY）。 */
export function isClaudeBridgeEnabled(): boolean { return !!process.env.CLAUDE_LOCAL_BRIDGE_KEY?.trim(); }
/** 桥接鉴权 key（后台自建 LLM 的 API Key 需与之一致）。 */
export function claudeBridgeKey(): string { return process.env.CLAUDE_LOCAL_BRIDGE_KEY?.trim() || ""; }

/** 跑一次无头 claude 拿纯文本回复。不传 --model：用订阅默认模型；env 继承 CLAUDE_CODE_OAUTH_TOKEN。 */
export function runClaudeText(opts: { messages: OAMessage[]; timeoutMs: number }): Promise<{ text: string; isError: boolean }> {
  const prompt = messagesToPrompt(opts.messages);
  const { cmd, args, shell } = resolveClaudeSpawn(resolveClaudeBin(), ["-p", "--output-format", "json"]);
  return new Promise((resolve) => {
    let out = "", err = "", done = false, spawnErr: string | null = null;
    const child = spawn(cmd, args, { cwd: tmpdir(), env: process.env, stdio: ["pipe", "pipe", "pipe"], shell });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, opts.timeoutMs);
    child.stdout?.on("data", (d) => { out += String(d); });
    child.stderr?.on("data", (d) => { err += String(d); });
    try { child.stdin?.write(prompt); child.stdin?.end(); } catch { /* stdin 不可用 */ }
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      if (spawnErr) return resolve({ text: `无法启动 claude：${spawnErr}（检查 CLAUDE_BIN、是否已 npm i -g @anthropic-ai/claude-code）`, isError: true });
      const parsed = parseClaudeJsonResult(out);
      if ((!parsed.text || parsed.isError) && err.trim()) return resolve({ text: parsed.text || err.trim().slice(-800), isError: true });
      resolve(parsed);
    };
    child.on("error", (e) => { spawnErr = e instanceof Error ? e.message : String(e); finish(); });
    child.on("close", finish);
  });
}

/** 注册 OpenAI 兼容桥接端点：POST /api/claude-bridge/v1/chat/completions。 */
export function registerClaudeBridge(app: Express): void {
  app.post("/api/claude-bridge/v1/chat/completions", async (req: Request, res: Response) => {
    if (!isClaudeBridgeEnabled()) {
      return res.status(404).json({ error: { message: "本机 Claude 桥接未启用：请在服务端设置环境变量 CLAUDE_LOCAL_BRIDGE_KEY。" } });
    }
    const key = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!key || key !== claudeBridgeKey()) {
      return res.status(401).json({ error: { message: "API Key 不匹配：后台「自建 LLM」的 API Key 需与服务端 CLAUDE_LOCAL_BRIDGE_KEY 完全一致。" } });
    }
    const messages = Array.isArray(req.body?.messages) ? (req.body.messages as OAMessage[]) : [];
    if (!messages.length) return res.status(400).json({ error: { message: "messages 为空" } });
    try {
      const { text, isError } = await runClaudeText({ messages, timeoutMs: 110_000 });
      if (isError) return res.status(502).json({ error: { message: "本机 claude 返回错误：" + (text || "").slice(0, 600) } });
      res.json({
        id: `claude-local-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: (typeof req.body?.model === "string" && req.body.model) || "claude-local",
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    } catch (e) {
      res.status(502).json({ error: { message: "调用本机 claude 失败：" + (e instanceof Error ? e.message : String(e)) } });
    }
  });
}
