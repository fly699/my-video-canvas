// 本机 Claude（订阅）桥接：把「自建 OpenAI 兼容 LLM」的 /v1/chat/completions 请求，转成在服务器上
// 跑一次无头 `claude -p`（用 `claude setup-token` 的订阅额度，不按 token 计费），再把结果包成 OpenAI
// chat.completion 返回。于是后台「自建 LLM」填个本机地址，画布里的 AI 对话/规划就能用订阅跑。
//
// 安全：默认完全关闭——仅当服务端设置了 env CLAUDE_LOCAL_BRIDGE_KEY 才启用，且每个请求的
// Authorization: Bearer 必须与该 key 完全一致（防止公网下别人白嫖你的订阅）。纯文本进出：不授予任何
// 工具、不 --add-dir、cwd 为临时目录，比代码任务安全得多。
import type { Express, Request, Response } from "express";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveClaudeSpawn, resolveClaudeBin } from "./superAgent/claudeProcess";
import { isGptLocalModel, codexModelArg, runCodexText } from "./codexBridge";
import { isGrokLocalModel, grokModelArg, runGrokText } from "./grokBridge";
import { collectImageUrls, collectFileUrls, resolveImages, docTextFromFileUrls, buildClaudeStreamJsonInput, parseClaudeStreamJsonResult } from "./bridgeAttachments";
import { getBridgeMcpConfig } from "./bridgeMcp";
import { storagePut } from "../storage";
import {
  createCallWorkspace, cleanupCallWorkspace, sweepStaleWorkspaces,
  mergeWorkspaceMcp, workspacePromptHint, collectWorkspaceFiles, safeStorageName, formatFilesReply,
} from "./bridgeWorkspace";

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

/** 桥接专属模型 id：claude-local*（Claude 订阅）/ gpt-local*（ChatGPT 订阅）。这些 id 是桥接
 *  保留串，不该与通用「自建 LLM」的模型列表耦合——路由/鉴权应直接指向本机桥接。 */
export function isClaudeLocalModel(model?: unknown): boolean {
  return typeof model === "string" && model.trim().toLowerCase().startsWith("claude-local");
}
export function isBridgeModel(model?: unknown): boolean {
  return isClaudeLocalModel(model) || isGptLocalModel(model) || isGrokLocalModel(model);
}

/** 桥接子进程（claude -p / codex exec）生成超时（毫秒）。默认 280s，可用 CLAUDE_BRIDGE_TIMEOUT_MS
 *  覆盖（下限 30s）。大计划（画布助手加角色+模板）生成慢，110s 不够会被 SIGKILL。 */
export function bridgeTimeoutMs(): number {
  const n = Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 30_000 ? n : 280_000;
}
/** 桥接鉴权 key（后台自建 LLM 的 API Key 需与之一致）。 */
export function claudeBridgeKey(): string { return process.env.CLAUDE_LOCAL_BRIDGE_KEY?.trim() || ""; }

// ── 桥接自调用回环重写 ─────────────────────────────────────────────────────────
// 后台「一键填入」用的是管理员浏览器地址栏的 origin；公网隧道部署时那是公网域名——服务器调
// 自己的桥接却绕出公网再回来：撞 Cloudflare 100s 超时/502、TLS/网关各种失败（真实翻车：CF 502
// HTML 整页糊进聊天）。桥接本来就在本进程里，凡地址含 /api/claude-bridge 一律强制改走本机回环。
let _selfHttpPort: number | null = null;
/** index.ts 启动后登记本机可用的【纯 HTTP】回环端口（隧道回环端口优先；主端口为 http 时也可）。 */
export function setBridgeSelfHttpPort(port: number): void { _selfHttpPort = port; }
/** 后台「一键填入」应显示的推荐地址：直接给本机回环端口（公网隧道下填公网域名虽也能通——
 *  服务端会强制重写——但界面显示公网地址让人误以为要绕公网）。端口未登记时返回 null，前端兜底页面 origin。 */
export function bridgeLocalUrl(): string | null {
  return _selfHttpPort == null ? null : `http://127.0.0.1:${_selfHttpPort}/api/claude-bridge`;
}
/** 自建 LLM 地址指向本应用桥接路径时 → 重写为 http://127.0.0.1:端口/...（未登记端口则原样返回）。纯函数式。 */
export function rewriteBridgeSelfUrl(url: string): string {
  if (!url || !/\/api\/claude-bridge/i.test(url)) return url;
  if (_selfHttpPort == null) return url;
  return `http://127.0.0.1:${_selfHttpPort}/api/claude-bridge/v1/chat/completions`;
}

/** 从请求的 model 串解析要传给 `claude --model` 的值。约定：
 *  - "claude-local"（或空）→ null：不传 --model，用订阅默认模型；
 *  - "claude-local:sonnet" / "claude-local:opus" 等 → 取冒号后缀；
 *  - 其它值原样透传（可直接登记 "sonnet"/"opus"/"haiku" 或完整模型 id）。
 *  严格白名单字符（字母数字 . _ - [ ]），防止拼进命令行的注入/乱串。纯函数。 */
export function bridgeModelArg(model: unknown): string | null {
  if (typeof model !== "string") return null;
  let m = model.trim();
  if (m.toLowerCase().startsWith("claude-local")) m = m.slice("claude-local".length).replace(/^:/, "");
  if (!m) return null;
  if (m.length > 64 || !/^[A-Za-z0-9._[\]-]+$/.test(m)) return null; // 非法串宁可回退默认模型
  return m;
}

// ── 桥接「技能 / MCP」增强（默认关闭，纯文本安全不变）───────────────────────────
// 桥接本是纯文本问答。设了下面任一 env 才进入「带工具」模式，让订阅 Claude 能调技能 / MCP：
//   - CLAUDE_BRIDGE_SKILLS=1          → 放行 Skill 工具（技能放服务器 ~/.claude/skills，无头会自动发现）
//   - CLAUDE_BRIDGE_MCP_CONFIG=<...>  → 挂载 MCP（文件路径或内联 JSON）+ 放行其 mcp__<服务名> 工具
// 一并放行只读工具（Read/Glob/Grep/WebSearch/WebFetch）供技能/MCP 流程使用；**不含 Bash/Write/Edit**
// （桥接不写文件、不跑 shell）。权限模式默认 default：仅放行的工具可用，其余无头下一律拒。
// 可用 CLAUDE_BRIDGE_ALLOWED_TOOLS / CLAUDE_BRIDGE_PERMISSION_MODE 覆盖默认。
// ⚠️ 安全：这会让「可能公网可达、只有一把 bridge key」的聊天口获得工具/MCP 能力；MCP 服务器由管理员
// 自选、其工具被预授权（不再逐次审批）。仅在内网/受信任部署开启，别接高危 MCP（可写文件系统/跑命令）。

/** 从 MCP 配置（内联 JSON 或读入的文本）取服务器名列表。纯函数（解析失败→[]）。 */
export function mcpServerNames(configText: string): string[] {
  try {
    const o = JSON.parse(configText) as { mcpServers?: Record<string, unknown> };
    return o?.mcpServers && typeof o.mcpServers === "object" ? Object.keys(o.mcpServers) : [];
  } catch { return []; }
}

/** 构建桥接增强参数。纯函数（所有输入显式传入，便于单测）。
 *  mcpConfigArg：传给 --mcp-config 的值（文件路径，内联已 materialize）；null=不挂 MCP。 */
export function buildBridgeAgenticArgs(opts: {
  mcpConfigArg: string | null; serverNames: string[]; skills: boolean;
  allowedOverride?: string; permissionMode?: string;
  /** 是否加 --strict-mcp-config（只认本配置、忽略 claude 自带 ~/.claude/mcp.json）。默认 true。
   *  OAuth 型 MCP（如 Higgsfield，靠 `claude mcp add` 存凭证在 claude 配置里）需设 false 才能合并进来。 */
  strict?: boolean;
}): string[] {
  if (!opts.mcpConfigArg && !opts.skills) return []; // 纯文本模式：零增强
  const tools = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch"]);
  if (opts.skills) tools.add("Skill");
  for (const n of opts.serverNames) tools.add(`mcp__${n}`);
  // 安全护栏：桥接口可能公网可达、只有一把 CLAUDE_LOCAL_BRIDGE_KEY，绝不能通过 allowedTools 覆盖
  // 放行写文件/跑 shell 的工具（否则 key 泄露=RCE）。无条件从覆盖里剔除高危工具；permissionMode
  // 收成白名单，禁 bypassPermissions（它会绕过一切工具审批）。
  const DANGEROUS = new Set(["bash", "write", "edit", "multiedit", "notebookedit"]);
  const allowed = opts.allowedOverride?.trim()
    ? opts.allowedOverride.split(",").map((s) => s.trim()).filter((s) => s && !DANGEROUS.has(s.toLowerCase())).join(",")
    : "";
  const args: string[] = [];
  if (opts.mcpConfigArg) { args.push("--mcp-config", opts.mcpConfigArg); if (opts.strict !== false) args.push("--strict-mcp-config"); }
  args.push("--allowedTools", allowed || Array.from(tools).join(","));
  const pm = (opts.permissionMode?.trim() || "default").toLowerCase();
  args.push("--permission-mode", pm === "plan" ? "plan" : "default"); // 仅 default/plan；bypassPermissions/acceptEdits 等一律降为 default
  return args;
}

/** 读配置（DB 快照优先、env 兜底）→ 桥接增强参数（内联 MCP JSON 落临时文件；文件路径读出取服务器名）。空数组=纯文本。 */
export function resolveBridgeAgenticArgs(workspaceDir?: string | null): string[] {
  const cfg = getBridgeMcpConfig(); // 管理后台 DB 配置（同步快照，30s TTL 后台刷新）；无则回退 CLAUDE_BRIDGE_* env
  const rawMcp = cfg.mcpConfig.trim();
  const skills = cfg.skills;
  if (!rawMcp && !skills && !workspaceDir) return [];
  let mcpConfigArg: string | null = null;
  let serverNames: string[] = [];
  if (workspaceDir) {
    // #88 临时工作区：把范围锁死到本次调用子目录的 filesystem MCP 合并进管理员配置。
    // 管理员配置若是文件路径，先读出文本再合并（读失败 → 仅工作区服务器）。
    // 合并结果落【每调用唯一】的临时文件（<wsDir>.mcp.json，工作区目录的兄弟文件——
    // 不能放进工作区内，否则会被当成生成文件收集/可被模型改写）。
    let adminInline = rawMcp;
    if (rawMcp && !rawMcp.startsWith("{")) {
      try { adminInline = readFileSync(rawMcp, "utf8"); } catch { adminInline = ""; }
    }
    const merged = mergeWorkspaceMcp(adminInline, workspaceDir);
    serverNames = merged.serverNames;
    try { const pth = workspaceDir + ".mcp.json"; writeFileSync(pth, merged.json); mcpConfigArg = pth; }
    catch { mcpConfigArg = merged.json; }
  } else if (rawMcp) {
    if (rawMcp.startsWith("{")) {
      // 内联 JSON → 落临时文件（部分 claude 版本 --mcp-config 只认路径）
      serverNames = mcpServerNames(rawMcp);
      try { const p = join(tmpdir(), `bridge-mcp-${process.pid}.json`); writeFileSync(p, rawMcp); mcpConfigArg = p; }
      catch { mcpConfigArg = rawMcp; }
    } else {
      mcpConfigArg = rawMcp; // 文件路径
      try { serverNames = mcpServerNames(readFileSync(rawMcp, "utf8")); } catch { serverNames = []; }
    }
  }
  return buildBridgeAgenticArgs({
    mcpConfigArg, serverNames, skills,
    allowedOverride: cfg.allowedTools,
    permissionMode: cfg.permissionMode,
    strict: cfg.strict,
  });
}

/** 起一次 claude 子进程、把 stdin 写进去、收集 stdout/stderr，用 parse 解析结果。内部复用。 */
function spawnClaudeCollect(
  extraArgs: string[], stdin: string, timeoutMs: number,
  parse: (out: string, err: string) => { text: string; isError: boolean },
): Promise<{ text: string; isError: boolean }> {
  const { cmd, args, shell } = resolveClaudeSpawn(resolveClaudeBin(), extraArgs);
  return new Promise((resolve) => {
    let out = "", err = "", done = false, spawnErr: string | null = null, killed = false;
    // detached（仅 POSIX）让子进程成为进程组组长——超时时可整组 SIGKILL，连带 claude 起的
    // 技能/MCP 孙进程；否则只杀直接子进程、孙进程仍持有 stdio 管道致 'close' 不触发、Promise 卡死。
    const child = spawn(cmd, args, { cwd: tmpdir(), env: process.env, stdio: ["pipe", "pipe", "pipe"], shell, detached: process.platform !== "win32" });
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer); if (fallbackTimer) clearTimeout(fallbackTimer);
      if (spawnErr) return resolve({ text: `无法启动 claude：${spawnErr}（检查 CLAUDE_BIN、是否已 npm i -g @anthropic-ai/claude-code）`, isError: true });
      // 超时被中止 → 明确报错（不再把半截 stdout 当正常回复，掩盖真超时）。
      if (killed) return resolve({ text: `本机模型生成超时被中止（>${Math.round(timeoutMs / 1000)}s）。复杂请求（画布助手加角色+模板）较慢，可调高 CLAUDE_BRIDGE_TIMEOUT_MS 或减少一次性规划的镜头/角色数量。` + (err ? `\n${err.slice(0, 300)}` : ""), isError: true });
      resolve(parse(out, err));
    };
    const killTree = () => {
      try {
        if (process.platform === "win32") { spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]); }
        else if (child.pid) { process.kill(-child.pid, "SIGKILL"); }
      } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
    };
    const timer = setTimeout(() => {
      killed = true; killTree();
      // 兜底：整组 kill 后若 'close' 仍未触发（孙进程管道未释放），5s 后强制收敛 Promise，
      // 不再让上层 fetch 一直挂到自建 300s abort（这才是「桥接超时形同虚设」的根因）。
      fallbackTimer = setTimeout(finish, 5000);
    }, timeoutMs);
    child.stdout?.on("data", (d) => { out += String(d); });
    child.stderr?.on("data", (d) => { err += String(d); });
    try { child.stdin?.write(stdin); child.stdin?.end(); } catch { /* stdin 不可用 */ }
    child.on("error", (e) => { spawnErr = e instanceof Error ? e.message : String(e); finish(); });
    child.on("close", finish);
  });
}

/** 跑一次无头 claude 拿回复。model 为 null 时不传 --model（订阅默认）；env 继承 CLAUDE_CODE_OAUTH_TOKEN。
 *  纯文本走 `--output-format json`（快）；检测到图片附件时改走 `--input-format stream-json`
 *  内联 base64 图片块（真机实测可用，无需给工具、不落磁盘）；文档一律解析成文本追加进提示词。 */
export async function runClaudeText(opts: { messages: OAMessage[]; timeoutMs: number; model?: string | null; workspaceDir?: string | null }): Promise<{ text: string; isError: boolean }> {
  let prompt = messagesToPrompt(opts.messages);
  const docText = await docTextFromFileUrls(collectFileUrls(opts.messages));
  if (docText) prompt = [prompt, docText].filter(Boolean).join("\n\n");
  // #88 工作区提示：告诉模型唯一可写位置与交付方式（系统会自动回传链接）。
  if (opts.workspaceDir) prompt = [prompt, workspacePromptHint(opts.workspaceDir)].filter(Boolean).join("\n\n");
  const images = await resolveImages(collectImageUrls(opts.messages));
  const modelArgs = opts.model ? ["--model", opts.model] : [];
  // 技能/MCP 增强（默认空数组 = 纯文本，行为不变）。两条路径都带上。
  const agentic = resolveBridgeAgenticArgs(opts.workspaceDir);

  if (images.length) {
    // 图片路径：stream-json 输入必须配 stream-json 输出（CLI 强制），末尾 result 行取答案。
    const input = buildClaudeStreamJsonInput(prompt, images);
    const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", ...modelArgs, ...agentic];
    const r = await spawnClaudeCollect(args, input, opts.timeoutMs, (out, err) => {
      const parsed = parseClaudeStreamJsonResult(out);
      if ((!parsed.text || parsed.isError) && err.trim()) return { text: parsed.text || err.trim().slice(-800), isError: true };
      return parsed;
    });
    return r;
  }

  // 纯文本（或仅文档）路径：沿用原来的单条 JSON 输出，快且稳。
  return spawnClaudeCollect(["-p", "--output-format", "json", ...modelArgs, ...agentic], prompt, opts.timeoutMs, (out, err) => {
    const parsed = parseClaudeJsonResult(out);
    if ((!parsed.text || parsed.isError) && err.trim()) return { text: parsed.text || err.trim().slice(-800), isError: true };
    return parsed;
  });
}

// #88 启动清扫：进程首次用到工作区时清一次上回异常退出的残留（正常路径即焚，这里只兜异常）。
let _swept = false;
function sweepWorkspacesOnce(): void {
  if (_swept) return;
  _swept = true;
  try { const n = sweepStaleWorkspaces(); if (n) console.log(`[BridgeWorkspace] 启动清扫移除 ${n} 个残留目录`); } catch { /* 忽略 */ }
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
      // 同一端点、同一 Key，按模型前缀分流："gpt-local*" → OpenAI Codex CLI（ChatGPT 订阅）；
      // 其余（claude-local* 等）→ Claude Code CLI（Claude 订阅）。后台自建 LLM 只有一个地址位，
      // 两家共用可零新增配置。
      const gpt = isGptLocalModel(req.body?.model);
      const grok = isGrokLocalModel(req.body?.model);
      // 子进程生成超时：默认 280s（原 110s 对「画布助手加角色+模板」这类大计划不够，claude -p
      // 会被 SIGKILL、外层 fetch 随后 abort → 用户见「aborted due to timeout」）。可用
      // CLAUDE_BRIDGE_TIMEOUT_MS 覆盖；须 < llm.ts 自建 fetch 超时（默认 300s），让桥接干净报错先出。
      const bridgeMs = bridgeTimeoutMs();
      // #88 临时工作区（仅 Claude 分支；管理后台开关，默认关）：为本次调用建独立子目录，
      // 经 filesystem MCP 授予【仅此目录】的写权限；结束后收集→上传→链接附回→即焚。
      let wsDir: string | null = null;
      if (!grok && !gpt && getBridgeMcpConfig().workspace === true) {
        sweepWorkspacesOnce();
        try { wsDir = createCallWorkspace(); } catch { wsDir = null; /* 建目录失败 → 本次退化为纯文本 */ }
      }
      let text = "", isError = false;
      try {
        const r = grok
          ? await runGrokText({ messages, timeoutMs: bridgeMs, model: grokModelArg(req.body?.model) })
          : gpt
          ? await runCodexText({ messages, timeoutMs: bridgeMs, model: codexModelArg(req.body?.model) })
          : await runClaudeText({ messages, timeoutMs: bridgeMs, model: bridgeModelArg(req.body?.model), workspaceDir: wsDir });
        text = r.text; isError = r.isError;
        if (wsDir && !isError) {
          // 收集生成文件：白名单/限额/防软链都在 collectWorkspaceFiles 内强制。
          const col = collectWorkspaceFiles(wsDir);
          if (col.files.length || col.skipped.length) {
            const uploaded: { name: string; url: string }[] = [];
            for (const f of col.files) {
              try {
                const r2 = await storagePut(`bridge-ws/${Date.now()}-${safeStorageName(f.name)}`, readFileSync(f.path), f.contentType);
                uploaded.push({ name: f.name, url: r2.url });
              } catch { col.skipped.push({ name: f.name, reason: "上传存储失败" }); }
            }
            text += formatFilesReply(uploaded, col.skipped);
            console.log(`[BridgeWorkspace] 回传 ${uploaded.length} 个文件（跳过 ${col.skipped.length}）`);
          }
        }
      } finally {
        if (wsDir) {
          cleanupCallWorkspace(wsDir);
          try { rmSync(wsDir + ".mcp.json", { force: true }); } catch { /* 已不存在 */ }
        }
      }
      if (isError) return res.status(502).json({ error: { message: `本机 ${grok ? "grok" : gpt ? "codex" : "claude"} 返回错误：` + (text || "").slice(0, 600) } });
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
