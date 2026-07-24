// #328 金泰（dreamina）CLI 本机桥接型视频 provider 适配器。
//
// 金泰 CLI 是装在服务器主机上、独立 OAuth 登录的命令行工具（文档：589e97ff）。
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
import { writeFile, readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getJimengCliConfig } from "./jimengConfig";
import { resolveToAbsoluteUrl, storagePut } from "../storage";

// #333 金泰 CLI 产物是「本地文件」（query_result --download_dir 下载 <submit_id>_video_N.mp4），
// 不是公网链接。Windows 原生 Node 经 `wsl` 调用时，传给 dreamina 的路径必须是 WSL 视角
// （/mnt/c/...），而 Node 仍按 Windows 路径读文件。以下做双向兼容的路径处理。
function usesWslPrefix(): boolean {
  return /^wsl\s+/i.test(getJimengCliConfig().bin || "");
}
/** Windows 路径 → WSL 路径（仅当经 wsl 调用且形如 C:\...）。默认 WSL 把 C 盘挂在 /mnt/c。 */
function toWslPathIfNeeded(p: string): string {
  if (!usesWslPrefix()) return p;
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}
function mimeForVideo(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : ext === "m4v" ? "video/x-m4v" : "video/mp4";
}

// ── provider 注册（video）──────────────────────────────────────────────────
// UI provider value → 金泰 CLI 子命令 + 参考素材如何映射到 CLI flag。
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
// 金泰 CLI 的 stdout JSON 结构未知。以下按「先整体 JSON.parse，再逐可能字段名兜底
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
  /** 本地结果文件路径（result_json.videos[].path；供 checkJimengVideoStatus 读取上传）。 */
  resultPaths?: string[];
  /** 本次生成实际消耗的金泰积分（credit_count，真机回显，非估算）。 */
  creditCount?: number;
}

// query_result 真机 JSON（#333 已校准）：
//   { submit_id, gen_status: "success"|"fail"|"querying"…, credit_count: 45,
//     result_json: { images: [...], videos: [{ path, fps, width, height, format, duration }] } }
/** 从 query_result 的 JSON 输出解析状态 / 本地文件路径 / 积分消耗。 */
export function parseQueryOutput(out: string): JimengTaskStatus {
  const json = tryParseJson(out);
  const s = (deepFindString(json ?? {}, ["gen_status", "status", "state"]) ?? "").toLowerCase();
  const creditRaw = json?.["credit_count"];
  const creditCount = typeof creditRaw === "number" ? creditRaw : undefined;
  // result_json.videos[].path — 本地文件路径（金泰不给公网链接）。
  const paths: string[] = [];
  const rj = json?.["result_json"] as { videos?: Array<{ path?: unknown }> } | undefined;
  if (Array.isArray(rj?.videos)) for (const v of rj!.videos!) if (v?.path) paths.push(String(v.path));

  const FINISHED = ["success", "succeeded", "finished", "done", "completed"];
  const FAILED = ["fail", "failed", "error", "cancelled", "canceled", "expired"];
  if (FAILED.includes(s)) {
    return { status: "failed", errorMessage: deepFindString(json ?? {}, ["fail_reason", "message", "error", "reason"]) ?? "金泰生成失败", creditCount };
  }
  if (FINISHED.includes(s)) {
    return { status: "finished", resultPaths: paths.length ? paths : undefined, creditCount };
  }
  return { status: "running", creditCount };
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
  if (!jimengEnabled()) throw new Error("金泰 CLI 未启用（管理员需在部署机安装 dreamina、完成 login，并在后台开启开关）");

  const imgs = (opts.referenceImageUrls?.length ? opts.referenceImageUrls : (opts.referenceImageUrl ? [opts.referenceImageUrl] : []))
    .map((u) => u?.trim()).filter((u): u is string => Boolean(u));
  const vids = (opts.referenceVideoUrls ?? []).map((u) => u?.trim()).filter((u): u is string => Boolean(u));
  const auds = (opts.referenceAudioUrls ?? []).map((u) => u?.trim()).filter((u): u is string => Boolean(u));

  // 需要本机文件的模式：先把 URL 下载到临时目录，提交后清理。
  const workDir = await mkdtemp(join(tmpdir(), "jimeng-"));
  try {
    const args: string[] = [spec.cmd, `--prompt=${opts.prompt}`];

    // 参考素材下载到本机临时文件；经 wsl 调用时把路径转成 WSL 视角（/mnt/c/...）。
    const dl = async (url: string, idx: number) => toWslPathIfNeeded(await downloadToTemp(url, workDir, idx));
    if (spec.refMode === "single") {
      if (!imgs[0]) throw new Error("图生视频需要一张输入图片，请连接上游图片或添加参考图");
      args.push(`--image=${await dl(imgs[0], 0)}`);
    } else if (spec.refMode === "frames") {
      if (!imgs[0]) throw new Error("首尾帧视频至少需要首帧图片");
      args.push(`--first=${await dl(imgs[0], 0)}`);
      if (imgs[1]) args.push(`--last=${await dl(imgs[1], 1)}`);
    } else if (spec.refMode === "multi") {
      if (imgs.length < 2) throw new Error("多帧视频至少需要 2 张图片");
      const paths = await Promise.all(imgs.map((u, i) => dl(u, i)));
      args.push(`--images=${paths.join(",")}`);
    } else if (spec.refMode === "multimodal") {
      if (imgs[0]) args.push(`--image=${await dl(imgs[0], 0)}`);
      if (spec.takesVideo && vids[0]) args.push(`--video=${await dl(vids[0], 100)}`);
      if (spec.takesAudio && auds[0]) args.push(`--audio=${await dl(auds[0], 200)}`);
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
    if (r.spawnError) throw new Error(`无法启动金泰 CLI：${r.spawnError}（检查 JIMENG_CLI_BIN / 是否已安装 dreamina）`);
    if (r.timedOut) throw new Error("金泰 CLI 提交超时（>90s）");
    const submitId = parseSubmitOutput(r.stdout);
    if (!submitId) {
      throw new Error(`金泰 CLI 未返回 submit_id（退出码 ${r.code}）：${(r.stderr || r.stdout).slice(0, 200)}`);
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
// 金泰产物是本地文件（query_result --download_dir 下载 <submit_id>_video_N.mp4），不是链接。
// 故：带 --download_dir 查询 → 扫下载目录找视频文件 → 上传到本项目存储 → 返回我方 URL。
// 无论 CLI 是否干净退出（可能下载后仍阻塞被 timeout），只要目录里出现视频文件即判成功。
export async function checkJimengVideoStatus(externalTaskId: string): Promise<JimengTaskStatus> {
  if (!jimengEnabled()) throw new Error("金泰 CLI 未启用");
  const dir = await mkdtemp(join(tmpdir(), "jimeng-q-"));
  try {
    const dlArg = toWslPathIfNeeded(dir);
    const r = await spawnDreamina(["query_result", `--submit_id=${externalTaskId}`, `--download_dir=${dlArg}`], 120_000);
    if (r.spawnError) throw new Error(`无法启动金泰 CLI：${r.spawnError}`);

    // gen_status / credit_count 走真机 JSON 解析（权威状态与真实积分消耗）。
    const parsed = parseQueryOutput(r.stdout);

    // 扫下载目录取字节上传（金泰不给公网链接）：优先本任务前缀，回退任意视频文件。
    const files = await readdir(dir).catch(() => [] as string[]);
    const isVid = (f: string) => /\.(mp4|mov|webm|m4v)$/i.test(f);
    let vids = files.filter((f) => isVid(f) && f.startsWith(externalTaskId));
    if (vids.length === 0) vids = files.filter(isVid);
    vids.sort();

    if (vids.length > 0) {
      const urls: string[] = [];
      for (const f of vids) {
        const buf = await readFile(join(dir, f));
        if (buf.length < 1024) continue; // 空/截断文件跳过（真实产物为 MB 级）
        const { url } = await storagePut(`jimeng/${externalTaskId}/${f}`, buf, mimeForVideo(f));
        urls.push(url);
      }
      if (urls.length > 0) return { status: "finished", resultVideoUrl: urls[0], resultVideoUrls: urls, creditCount: parsed.creditCount };
    }

    // 没抓到文件：以 gen_status 为准。success 但文件未就绪 → 在途下轮再查；fail → 失败。
    if (parsed.status === "failed") return { status: "failed", errorMessage: parsed.errorMessage, creditCount: parsed.creditCount };
    return { status: "running", creditCount: parsed.creditCount };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  }
}

// ── 生图 provider（text2image / image2image / image_upscale）─────────────────
// 与视频同为本机 CLI 桥接、异步任务制（submit_id + query_result），但图像链路是「同步」的
// （imageGeneration.generateImage 请求内轮询），故这里只暴露 submit + status 两个原语，
// 由 generateImageJimeng 组织成「提交→请求内轮询→下载→上传」。
export const JIMENG_IMAGE_SPECS: Record<string, { cmd: "text2image" | "image2image" | "image_upscale"; refMode: "none" | "multi" | "single" }> = {
  jimeng_text2image:    { cmd: "text2image",    refMode: "none" },   // 文生图
  jimeng_image2image:   { cmd: "image2image",   refMode: "multi" },  // 图生图：--images 1-10
  jimeng_image_upscale: { cmd: "image_upscale", refMode: "single" }, // 图片超清：--image 一张
};

export function isJimengImageProvider(provider: string): boolean {
  return provider in JIMENG_IMAGE_SPECS;
}

// #337 严格按官方 `dreamina <子命令> -h` 校准的交叉依赖：
//   text2image  model_version: 3.0/3.1/4.0/4.1/4.5/4.6/4.7/5.0/5.0Pro（默认 5.0）
//   image2image model_version: 4.0/4.1/4.5/4.6/4.7/5.0/5.0Pro（无 3.x；默认 5.0）
//   resolution_type 必填，依 model_version：3.0/3.1→1k/2k；4.x/5.0→2k/4k；5.0Pro→1k/2k/4k
//   image_upscale：仅 resolution_type（2k/4k/8k，4k/8k 需 VIP）
//   ratio 8 档（与 width/height 互斥）；generate_num 1-10
const JIMENG_IMG_MODEL_VERSIONS: Record<string, string[]> = {
  text2image:  ["3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"],
  image2image: ["4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"],
};
const JIMENG_IMG_RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"];
function allowedResTypes(cmd: string, mv: string): string[] {
  if (cmd === "image_upscale") return ["2k", "4k", "8k"];
  if (mv === "3.0" || mv === "3.1") return ["1k", "2k"];
  if (mv === "5.0Pro") return ["1k", "2k", "4k"];
  return ["2k", "4k"]; // 4.0/4.1/4.5/4.6/4.7/5.0
}

function mimeForImage(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/png";
}

/** 提交生图任务，立即返回 submit_id（实际出图交给请求内轮询 checkJimengImageStatus）。 */
export async function submitJimengImage(opts: {
  provider: string;
  prompt: string;
  referenceImageUrls?: string[];
  params?: Record<string, unknown>;
  sessionId?: string;
}): Promise<SubmitJimengResult> {
  const spec = JIMENG_IMAGE_SPECS[opts.provider];
  if (!spec) throw new Error(`Unknown jimeng image provider: ${opts.provider}`);
  if (!jimengEnabled()) throw new Error("金泰 CLI 未启用（管理员需在部署机安装 dreamina、完成 login，并在后台开启开关）");

  const imgs = (opts.referenceImageUrls ?? []).map((u) => u?.trim()).filter((u): u is string => Boolean(u));
  const workDir = await mkdtemp(join(tmpdir(), "jimeng-img-"));
  try {
    const cmd = spec.cmd;
    const args: string[] = [cmd];
    if (cmd !== "image_upscale") args.push(`--prompt=${opts.prompt}`); // 超清无 prompt

    // 参考图下载到本机临时文件；经 wsl 调用时转成 WSL 视角路径。
    const dl = async (url: string, idx: number) => toWslPathIfNeeded(await downloadToTemp(url, workDir, idx));
    if (spec.refMode === "single") {
      if (!imgs[0]) throw new Error("图片超清需要一张输入图片，请连接上游图片或添加参考图");
      args.push(`--image=${await dl(imgs[0], 0)}`);
    } else if (spec.refMode === "multi") {
      if (!imgs[0]) throw new Error("图生图至少需要一张输入图片，请连接上游图片或添加参考图");
      const paths = await Promise.all(imgs.slice(0, 10).map((u, i) => dl(u, i)));
      args.push(`--images=${paths.join(",")}`);
    }

    const p = opts.params ?? {};
    if (cmd !== "image_upscale") {
      // model_version（分命令枚举夹取，非法回退官方默认 5.0）
      const mvAllowed = JIMENG_IMG_MODEL_VERSIONS[cmd] ?? [];
      let mv = String(p.model_version ?? "").trim();
      if (!mvAllowed.includes(mv)) mv = "5.0";
      args.push(`--model_version=${mv}`);
      // width/height（成对且正整数）与 ratio 互斥：有自定义尺寸就不发 ratio
      const w = Number(p.width), h = Number(p.height);
      const hasWH = Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0;
      if (hasWH) {
        args.push(`--width=${Math.round(w)}`, `--height=${Math.round(h)}`);
      } else {
        const ratio = String(p.ratio ?? "").trim();
        if (JIMENG_IMG_RATIOS.includes(ratio)) args.push(`--ratio=${ratio}`);
      }
      // resolution_type（必填，按 model_version 交叉夹取，默认 2k）
      const resAllowed = allowedResTypes(cmd, mv);
      let rt = String(p.resolution_type ?? "").trim().toLowerCase();
      if (!resAllowed.includes(rt)) rt = resAllowed.includes("2k") ? "2k" : resAllowed[0];
      args.push(`--resolution_type=${rt}`);
      // generate_num 1-10（默认 1，可省）
      const gnRaw = Number(p.generate_num);
      const gn = Number.isFinite(gnRaw) ? Math.min(10, Math.max(1, Math.round(gnRaw))) : 1;
      if (gn > 1) args.push(`--generate_num=${gn}`);
    } else {
      // image_upscale：仅 resolution_type（2k/4k/8k，必填，默认 2k）
      let rt = String(p.resolution_type ?? "").trim().toLowerCase();
      if (!allowedResTypes(cmd, "").includes(rt)) rt = "2k";
      args.push(`--resolution_type=${rt}`);
    }

    const sessionId = opts.sessionId || getJimengCliConfig().sessionId;
    if (sessionId) args.push(`--session=${sessionId}`);

    const r = await spawnDreamina(args, 90_000);
    if (r.spawnError) throw new Error(`无法启动金泰 CLI：${r.spawnError}（检查 JIMENG_CLI_BIN / 是否已安装 dreamina）`);
    if (r.timedOut) throw new Error("金泰 CLI 提交超时（>90s）");
    const submitId = parseSubmitOutput(r.stdout);
    if (!submitId) throw new Error(`金泰 CLI 未返回 submit_id（退出码 ${r.code}）：${(r.stderr || r.stdout).slice(0, 200)}`);
    return { externalTaskId: submitId };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  }
}

export interface JimengImageStatus {
  status: "running" | "finished" | "failed";
  resultImageUrls?: string[];
  errorMessage?: string;
  creditCount?: number;
}

/** 查询生图任务：带 --download_dir 下载本地图片文件 → 上传到本项目存储 → 返回我方 URL。 */
export async function checkJimengImageStatus(externalTaskId: string): Promise<JimengImageStatus> {
  if (!jimengEnabled()) throw new Error("金泰 CLI 未启用");
  const dir = await mkdtemp(join(tmpdir(), "jimeng-iq-"));
  try {
    const r = await spawnDreamina(["query_result", `--submit_id=${externalTaskId}`, `--download_dir=${toWslPathIfNeeded(dir)}`], 120_000);
    if (r.spawnError) throw new Error(`无法启动金泰 CLI：${r.spawnError}`);
    const json = tryParseJson(r.stdout);
    const s = (deepFindString(json ?? {}, ["gen_status", "status", "state"]) ?? "").toLowerCase();
    const creditRaw = json?.["credit_count"];
    const creditCount = typeof creditRaw === "number" ? creditRaw : undefined;

    // 扫下载目录取图片字节上传（金泰不给公网链接）：优先本任务前缀，回退任意图片文件。
    const files = await readdir(dir).catch(() => [] as string[]);
    const isImg = (f: string) => /\.(png|jpe?g|webp|gif)$/i.test(f);
    let imgs = files.filter((f) => isImg(f) && f.startsWith(externalTaskId));
    if (imgs.length === 0) imgs = files.filter(isImg);
    imgs.sort();
    if (imgs.length > 0) {
      const urls: string[] = [];
      for (const f of imgs) {
        const buf = await readFile(join(dir, f));
        if (buf.length < 256) continue; // 空/截断文件跳过
        const { url } = await storagePut(`jimeng/${externalTaskId}/${f}`, buf, mimeForImage(f));
        urls.push(url);
      }
      if (urls.length > 0) return { status: "finished", resultImageUrls: urls, creditCount };
    }
    const FAILED = ["fail", "failed", "error", "cancelled", "canceled", "expired"];
    if (FAILED.includes(s)) {
      return { status: "failed", errorMessage: deepFindString(json ?? {}, ["fail_reason", "message", "error", "reason"]) ?? "金泰生图失败", creditCount };
    }
    return { status: "running", creditCount };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  }
}
