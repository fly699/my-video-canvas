// 本机 Grok（SuperGrok / X Premium+ 订阅）桥接：与本机 Claude/GPT 同一个端点、同一个鉴权 Key
// （CLAUDE_LOCAL_BRIDGE_KEY），按模型前缀分流——"grok-local*" 的请求转成服务器上跑一次官方
// **Grok Build** CLI 的无头模式 `grok -p`（用订阅浏览器/设备码登录的 session，不按 API token 计费）。
//
// 官方文档查证（docs.x.ai/build/cli/headless-scripting，2026-07）：
//  - `-p` = 无头：执行单条提示后退出（脚本/CI）；`-m/--model` 切模型；
//  - `--no-auto-update` = 无头/CI 下跳过后台更新检查（官方明确要求带上）；
//  - `--output-format json|streaming-json` 是「机器可读」输出；不带则打印回答文本（同 Claude Code/codex）。
//  - 鉴权优先级：model.api_key > model.env_key > **active session token（订阅登录）** > XAI_API_KEY。
//    ⚠️ 服务器上【绝不要】设 XAI_API_KEY / GROK_API_KEY / GROK_CODE_XAI_API_KEY，否则绕过订阅变按量计费！
//
// 安全：Grok Build 是**编码 agent**（自带写文件/跑命令工具）。本桥接是纯文本问答，故：
//  - cwd 设成临时目录（非本仓库），任何文件操作都被隔离；
//  - **不传 --always-approve** —— 无头下需审批的工具无法自动执行（=不写文件/不跑 shell）；
//  - 需要微调时用 env GROK_BRIDGE_ARGS（空格分隔）追加/覆盖 flag。
//  - 因本环境无 Grok Build CLI + 无订阅，**精确调用需在你服务器上先 `grok -p "hi"` 冒烟验证**
//    （与 gpt-local 要求先验 `codex exec ... "hi"` 同理）。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { win32 as winPath } from "node:path";
import type { OAMessage } from "./claudeBridge";
import { messagesToPrompt, parseClaudeJsonResult } from "./claudeBridge";
import { collectFileUrls, docTextFromFileUrls } from "./bridgeAttachments";

/** 请求的 model 是否该走 Grok 分支（"grok-local" 或 "grok-local:xxx"）。 */
export function isGrokLocalModel(model: unknown): boolean {
  return typeof model === "string" && model.trim().toLowerCase().startsWith("grok-local");
}

/** 解析要传给 `grok -m` 的值："grok-local"（默认）→ null；"grok-local:grok-4.5" → 后缀。
 *  严格白名单字符防注入；非法串回退默认模型。纯函数。 */
export function grokModelArg(model: unknown): string | null {
  if (typeof model !== "string") return null;
  let m = model.trim();
  if (m.toLowerCase().startsWith("grok-local")) m = m.slice("grok-local".length).replace(/^:/, "");
  if (!m) return null;
  if (m.length > 64 || !/^[A-Za-z0-9._-]+$/.test(m)) return null;
  return m;
}

/** grok 可执行文件路径。优先 env GROK_BIN；否则默认裸名 "grok"（走 PATH）。
 *  Windows 特例：裸名 grok 在无 shell 的 spawn 下常找不到（且新装的 grok 要重启进程才进 PATH）——
 *  自动探测官方默认安装位置 %USERPROFILE%\.grok\bin\grok.exe，命中即用绝对路径，省掉手配 GROK_BIN。
 *  纯函数（依赖注入，便于单测）。 */
export function resolveGrokBin(opts: {
  env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; exists?: (p: string) => boolean;
} = {}): string {
  const env = opts.env ?? process.env;
  const explicit = env.GROK_BIN?.trim();
  if (explicit) return explicit; // 用户显式指定 → 最高优先，原样用
  const platform = opts.platform ?? process.platform;
  if (platform === "win32") {
    const exists = opts.exists ?? existsSync;
    const home = env.USERPROFILE || (env.HOMEDRIVE && env.HOMEPATH ? env.HOMEDRIVE + env.HOMEPATH : "") || "";
    if (home) {
      const probe = winPath.join(home, ".grok", "bin", "grok.exe");
      if (exists(probe)) return probe; // 默认安装位置命中 → 绝对路径，不依赖 PATH
    }
  }
  return "grok";
}

/** env GROK_BRIDGE_ARGS（空格分隔）→ 追加参数数组。空/未设 → []。纯函数（供单测）。 */
export function extraGrokArgs(raw?: string): string[] {
  const s = (raw ?? "").trim();
  return s ? s.split(/\s+/).filter(Boolean) : [];
}

/** 从 grok 的 stderr 里抽「真正的错误行」（同 codex：会把会话记录打到 stderr，直接取尾部会把回显当错误）。纯函数。 */
export function pickGrokErrorDetail(stdout: string, stderr: string, code: number | null | undefined): string {
  const out = (stdout ?? "").trim();
  if (out) return out;
  const lines = (stderr ?? "").trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hits = lines.filter((l) => /error|错误|警告|warning|invalid|not found|未找到|unauthorized|denied|login|session|quota|exceed|rate|401|403|404|429|5\d\d/i.test(l));
  if (hits.length) return hits.slice(-6).join("\n").slice(0, 600);
  if (lines.length) return lines.slice(-3).join("\n").slice(0, 400);
  return `grok 退出码 ${code ?? "?"}，无输出。检查订阅登录：在有浏览器的机器上 \`grok\` 设备码登录（用 SuperGrok/X Premium+ 账号）后，把 ~/.grok 会话拷到服务器同路径；且服务器上勿设 XAI_API_KEY（会绕过订阅）。`;
}

/** 跑一次无头 grok 拿回复。stdout 即回答；exit 非 0 或空输出记为错误（stderr 只抽错误行）。
 *  纯文本 + 文档转文本（图片：Grok Build 为编码 agent、不接图片，忽略）。model 为 null 时不传 -m（订阅默认）。 */
export async function runGrokText(opts: { messages: OAMessage[]; timeoutMs: number; model?: string | null }): Promise<{ text: string; isError: boolean }> {
  let prompt = messagesToPrompt(opts.messages);
  const docText = await docTextFromFileUrls(collectFileUrls(opts.messages));
  if (docText) prompt = [prompt, docText].filter(Boolean).join("\n\n");

  // 参数对齐官方 headless 示例 `grok -p "..." --output-format json`（docs.x.ai/build/cli/headless-scripting）：
  //  - `-p`/`--single` 是【取紧随其后的值】作提示词（用户真机报错 "a value is required for
  //    '--single <PROMPT>'" 印证）——故提示词紧跟 -p、其余 flag 前置；
  //  - `--output-format json`：官方推荐的「最干净的脚本集成」，且 Grok Build 是 Claude Code 克隆、
  //    json 结构同款，故复用 claudeBridge 的 parseClaudeJsonResult 取 result（非 JSON 时回退原文）；
  //  - `--no-auto-update` 无头必带；不传 --always-approve（工具无法自动执行 = 安全）。
  const args = [
    "--no-auto-update", "--output-format", "json",
    ...(opts.model ? ["-m", opts.model] : []),
    ...extraGrokArgs(process.env.GROK_BRIDGE_ARGS),
    "-p", prompt,
  ];
  const bin = resolveGrokBin();
  const isCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  return new Promise((resolve) => {
    let out = "", err = "", done = false, spawnErr: string | null = null, killed = false;
    // detached（仅 POSIX）：子进程成进程组组长，超时时整组 SIGKILL 连带孙进程；否则孙进程持 stdio 管道
    // 致 'close' 不触发、Promise 卡死（同 claude/codex 桥接）。
    const child = spawn(bin, args, { cwd: tmpdir(), env: process.env, stdio: ["ignore", "pipe", "pipe"], shell: isCmd, detached: process.platform !== "win32" });
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (code?: number | null) => {
      if (done) return; done = true; clearTimeout(timer); if (fallbackTimer) clearTimeout(fallbackTimer);
      if (spawnErr) return resolve({ text: `无法启动 grok：${spawnErr}。请在服务器上安装官方 Grok Build CLI（curl -fsSL https://x.ai/cli/install.sh | bash）并【重启本服务】；装在非默认位置则设 GROK_BIN=完整路径。`, isError: true });
      if (killed) return resolve({ text: `本机 Grok 生成超时被中止（>${Math.round(opts.timeoutMs / 1000)}s）。复杂请求较慢，可调高 CLAUDE_BRIDGE_TIMEOUT_MS。` + (err ? `\n${err.slice(0, 300)}` : ""), isError: true });
      // 退出码非 0 → 直接报错（stderr 抽错误行）。否则解析 --output-format json（同 Claude Code 结构，
      // 取 result；非 JSON 时 parseClaudeJsonResult 回退把原文当回复）。解析空 → 报错。
      if (typeof code === "number" && code !== 0) return resolve({ text: pickGrokErrorDetail(out, err, code), isError: true });
      const parsed = parseClaudeJsonResult(out);
      if (!parsed.text.trim()) return resolve({ text: pickGrokErrorDetail(out, err, code), isError: true });
      resolve({ text: parsed.text, isError: parsed.isError });
    };
    const killTree = () => {
      try {
        if (process.platform === "win32") { spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]); }
        else if (child.pid) { process.kill(-child.pid, "SIGKILL"); }
      } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
    };
    const timer = setTimeout(() => { killed = true; killTree(); fallbackTimer = setTimeout(() => finish(null), 5000); }, opts.timeoutMs);
    child.stdout?.on("data", (d) => { out += String(d); });
    child.stderr?.on("data", (d) => { err += String(d); });
    child.on("error", (e) => { spawnErr = e instanceof Error ? e.message : String(e); finish(null); });
    child.on("close", (code) => finish(code));
  });
}
