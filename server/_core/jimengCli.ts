// #328 即梦（dreamina）CLI 本机桥接型视频 provider 适配器。
//
// 即梦 CLI 是装在服务器主机上、独立 OAuth 登录的命令行工具（文档：589e97ff）。
// 与 kie/poyo 的 HTTP API 不同，这里通过 child_process.spawn 调用本机 `dreamina`
// 可执行文件——完全复用本项目已有的「本机 Claude 桥接」(claudeBridge.ts) 模式。
//
// 异步任务制：submit(不带 --poll) → 拿 submit_id → query_result --submit_id 轮询，
// 正好接进现有 videoTaskPoller（提交/查询两段），与 poyo/kie 同构。
//
// ✅ #333 参数枚举已按真机官方 `dreamina <子命令> -h` 精确校准（见 shared/videoModelParams.ts
//   与下方 JIMENG_PARAM_FLAGS）：model_version 分命令枚举、video_resolution 必填（缺失兜底
//   720p）、duration 4-15s、ratio 6 档、多帧/多模态修正到位。
// ⚠️ 仅**解析层**仍「待一次真实输出定格式」：SKILL.md 确认关键字段为 submit_id、
//   gen_status（querying|success|fail）、fail_reason，但 stdout 的确切结构（JSON vs 文本、
//   结果视频 URL 落点）需一次真实 `dreamina text2video --poll=N` + `query_result` 输出确认。
//   故 parseSubmitOutput / parseQueryOutput 暂用**防御式解析**（先 JSON.parse，再按上述字段
//   名兜底扫描 + 文本正则），拿到真实输出后收敛为确切键即可。

import { spawn } from "node:child_process";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getJimengCliConfig } from "./jimengConfig";
import { resolveToAbsoluteUrl } from "../storage";

// ── provider 注册（video）──────────────────────────────────────────────────
// UI provider value → 即梦 CLI 子命令 + 参考素材如何映射到 CLI flag。
// 只增不删：历史 video_tasks 行会引用这些值。
export interface JimengSpec {
  /** dreamina 子命令 */
  cmd: "text2video" | "image2video" | "frames2video" | "multiframe2video" | "multimodal2video";
  /** 参考图映射：single=首帧 --image；frames=首尾帧 --first/--last；multi=多帧 --images */
  refMode: "none" | "single" | "frames" | "multi" | "multimodal";
  /** 是否吃视频/音频参考（multimodal2video） */
  takesVideo?: boolean;
  takesAudio?: boolean;
}

export const JIMENG_VIDEO_SPECS: Record<string, JimengSpec> = {
  jimeng_text2video:      { cmd: "text2video",      refMode: "none" },
  jimeng_image2video:     { cmd: "image2video",     refMode: "single" },
  jimeng_frames2video:    { cmd: "frames2video",    refMode: "frames" },
  jimeng_multiframe2video:{ cmd: "multiframe2video",refMode: "multi" },
  jimeng_multimodal2video:{ cmd: "multimodal2video",refMode: "multimodal", takesVideo: true, takesAudio: true },
};

// 每个 provider 允许透传给 CLI 的参数键 → CLI flag 名（#333 严格按真机官方 `-h` 校准）。
//   text2video/multimodal2video：--model_version/--ratio/--video_resolution/--duration
//   image2video/frames2video：--model_version/--video_resolution/--duration（ratio 由图推断）
//   multiframe2video：仅 --video_resolution/--duration（model_version 固定不可配；
//     --transition-prompt/--transition-duration 为多段数组，节点常用 2 图快捷路径不透传）
// ⚠️ --video_resolution 所有视频命令**必填**且无 CLI 默认，缺失时下方兜底注入 720p。
const JIMENG_PARAM_FLAGS: Record<string, Record<string, string>> = {
  jimeng_text2video:       { model_version: "model_version", ratio: "ratio", video_resolution: "video_resolution", duration: "duration" },
  jimeng_image2video:      { model_version: "model_version", video_resolution: "video_resolution", duration: "duration" },
  jimeng_frames2video:     { model_version: "model_version", video_resolution: "video_resolution", duration: "duration" },
  jimeng_multiframe2video: { video_resolution: "video_resolution", duration: "duration" },
  jimeng_multimodal2video: { model_version: "model_version", ratio: "ratio", video_resolution: "video_resolution", duration: "duration" },
};

export function isJimengVideoProvider(provider: string): boolean {
  return provider in JIMENG_VIDEO_SPECS;
}

/** 可执行文件：优先后台配置/JIMENG_CLI_BIN，缺省 `dreamina`（须已装在主机 PATH 且完成 login）。 */
function jimengBin(): string {
  return getJimengCliConfig().bin || "dreamina";
}
/** 是否启用（后台开关优先，env 兜底）。 */
function jimengEnabled(): boolean {
  return getJimengCliConfig().enabled;
}

// ── 子进程执行（仿 claudeBridge：detached 进程组 + 超时整组 SIGKILL）──────────
interface SpawnResult { stdout: string; stderr: string; code: number | null; timedOut: boolean; spawnError?: string }

function spawnDreamina(args: string[], timeoutMs: number): Promise<SpawnResult> {
  // 支持「前缀命令」写法：后台可执行路径可填 `wsl dreamina`（Windows 原生 Node → 调 WSL 里的
  // dreamina）。以 `wsl ` 开头时按空格拆成 命令+前缀参数（数组传参，无 shell、免注入）；否则整串
  // 作为可执行文件（兼容含空格的 Windows 完整路径，如 `C:\Program Files\...\dreamina.exe`）。
  const raw = jimengBin();
  let cmd = raw;
  let prefix: string[] = [];
  if (/^wsl\s+/i.test(raw)) {
    const parts = raw.split(/\s+/);
    cmd = parts[0];
    prefix = parts.slice(1);
  }
  const finalArgs = [...prefix, ...args];
  return new Promise((resolve) => {
    let stdout = "", stderr = "", done = false, timedOut = false, spawnError: string | undefined;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, finalArgs, {
        cwd: tmpdir(), env: process.env, stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        // Windows：隐藏子进程控制台窗口——否则每次 spawn wsl/dreamina（提交/轮询/检测）
        // 都会弹一个黑框（轮询期尤其烦）。windowsHide 对非 Windows 平台无副作用。
        windowsHide: true,
      });
    } catch (e) {
      return resolve({ stdout: "", stderr: "", code: null, timedOut: false, spawnError: e instanceof Error ? e.message : String(e) });
    }
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(timer); if (fallbackTimer) clearTimeout(fallbackTimer);
      resolve({ stdout, stderr, code: child.exitCode, timedOut, spawnError });
    };
    const killTree = () => {
      try {
        if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
        else if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
    };
    const timer = setTimeout(() => { timedOut = true; killTree(); fallbackTimer = setTimeout(finish, 5000); }, timeoutMs);
    child.stdout?.on("data", (d) => { stdout += String(d); });
    child.stderr?.on("data", (d) => { stderr += String(d); });
    child.on("error", (e) => { spawnError = e instanceof Error ? e.message : String(e); finish(); });
    child.on("close", finish);
  });
}

// ── 参考素材：URL → 本机临时文件（CLI 只接受本机可访问路径，文档明确）──────────
async function downloadToTemp(url: string, dir: string, idx: number): Promise<string> {
  const abs = await resolveToAbsoluteUrl(url);
  const res = await fetch(abs, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`下载参考素材失败 (${res.status}): ${url.slice(0, 80)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // 从 URL 猜扩展名（无则默认 .png——CLI 一般按内容识别，扩展名仅为可读性）。
  const m = /\.(png|jpe?g|webp|gif|mp4|mov|webm|m4v|mp3|wav|m4a|aac)(?:$|\?)/i.exec(abs);
  const ext = m ? m[1].toLowerCase() : "png";
  const p = join(dir, `ref_${idx}.${ext}`);
  await writeFile(p, buf);
  return p;
}

// ── 解析层（⚠️ 待真机校准）────────────────────────────────────────────────
// 即梦 CLI 的 stdout JSON 结构未知。以下按「先整体 JSON.parse，再逐可能字段名兜底
// 扫描」的防御式做法（与 poyoVideo 容忍多种结果字段名同源），并对纯文本输出也做正则
// 兜底。拿到真实输出后，把字段名收敛为确切键即可。
function tryParseJson(out: string): Record<string, unknown> | null {
  const trimmed = out.trim();
  // 直接 parse
  try { return JSON.parse(trimmed) as Record<string, unknown>; } catch { /* not pure json */ }
  // 从混合输出里抠出第一个 {...} 块
  const s = trimmed.indexOf("{"); const e = trimmed.lastIndexOf("}");
  if (s >= 0 && e > s) { try { return JSON.parse(trimmed.slice(s, e + 1)) as Record<string, unknown>; } catch { /* ignore */ } }
  return null;
}

function deepFindString(obj: unknown, keys: string[]): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const stack: unknown[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      if (keys.includes(k) && (typeof v === "string" || typeof v === "number")) return String(v);
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return undefined;
}

/** 从提交输出解析 submit_id（待真机校准：确认确切字段名）。 */
export function parseSubmitOutput(out: string): string | undefined {
  const json = tryParseJson(out);
  if (json) {
    const id = deepFindString(json, ["submit_id", "submitId", "task_id", "taskId", "id"]);
    if (id) return id;
  }
  // 纯文本兜底：找 submit_id=xxx / submit_id: xxx
  const m = /submit[_-]?id["\s:=]+([A-Za-z0-9_-]{6,})/i.exec(out);
  return m?.[1];
}

export interface JimengTaskStatus {
  status: "running" | "finished" | "failed";
  resultVideoUrl?: string;
  resultVideoUrls?: string[];
  errorMessage?: string;
}

/** 从 query_result 输出解析状态 + 结果 URL（待真机校准）。 */
export function parseQueryOutput(out: string): JimengTaskStatus {
  const json = tryParseJson(out);
  // 状态字段：gen_status / status / state；成功值可能是 success/finished/done/completed
  const rawStatus = (json ? deepFindString(json, ["gen_status", "status", "state"]) : undefined)
    ?? (/\b(success|succeeded|finished|done|completed|failed|error)\b/i.exec(out)?.[1]);
  const s = (rawStatus ?? "").toLowerCase();
  const FINISHED = ["success", "succeeded", "finished", "done", "completed"];
  const FAILED = ["failed", "error", "cancelled", "canceled", "expired"];
  // 收集所有像视频 URL 的串（http(s) + .mp4/.mov/.webm）。
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => { if (u && !seen.has(u)) { seen.add(u); urls.push(u); } };
  const urlRe = /https?:\/\/[^\s"'<>]+?\.(?:mp4|mov|webm|m4v)(?:\?[^\s"'<>]*)?/gi;
  let mm: RegExpExecArray | null;
  while ((mm = urlRe.exec(out))) push(mm[0]);

  if (FAILED.includes(s)) {
    return { status: "failed", errorMessage: deepFindString(json ?? {}, ["message", "error", "fail_reason", "reason"]) ?? "生成失败" };
  }
  if (FINISHED.includes(s)) {
    return { status: "finished", resultVideoUrl: urls[0], resultVideoUrls: urls.length ? urls : undefined };
  }
  // 未明确 → 若已抓到 URL 也视作完成（防御：有些 CLI 完成即直接给 URL 不带显式状态）
  if (urls.length) return { status: "finished", resultVideoUrl: urls[0], resultVideoUrls: urls };
  return { status: "running" };
}

// ── 提交 ────────────────────────────────────────────────────────────────────
export interface SubmitJimengResult { externalTaskId: string }

export async function submitJimengVideo(opts: {
  provider: string;
  prompt: string;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  params?: Record<string, unknown>;
  /** 可选：指定 session 隔离任务（文档「Session 管理」）。 */
  sessionId?: string;
}): Promise<SubmitJimengResult> {
  const spec = JIMENG_VIDEO_SPECS[opts.provider];
  if (!spec) throw new Error(`Unknown jimeng provider: ${opts.provider}`);
  if (!jimengEnabled()) throw new Error("即梦 CLI 未启用（管理员需在部署机安装 dreamina、完成 login，并在后台开启开关）");

  const imgs = (opts.referenceImageUrls?.length ? opts.referenceImageUrls : (opts.referenceImageUrl ? [opts.referenceImageUrl] : []))
    .map((u) => u?.trim()).filter((u): u is string => Boolean(u));
  const vids = (opts.referenceVideoUrls ?? []).map((u) => u?.trim()).filter((u): u is string => Boolean(u));
  const auds = (opts.referenceAudioUrls ?? []).map((u) => u?.trim()).filter((u): u is string => Boolean(u));

  // 需要本机文件的模式：先把 URL 下载到临时目录，提交后清理。
  const workDir = await mkdtemp(join(tmpdir(), "jimeng-"));
  try {
    const args: string[] = [spec.cmd, `--prompt=${opts.prompt}`];

    if (spec.refMode === "single") {
      if (!imgs[0]) throw new Error("图生视频需要一张输入图片，请连接上游图片或添加参考图");
      args.push(`--image=${await downloadToTemp(imgs[0], workDir, 0)}`);
    } else if (spec.refMode === "frames") {
      if (!imgs[0]) throw new Error("首尾帧视频至少需要首帧图片");
      args.push(`--first=${await downloadToTemp(imgs[0], workDir, 0)}`);
      if (imgs[1]) args.push(`--last=${await downloadToTemp(imgs[1], workDir, 1)}`);
    } else if (spec.refMode === "multi") {
      if (imgs.length < 2) throw new Error("多帧视频至少需要 2 张图片");
      const paths = await Promise.all(imgs.map((u, i) => downloadToTemp(u, workDir, i)));
      args.push(`--images=${paths.join(",")}`);
    } else if (spec.refMode === "multimodal") {
      if (imgs[0]) args.push(`--image=${await downloadToTemp(imgs[0], workDir, 0)}`);
      if (spec.takesVideo && vids[0]) args.push(`--video=${await downloadToTemp(vids[0], workDir, 100)}`);
      if (spec.takesAudio && auds[0]) args.push(`--audio=${await downloadToTemp(auds[0], workDir, 200)}`);
    }

    // 透传允许的参数（按 flag 表；勿发未列出的键）。
    const allowed = JIMENG_PARAM_FLAGS[opts.provider] ?? {};
    const p = opts.params ?? {};
    for (const [key, flag] of Object.entries(allowed)) {
      const raw = p[key];
      if (raw === undefined || raw === null || raw === "") continue;
      args.push(`--${flag}=${String(raw)}`);
    }
    // --video_resolution 所有视频命令必填且 CLI 无默认，缺失即报错——兜底注入 720p（全模型通用）。
    if (allowed.video_resolution && !args.some((a) => a.startsWith("--video_resolution="))) {
      args.push("--video_resolution=720p");
    }
    const sessionId = opts.sessionId || getJimengCliConfig().sessionId;
    if (sessionId) args.push(`--session=${sessionId}`);
    // 不带 --poll：立即返回 submit_id，实际生成交给 videoTaskPoller 轮询 query_result。

    const r = await spawnDreamina(args, 90_000);
    if (r.spawnError) throw new Error(`无法启动即梦 CLI：${r.spawnError}（检查 JIMENG_CLI_BIN / 是否已安装 dreamina）`);
    if (r.timedOut) throw new Error("即梦 CLI 提交超时（>90s）");
    const submitId = parseSubmitOutput(r.stdout);
    if (!submitId) {
      throw new Error(`即梦 CLI 未返回 submit_id（退出码 ${r.code}）：${(r.stderr || r.stdout).slice(0, 200)}`);
    }
    return { externalTaskId: submitId };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  }
}

// ── 诊断（后台「检测」按钮）：探测 dreamina 是否已安装 + 是否已登录 ────────────
export interface JimengInspectResult {
  bin: string;
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  credit?: string;     // user_credit 原始输出摘要（可读，未强解析）
  error?: string;
}

/** 探测：`version`（判安装）+ `user_credit`（判登录/余额）。不需要 enabled，纯诊断用。 */
export async function inspectJimengCli(): Promise<JimengInspectResult> {
  const bin = jimengBin();
  const ver = await spawnDreamina(["version"], 15_000);
  if (ver.spawnError || ver.code === null && !ver.stdout) {
    return { bin, installed: false, loggedIn: false, error: ver.spawnError ?? "无法启动，可能未安装或不在 PATH" };
  }
  const installed = !ver.spawnError;
  const version = (ver.stdout || "").trim().split("\n")[0]?.slice(0, 120) || undefined;
  // user_credit：登录后返回积分/账户信息；未登录通常报错。
  const cred = await spawnDreamina(["user_credit"], 20_000);
  const credOut = (cred.stdout || "").trim();
  const credErr = (cred.stderr || "").trim();
  const loggedIn = !cred.spawnError && !cred.timedOut && cred.code === 0 && credOut.length > 0 && !/not.?logged|未登录|unauthor|login/i.test(credOut + credErr);
  return {
    bin, installed, version, loggedIn,
    credit: loggedIn ? credOut.slice(0, 200) : undefined,
    ...(loggedIn ? {} : { error: (credErr || credOut || "user_credit 未返回账户信息（可能未登录）").slice(0, 200) }),
  };
}

// ── 查询 ────────────────────────────────────────────────────────────────────
export async function checkJimengVideoStatus(externalTaskId: string): Promise<JimengTaskStatus> {
  if (!jimengEnabled()) throw new Error("即梦 CLI 未启用");
  const r = await spawnDreamina(["query_result", `--submit_id=${externalTaskId}`], 30_000);
  if (r.spawnError) throw new Error(`无法启动即梦 CLI：${r.spawnError}`);
  if (r.timedOut) return { status: "running" }; // 查询超时按在途处理，下轮再查
  return parseQueryOutput(r.stdout);
}
