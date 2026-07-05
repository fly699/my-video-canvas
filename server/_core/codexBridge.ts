// 本机 GPT（ChatGPT 订阅）桥接：与本机 Claude 同一个端点、同一个鉴权 Key（CLAUDE_LOCAL_BRIDGE_KEY），
// 按模型前缀分流——"gpt-local*" 的请求转成服务器上跑一次 OpenAI Codex CLI 的无头模式
// `codex exec`（用 ChatGPT Plus/Pro 订阅登录的凭证 ~/.codex/auth.json，不按 token 计费）。
//
// 真机查证过的 CLI 事实（openai/codex exec 文档与实测汇编）：
//  - 提示词经 stdin：`codex exec --skip-git-repo-check -`（"-" = 从 stdin 读）；
//  - `--sandbox read-only` 禁写文件系统（本桥接纯文本问答，最安全档）；
//  - `-m/--model` 切模型（如 gpt-5.3-codex）；
//  - 无 --json 时 stdout 只打印最终回答文本（横幅走 stderr）——无需 JSON 解析；
//  - 凭证优先级 CODEX_API_KEY > ~/.codex/auth.json(ChatGPT 登录) > OPENAI_API_KEY——
//    服务器上【不要】设前后两个 env，否则绕过订阅变按量计费。
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { OAMessage } from "./claudeBridge";
import { messagesToPrompt } from "./claudeBridge";
import { collectImageUrls, collectFileUrls, resolveImages, docTextFromFileUrls, imageExt } from "./bridgeAttachments";

/** 请求的 model 是否该走 GPT/codex 分支（"gpt-local" 或 "gpt-local:xxx"）。 */
export function isGptLocalModel(model: unknown): boolean {
  return typeof model === "string" && model.trim().toLowerCase().startsWith("gpt-local");
}

/** 解析要传给 `codex -m` 的值："gpt-local"（默认）→ null；"gpt-local:gpt-5.3-codex" → 后缀。
 *  严格白名单字符防注入；非法串回退默认模型。纯函数。 */
export function codexModelArg(model: unknown): string | null {
  if (typeof model !== "string") return null;
  let m = model.trim();
  if (m.toLowerCase().startsWith("gpt-local")) m = m.slice("gpt-local".length).replace(/^:/, "");
  if (!m) return null;
  if (m.length > 64 || !/^[A-Za-z0-9._-]+$/.test(m)) return null;
  return m;
}

/** codex 可执行文件（可用 env CODEX_BIN 覆盖）。 */
export function resolveCodexBin(): string { return process.env.CODEX_BIN?.trim() || "codex"; }

/** Windows spawn `.cmd` 坑同 claude（Node 18.20/20.12+ 无 shell spawn .cmd 报 EINVAL）：
 *  npm 全局装的 codex.cmd → 直接用 node 跑背后的 @openai/codex/bin/codex.js；找不到才兜底 shell。纯函数。 */
export function resolveCodexSpawn(
  bin: string,
  args: string[],
  opts: { platform?: NodeJS.Platform; exists?: (p: string) => boolean; appData?: string } = {},
): { cmd: string; args: string[]; shell: boolean } {
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? existsSync;
  // Windows 裸名自动探测：spawn 无 shell 只认 .exe，裸 "codex" 必 ENOENT（npm 全局装的是
  // codex.cmd）。用户没设 CODEX_BIN 时自动探 %APPDATA%\npm\codex.cmd——省掉一整个配置项。
  if (platform === "win32" && !/[\\/]/.test(bin) && !/\.(cmd|bat|exe)$/i.test(bin)) {
    const appData = opts.appData ?? process.env.APPDATA ?? "";
    const probe = appData ? join(appData, "npm", `${bin}.cmd`) : "";
    if (probe && exists(probe)) bin = probe;
  }
  if (platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    const js = join(dirname(bin), "node_modules", "@openai", "codex", "bin", "codex.js");
    if (exists(js)) return { cmd: process.execPath, args: [js, ...args], shell: false };
    return { cmd: bin, args, shell: true };
  }
  return { cmd: bin, args, shell: false };
}

/** 从 codex 的 stderr 里抽「真正的错误行」。codex exec 会把整段会话记录（含我们发的提示词转写）
 *  打到 stderr——直接取尾部 800 字会把对话回显当错误糊给用户（真机翻车）。只挑含错误特征的行。纯函数。 */
export function pickCodexErrorDetail(stdout: string, stderr: string, code: number | null | undefined): string {
  const out = (stdout ?? "").trim();
  if (out) return out; // stdout 有内容优先（部分版本把错误答案也打 stdout）
  const lines = (stderr ?? "").trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hits = lines.filter((l) => /error|错误|警告|warning|invalid|not found|未找到|unauthorized|denied|quota|exceed|stream|401|403|404|429|5\d\d/i.test(l));
  if (hits.length) return hits.slice(-6).join("\n").slice(0, 600);
  if (lines.length) return lines.slice(-3).join("\n").slice(0, 400);
  return `codex 退出码 ${code ?? "?"}，无输出。检查订阅登录：把有浏览器机器上登录后的 ~/.codex/auth.json 拷到服务器同路径。`;
}

/** 跑一次无头 codex 拿回复。stdout 即回答；exit 非 0 或空输出记为错误（stderr 只抽错误行）。
 *  图片附件落成临时文件用 `codex exec -i <文件>` 传入（用完删）；文档解析成文本追加进提示词。 */
export async function runCodexText(opts: { messages: OAMessage[]; timeoutMs: number; model?: string | null }): Promise<{ text: string; isError: boolean }> {
  let prompt = messagesToPrompt(opts.messages);
  const docText = await docTextFromFileUrls(collectFileUrls(opts.messages));
  if (docText) prompt = [prompt, docText].filter(Boolean).join("\n\n");
  const images = await resolveImages(collectImageUrls(opts.messages));

  // 图片落临时目录（codex 只接受文件路径），拼成重复的 -i 参数；结束后整目录删除。
  let imgDir: string | null = null;
  const imageArgs: string[] = [];
  if (images.length) {
    imgDir = mkdtempSync(join(tmpdir(), "codex-img-"));
    images.forEach((img, i) => {
      const p = join(imgDir!, `img${i}.${imageExt(img.mediaType)}`);
      writeFileSync(p, Buffer.from(img.base64, "base64"));
      imageArgs.push("-i", p);
    });
  }
  const cleanup = () => { if (imgDir) { try { rmSync(imgDir, { recursive: true, force: true }); } catch { /* 已删 */ } imgDir = null; } };

  const baseArgs = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", ...(opts.model ? ["-m", opts.model] : []), ...imageArgs, "-"];
  const { cmd, args, shell } = resolveCodexSpawn(resolveCodexBin(), baseArgs);
  return new Promise((resolve) => {
    let out = "", err = "", done = false, spawnErr: string | null = null;
    const child = spawn(cmd, args, { cwd: tmpdir(), env: process.env, stdio: ["pipe", "pipe", "pipe"], shell });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, opts.timeoutMs);
    child.stdout?.on("data", (d) => { out += String(d); });
    child.stderr?.on("data", (d) => { err += String(d); });
    try { child.stdin?.write(prompt); child.stdin?.end(); } catch { /* stdin 不可用 */ }
    const finish = (code?: number | null) => {
      if (done) return; done = true; clearTimeout(timer); cleanup();
      if (spawnErr) return resolve({ text: `无法启动 codex：${spawnErr}。请在服务器上 npm i -g @openai/codex 并【重启本服务】（新装的 CLI 要重启后才可见）；若装在非默认位置，设 CODEX_BIN=codex.cmd 的完整路径（Windows 标准路径 C:\\Users\\你\\AppData\\Roaming\\npm\\codex.cmd 会自动探测，无需配置）。`, isError: true });
      const text = out.trim();
      if (!text || (typeof code === "number" && code !== 0)) {
        return resolve({ text: pickCodexErrorDetail(out, err, code), isError: true });
      }
      resolve({ text, isError: false });
    };
    child.on("error", (e) => { spawnErr = e instanceof Error ? e.message : String(e); finish(null); });
    child.on("close", (code) => finish(code));
  });
}
