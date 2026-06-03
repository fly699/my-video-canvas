import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// ── 应用内「一键更新」：在服务器本机执行 git pull → install → migrate → build，
//    构建成功后退出进程，由 Windows 服务(NSSM)/pm2 自动重启以加载新代码。──
//
// 安全：仅 adminProcedure 调用；执行的命令为固定常量，无用户输入拼接。

type UpdateState = "idle" | "running" | "success" | "error" | "uptodate";

interface UpdateStatus {
  state: UpdateState;
  startedAt: number | null;
  finishedAt: number | null;
  step: string; // 当前步骤的中文描述
  log: string[]; // 最近若干行输出
  beforeCommit: string | null;
  afterCommit: string | null;
  willRestart: boolean;
  error: string | null;
}

const LOG_MAX_LINES = 600;

const status: UpdateStatus = {
  state: "idle",
  startedAt: null,
  finishedAt: null,
  step: "",
  log: [],
  beforeCommit: null,
  afterCommit: null,
  willRestart: false,
  error: null,
};

// 从 cwd 向上查找 git 仓库根目录
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const repoRoot = findRepoRoot();
const logFile = join(repoRoot, "deploy", "self-update.log");

function pushLog(line: string) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  status.log.push(stamped);
  if (status.log.length > LOG_MAX_LINES) status.log.splice(0, status.log.length - LOG_MAX_LINES);
  // 同步落盘（best-effort，失败不影响流程）
  void appendFile(logFile, stamped + "\n").catch(() => {});
}

// 运行一条命令，流式收集 stdout/stderr 到日志，resolve 退出码
function runStep(cmd: string): Promise<number> {
  return new Promise((resolve) => {
    pushLog(`$ ${cmd}`);
    const child = spawn(cmd, {
      cwd: repoRoot,
      shell: true, // 解析 pnpm/pnpm.cmd、git 等 PATH 命令（命令为固定常量，无注入风险）
      env: process.env, // 继承运行进程的环境（含 .env 加载的 DATABASE_URL 等）
      windowsHide: true,
    });
    const onData = (buf: Buffer) => {
      for (const raw of buf.toString("utf8").split(/\r?\n/)) {
        const line = raw.trimEnd();
        if (line) pushLog(line);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (e) => { pushLog(`[spawn error] ${e.message}`); resolve(-1); });
    child.on("close", (code) => { pushLog(`(exit ${code})`); resolve(code ?? -1); });
  });
}

// 取当前 commit 短哈希
async function currentCommit(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("git rev-parse HEAD", { cwd: repoRoot, shell: true, windowsHide: true });
    let out = "";
    child.stdout?.on("data", (b: Buffer) => { out += b.toString("utf8"); });
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(out.trim()));
  });
}

export function getUpdateStatus(): UpdateStatus {
  return { ...status, log: status.log.slice(-200) };
}

export interface VersionInfo {
  commit: string;
  subject: string;
  date: string;
}

// 当前版本信息（廉价，无网络）
export function getVersionInfo(): Promise<VersionInfo> {
  return new Promise((resolve) => {
    const child = spawn('git log -1 --format=%h%x1f%cI%x1f%s', { cwd: repoRoot, shell: true, windowsHide: true });
    let out = "";
    child.stdout?.on("data", (b: Buffer) => { out += b.toString("utf8"); });
    child.on("error", () => resolve({ commit: "unknown", subject: "", date: "" }));
    child.on("close", () => {
      const [commit = "unknown", date = "", subject = ""] = out.trim().split("\x1f");
      resolve({ commit, subject, date });
    });
  });
}

// 检查远程是否有更新（fetch 后比较落后提交数）。
//
// 健壮性：旧实现把「fetch 失败 / 无上游跟踪 / 真已最新」三种情况全部静默
// 归并为 behind=0 → UI 一律显示「已是最新」，导致检测出问题时用户无从察觉。
// 现在：① fetch 成败显式上报；② 当前分支无 @{upstream} 时回退比较 origin/main；
// ③ 返回 fetchOk / upstreamRef / error 供前端区分「真最新」与「检查失败」。
export async function checkRemote(): Promise<RemoteState> {
  const fetchCode = await runStepQuiet("git fetch --prune");
  const fetchOk = fetchCode === 0;

  // 解析用于比较的上游 ref：优先当前分支跟踪的 @{upstream}，否则回退 origin/main。
  let upstreamRef = await resolveUpstreamRef();

  const countBehind = (ref: string) => new Promise<number>((resolve) => {
    const child = spawn(`git rev-list --count HEAD..${ref}`, { cwd: repoRoot, shell: true, windowsHide: true });
    let out = "";
    child.stdout?.on("data", (b: Buffer) => { out += b.toString("utf8"); });
    child.on("error", () => resolve(-1));
    // rev-list 对未知 ref 会非零退出；用 -1 表示「比较失败」以区别于真正的 0。
    child.on("close", (code) => resolve(code === 0 ? (parseInt(out.trim(), 10) || 0) : -1));
  });

  let behind = await countBehind(upstreamRef);
  // 当前上游比较失败（如 @{upstream} 不存在），回退到 origin/main 再试一次。
  if (behind < 0 && upstreamRef !== "origin/main") {
    upstreamRef = "origin/main";
    behind = await countBehind(upstreamRef);
  }

  const error = !fetchOk
    ? "git fetch 失败：无法连接远程仓库（请检查服务器网络 / GitHub 可达性）"
    : behind < 0
      ? `无法比较版本：未找到上游分支 ${upstreamRef}（请确认部署分支已设置 git 上游跟踪）`
      : null;

  // List pending commit subjects so the admin sees WHAT changed. Prefer non-merge
  // commits (the real feature/fix messages); if that yields nothing (e.g. only
  // merge commits in range), fall back to ALL subjects so the panel is never blank.
  const logSubjects = (extra: string) => new Promise<string[]>((resolve) => {
    const child = spawn(`git log HEAD..${upstreamRef} ${extra} --format=%s --max-count=40`, { cwd: repoRoot, shell: true, windowsHide: true });
    let out = ""; child.stdout?.on("data", (b: Buffer) => { out += b.toString("utf8"); });
    child.on("error", () => resolve([]));
    child.on("close", () => resolve(out.split("\n").map((s) => s.trim()).filter(Boolean)));
  });
  let changes: string[] = [];
  if (behind > 0) {
    changes = await logSubjects("--no-merges");
    if (changes.length === 0) changes = await logSubjects(""); // include merges as a fallback
  }
  changes = changes.map(prettifyChange);
  const latest = changes[0] ?? "";

  return { behind: Math.max(behind, 0), latest, changes, fetchOk, upstreamRef, error, checkedAt: Date.now() };
}

// 把 Conventional-Commit 风格的提交标题美化成中文展示：
// "feat(editor): 文字描边样式" → "【新增】文字描边样式"（去掉 type(scope): 噪声）。
// 非该风格的标题原样返回（已是中文则直接显示）；合并提交标题给个通用标签。
const CC_TYPE_ZH: Record<string, string> = {
  feat: "新增", fix: "修复", perf: "优化", refactor: "重构", style: "样式",
  docs: "文档", build: "构建", chore: "杂项", test: "测试", ci: "流水线", revert: "回退",
};
function prettifyChange(subject: string): string {
  if (/^Merge\b/i.test(subject)) return "【合并】" + subject.replace(/^Merge\s+(pull request|branch)\s*/i, "").trim();
  const m = subject.match(/^(\w+)(?:\([^)]*\))?(!)?:\s*(.+)$/);
  if (!m) return subject;
  const tag = CC_TYPE_ZH[m[1].toLowerCase()] ?? m[1];
  return `【${tag}${m[2] ? "·破坏性" : ""}】${m[3]}`;
}

// 解析当前分支的上游 ref；无跟踪时回退 origin/main。
function resolveUpstreamRef(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}"', { cwd: repoRoot, shell: true, windowsHide: true });
    let out = "";
    child.stdout?.on("data", (b: Buffer) => { out += b.toString("utf8"); });
    child.on("error", () => resolve("origin/main"));
    child.on("close", (code) => {
      const ref = out.trim();
      resolve(code === 0 && ref ? ref : "origin/main");
    });
  });
}

function runStepQuiet(cmd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: repoRoot, shell: true, windowsHide: true, env: process.env });
    child.on("error", () => resolve(-1));
    child.on("close", (code) => resolve(code ?? -1));
  });
}

// ── 远程是否有新版本：带 TTL 缓存，供「红点提醒」频繁查询而不频繁 git fetch ──
export interface RemoteState {
  behind: number;
  latest: string;
  /** Subjects of the pending NON-merge commits (newest first) — the real changelog. */
  changes: string[];
  checkedAt: number;
  /** git fetch 是否成功（false = 网络/远程不可达） */
  fetchOk: boolean;
  /** 实际用于比较的上游 ref（@{upstream} 或回退的 origin/main） */
  upstreamRef: string;
  /** 检查失败原因；null = 检查成功（behind 可信） */
  error: string | null;
}
let remoteCache: RemoteState | null = null;
const REMOTE_TTL = 15 * 60 * 1000; // 15 分钟

export async function getUpdateAvailable(force = false): Promise<RemoteState> {
  const now = Date.now();
  if (!force && remoteCache && now - remoteCache.checkedAt < REMOTE_TTL) return remoteCache;
  try {
    remoteCache = await checkRemote();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 检查本身抛错也要如实上报，而非伪装成「已是最新」。
    remoteCache = { behind: 0, latest: "", changes: [], checkedAt: now, fetchOk: false, upstreamRef: "", error: `检查异常：${msg}` };
  }
  return remoteCache;
}

// 更新成功/已最新后清零红点（避免重启前残留提醒）
function clearRemoteCache() {
  remoteCache = { behind: 0, latest: "", changes: [], checkedAt: Date.now(), fetchOk: true, upstreamRef: "", error: null };
}

// 启动更新（幂等：运行中重复调用直接返回当前状态）
export async function startUpdate(): Promise<{ started: boolean; reason?: string }> {
  if (status.state === "running") return { started: false, reason: "更新已在进行中" };

  status.state = "running";
  status.startedAt = Date.now();
  status.finishedAt = null;
  status.step = "准备中";
  status.log = [];
  status.beforeCommit = null;
  status.afterCommit = null;
  status.willRestart = false;
  status.error = null;

  // 后台异步执行；mutation 立即返回，前端轮询 status
  void (async () => {
    try {
      await mkdir(dirname(logFile), { recursive: true }).catch(() => {});
      await writeFile(logFile, "").catch(() => {}); // 清空旧日志

      status.beforeCommit = await currentCommit();
      pushLog(`当前版本：${status.beforeCommit || "unknown"}`);

      status.step = "拉取最新代码";
      let code = await runStep("git pull --no-edit");
      if (code !== 0) {
        // 与 deploy/update.bat 一致的恢复：丢弃本地 deploy/ 改动后重试
        pushLog("[!] pull 失败，重置本地 deploy/ 改动后重试…");
        await runStep("git merge --abort");
        await runStep("git checkout -- deploy/");
        code = await runStep("git pull --no-edit");
        if (code !== 0) throw new Error("git pull 失败，请检查网络或本地改动");
      }

      status.afterCommit = await currentCommit();
      if (status.afterCommit && status.afterCommit === status.beforeCommit) {
        status.step = "已是最新版本";
        status.state = "uptodate";
        status.finishedAt = Date.now();
        clearRemoteCache();
        pushLog("已是最新版本，无需重启。");
        return;
      }
      pushLog(`已更新到：${status.afterCommit || "unknown"}`);

      status.step = "安装依赖 (pnpm install)";
      if (await runStep("pnpm install") !== 0) throw new Error("pnpm install 失败");

      status.step = "应用数据库迁移 (db:push)";
      if (await runStep("pnpm db:push") !== 0) throw new Error("数据库迁移失败");

      status.step = "构建 (pnpm build)";
      if (await runStep("pnpm build") !== 0) throw new Error("构建失败");

      status.step = "完成";
      status.state = "success";
      status.finishedAt = Date.now();
      clearRemoteCache();

      const isProd = process.env.NODE_ENV === "production";
      if (isProd) {
        status.willRestart = true;
        pushLog("构建完成，1.5 秒后退出进程，由服务(NSSM)/pm2 自动重启以加载新版本…");
        setTimeout(() => process.exit(0), 1500);
      } else {
        pushLog("构建完成（开发模式不自动重启，请手动重启服务以加载新代码）。");
      }
    } catch (e) {
      status.state = "error";
      status.finishedAt = Date.now();
      status.error = e instanceof Error ? e.message : String(e);
      pushLog(`[X] 更新失败：${status.error}`);
    }
  })();

  return { started: true };
}
