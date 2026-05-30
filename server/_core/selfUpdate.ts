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

// 检查远程是否有更新（fetch 后比较落后提交数）
export async function checkRemote(): Promise<{ behind: number; latest: string }> {
  await runStepQuiet("git fetch --prune");
  const behind = await new Promise<number>((resolve) => {
    const child = spawn('git rev-list --count HEAD..@{upstream}', { cwd: repoRoot, shell: true, windowsHide: true });
    let out = ""; child.stdout?.on("data", (b: Buffer) => { out += b.toString("utf8"); });
    child.on("error", () => resolve(0));
    child.on("close", () => resolve(parseInt(out.trim(), 10) || 0));
  });
  const latest = await new Promise<string>((resolve) => {
    const child = spawn('git log -1 --format=%s @{upstream}', { cwd: repoRoot, shell: true, windowsHide: true });
    let out = ""; child.stdout?.on("data", (b: Buffer) => { out += b.toString("utf8"); });
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(out.trim()));
  });
  return { behind, latest };
}

function runStepQuiet(cmd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: repoRoot, shell: true, windowsHide: true, env: process.env });
    child.on("error", () => resolve(-1));
    child.on("close", (code) => resolve(code ?? -1));
  });
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
