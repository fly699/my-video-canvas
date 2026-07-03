import { spawn, execFile, type ChildProcess } from "child_process";
import { isIP, type Socket } from "net";
import { parseQuickTunnelUrl, tunnelHostFromUrl, type TunnelWhitelist } from "./tunnelGate";
import { getTunnelSettings, setTunnelSettings } from "../db";
import { resolveCloudflaredPath } from "./cloudflaredBin";
import { sendTunnelUrlEmail } from "./tunnelEmail";
import { applyTunnelRoutes, removeTunnelRoutes } from "./tunnelRoute";

// Email the new public URL once per distinct URL (quick tunnels change on restart).
let lastEmailedUrl = "";
async function notifyNewUrl(url: string): Promise<void> {
  if (!url || url === lastEmailedUrl) return;
  lastEmailedUrl = url;
  try {
    const cfg = await getTunnelSettings();
    if (cfg.emailNotify.to.trim() && cfg.emailNotify.host.trim()) {
      const r = await sendTunnelUrlEmail(cfg.emailNotify, url);
      if (!r.ok) console.warn("[Tunnel] 新地址邮件发送失败:", r.error);
    }
  } catch (e) { console.warn("[Tunnel] notifyNewUrl error:", (e as Error).message); }
}

// Manages the built-in cloudflared tunnel process + a small cached gate snapshot the
// per-request Express middleware reads synchronously.

let proc: ChildProcess | null = null;
let status: { running: boolean; publicUrl: string; error: string | null } = { running: false, publicUrl: "", error: null };
let logBuf = "";

// Dedicated loopback port cloudflared forwards to. A request whose socket.localPort
// equals this is UNAMBIGUOUSLY tunnel traffic (no header guessing). Plain HTTP on
// 127.0.0.1, so the app's self-signed HTTPS never causes a 502 on the tunnel path.
let tunnelPort = 0;
export function setTunnelOrigin(port: number): void { tunnelPort = port; }
export function getTunnelListenerPort(): number { return tunnelPort; }
/** cloudflared 子进程 PID（供「一键诊断」查它实际在用哪块网卡/源 IP）。未运行返回 null。 */
export function getTunnelPid(): number | null { return proc?.pid ?? null; }

// ── 隧道实时吞吐计量（被动，零额外流量）──
// 所有经隧道进来的用户流量都只经过回环监听器（index.ts 的 tunnelServer）。在其每条 socket 上读
// Node 自动维护的 bytesRead/bytesWritten 求增量，即得真实用户经隧道的实时速率。注意方向：
// 服务器 bytesWritten = 发给 cloudflared = 用户【下行】；bytesRead = 收自 cloudflared = 用户【上行】。
const liveSockets = new Set<Socket>();
let closedDown = 0, closedUp = 0;              // 已关闭 socket 累计的字节（避免关闭即丢失）
let lastTotalDown = 0, lastTotalUp = 0, lastSampleAt = 0;
let downBps = 0, upBps = 0, peakDownBps = 0, peakUpBps = 0;
let sampler: NodeJS.Timeout | null = null;

function currentTotals(): { down: number; up: number } {
  let down = closedDown, up = closedUp;
  liveSockets.forEach((s) => { down += s.bytesWritten; up += s.bytesRead; });
  return { down, up };
}

function sampleThroughput(): void {
  const now = Date.now();
  const { down, up } = currentTotals();
  if (lastSampleAt) {
    const dt = (now - lastSampleAt) / 1000;
    if (dt > 0) {
      downBps = Math.max(0, (down - lastTotalDown) / dt);
      upBps = Math.max(0, (up - lastTotalUp) / dt);
      if (downBps > peakDownBps) peakDownBps = downBps;
      if (upBps > peakUpBps) peakUpBps = upBps;
    }
  }
  lastSampleAt = now; lastTotalDown = down; lastTotalUp = up;
}

/** 注册一条经隧道回环监听器进来的连接（index.ts 在 tunnelServer 的 'connection' 事件上调用）。 */
export function trackTunnelSocket(sock: Socket): void {
  liveSockets.add(sock);
  sock.once("close", () => { closedDown += sock.bytesWritten; closedUp += sock.bytesRead; liveSockets.delete(sock); });
  if (!sampler) {
    const t = currentTotals(); lastTotalDown = t.down; lastTotalUp = t.up; lastSampleAt = Date.now();
    sampler = setInterval(sampleThroughput, 1000);
    sampler.unref?.(); // 别让计量定时器拖住进程退出
  }
}

/** 隧道实时吞吐快照（供管理面板显示「用户经隧道的实时网速」）。bps=字节/秒。 */
export function getTunnelThroughput(): { downBps: number; upBps: number; connections: number; totalDown: number; totalUp: number; peakDownBps: number; peakUpBps: number } {
  const { down, up } = currentTotals();
  return { downBps, upBps, connections: liveSockets.size, totalDown: down, totalUp: up, peakDownBps, peakUpBps };
}

export function getTunnelRuntimeStatus() { return { running: status.running, publicUrl: status.publicUrl, error: status.error }; }

/** cloudflared 最近日志尾部（供管理面板排错）。 */
export function getTunnelLog(): string { return logBuf.slice(-4000); }

/** 从 cloudflared 日志里挑出最能说明退出原因的几行（错误/失败/未知参数…）；没有则取末尾几行。 */
export function tunnelErrorHint(log: string): string {
  const lines = log.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const KW = /(err|error|fail|failed|unknown flag|invalid|refused|no such|not found|cannot|unable|bind|permission|denied)/i;
  const hits = lines.filter((l) => KW.test(l)).slice(-3);
  const pick = (hits.length ? hits : lines.slice(-3)).join(" ⏎ ");
  const base = pick.slice(-500);
  // 针对最常见的「出口专线绑定填了非本机网卡 IP」给一句人话提示（现已在保存时防呆，此为兜底）。
  if (/invalid edge-bind-address|not valid in its context/i.test(log)) {
    return base + " ⏎ 提示：出口专线绑定填的 IP 不是本机网卡地址，请改填本机某网卡源 IP，或清空改用默认线路。";
  }
  return base;
}

/** 构造 cloudflared 启动参数（纯函数，便于单测/防回归）。
 *  - 快速隧道：`tunnel --no-autoupdate --url http://localhost:<port> [--edge-bind-address <IP>]`。
 *  - 命名隧道：`tunnel [--edge-bind-address <IP>] run --token <TOKEN>`。
 *  出口专线绑定 `--edge-bind-address <IP>` 是 **`cloudflared tunnel` 子命令级**的 flag（临时隧道
 *  `tunnel --url … --edge-bind-address` 即此层级、实测生效）。命名隧道必须把它放在 `run` **之前**——
 *  实测本版 cloudflared 的 `run` 子命令**不认**放在其后的该 flag，会打印 usage 直接退出（回源 530）。
 *  IP 必须是本机某网卡地址（admin.setConfig 的 isLocalInterfaceIp 已校验）。 */
export function buildTunnelArgs(opts: { named: boolean; token: string; tunnelPort: number; bindIp: string }): string[] {
  const { named, token, tunnelPort, bindIp } = opts;
  const ip = (bindIp ?? "").trim();
  const bind = ip && isIP(ip) ? ["--edge-bind-address", ip] : [];
  return named
    ? ["tunnel", ...bind, "run", "--token", token.trim()]                                   // edge-bind 放在 run 之前
    : ["tunnel", "--no-autoupdate", "--url", `http://localhost:${tunnelPort}`, ...bind];
}

/** 杀掉遗留的 cloudflared 进程。应用每次重启（node 进程重启）都会把上一个 cloudflared 子进程留成
 *  **孤儿**——它仍用旧连接（旧线路，多为默认线 Intel）挂着同一个 token。于是 CF 连接器里堆出一大堆
 *  连接器，且旧孤儿一直在 Intel 上：无论我们怎么改路由/绑定，CF 显示的都是那个孤儿的源 IP，与新进程无关
 *  （这正是「路由已改、CF 仍显示默认线」的真凶）。故启动新 cloudflared 前先清干净，保证 CF 只看到我们
 *  这一个受路由/绑定管控的连接器。本应用独占管理内置 cloudflared，直接按进程名清理。 */
function killStrayCloudflared(): Promise<void> {
  return new Promise((resolve) => {
    const win = process.platform === "win32";
    const cmd = win ? "taskkill" : "pkill";
    const args = win ? ["/F", "/IM", "cloudflared.exe"] : ["-x", "cloudflared"];
    try { execFile(cmd, args, { windowsHide: true, timeout: 8000 }, () => resolve()); }
    catch { resolve(); }
  });
}

export async function startTunnel(): Promise<void> {
  if (proc) return;
  // 先清理上次残留的 cloudflared 孤儿进程，避免 CF 连接器里出现多个、旧的挂在默认线导致「改了没用」。
  await killStrayCloudflared();
  const cfg = await getTunnelSettings();
  if (!cfg.runCloudflared) { status = { running: false, publicUrl: cfg.publicUrl, error: null }; return; } // 纯门控模式：不起进程
  const bin = await resolveCloudflaredPath();
  if (!bin) { status = { running: false, publicUrl: "", error: "未检测到 cloudflared，请在「公网隧道」页点「下载 cloudflared」，或改用「我已有公网入口」模式" }; return; }
  if (!tunnelPort) { status = { running: false, publicUrl: "", error: "隧道内部回环监听未就绪，请稍后重试" }; return; }
  // 命名隧道 = 存了 Token 且未选「临时改走快速隧道」。preferQuick 让 Token 保留着也能跑快速隧道，
  // 切回命名隧道无需重新粘贴 Token。
  const named = cfg.token.trim().length > 0 && !cfg.preferQuick;
  const bindIp = (cfg.edgeBindAddress ?? "").trim();
  // 出口专线走线，两种隧道机制不同：
  //  - 快速隧道：`--edge-bind-address` 绑源 IP（buildTunnelArgs 已带上），无需管理员，实测生效。
  //  - 命名隧道：实测本版 cloudflared 的 `run` 路径**接受但不应用** edge-bind（连得上但不绑），故命名隧道
  //    只能靠 OS 路由——把 CF 边缘段钉到「出口专线绑定」源 IP 的网卡。**启动前**就位（cloudflared 一连
  //    就走对线，已建连不会随后加的路由迁移）。需管理员；非管理员则失败记入日志、不阻断启动。
  let autoRouteLog = "";
  if (named && bindIp && isIP(bindIp)) {
    try { const r = await applyTunnelRoutes(bindIp, undefined, ""); autoRouteLog = "[自动专线路由] " + r.log + "\n"; }
    catch (e) { autoRouteLog = "[自动专线路由] 失败：" + (e as Error).message + "\n"; }
  }
  const args = buildTunnelArgs({ named, token: cfg.token, tunnelPort, bindIp });
  try {
    // windowsHide：Windows 上不弹出 cloudflared 的控制台黑窗（否则用户很容易误手关掉窗口，
    // 连带把隧道进程杀掉）。stdout/stderr 仍通过管道进 logBuf，日志照收不误。
    proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  } catch {
    status = { running: false, publicUrl: "", error: "无法启动 cloudflared" };
    return;
  }
  status = { running: true, publicUrl: named ? cfg.publicUrl : "", error: null };
  logBuf = autoRouteLog;
  const onData = (d: Buffer) => {
    logBuf = (logBuf + d.toString()).slice(-8000);
    if (!named) {
      const url = parseQuickTunnelUrl(logBuf);
      if (url && url !== status.publicUrl) { status.publicUrl = url; void setTunnelSettings({ publicUrl: url }).then(reloadTunnelGate); void notifyNewUrl(url); }
    }
  };
  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", onData);
  proc.on("exit", (code) => {
    const hint = code ? tunnelErrorHint(logBuf) : "";
    status = { running: false, publicUrl: status.publicUrl, error: code ? `cloudflared 已退出 (code ${code})${hint ? "：" + hint : ""}` : null };
    proc = null; void reloadTunnelGate();
  });
  proc.on("error", (e) => { status = { running: false, publicUrl: "", error: "cloudflared 启动失败：" + e.message }; proc = null; });
}

export function stopTunnel(): void {
  if (proc) { try { proc.kill("SIGTERM"); } catch { /* ignore */ } proc = null; }
  status = { running: false, publicUrl: status.publicUrl, error: null };
  // 自动回退到非专线：隧道关闭后，若曾配置「出口专线绑定」，一并移除为命名隧道加的 CF 边缘专线路由，
  // 让出站恢复系统默认线路（best-effort、幂等；从未加过路由则为无害空操作）。
  void autoRevertProLineRoutes();
}

/** 隧道停用时自动移除专线路由（关闭专线 → 回退默认线路）。仅在曾配置「出口专线绑定」时才动路由。 */
async function autoRevertProLineRoutes(): Promise<void> {
  try {
    const cfg = await getTunnelSettings();
    if (!(cfg.edgeBindAddress ?? "").trim()) return; // 从未用专线 → 不碰路由表
    const r = await removeTunnelRoutes(getTunnelLog());
    logBuf = (logBuf + "\n[自动回退] " + r.log).slice(-8000);
  } catch (e) { console.warn("[Tunnel] 自动移除专线路由失败:", (e as Error).message); }
}

/** Apply the admin's enable/disable: persist + start or stop the process + refresh gate. */
export async function applyTunnelEnabled(enabled: boolean): Promise<void> {
  await setTunnelSettings({ enabled });
  if (enabled) await startTunnel(); else stopTunnel();
  await reloadTunnelGate();
}

let cleanupHooked = false;
/** 应用退出时杀掉自己的 cloudflared 子进程，避免留成孤儿（否则重启后 CF 连接器里越堆越多、旧的挂默认线）。 */
function hookProcessCleanup(): void {
  if (cleanupHooked) return;
  cleanupHooked = true;
  const killChild = () => { if (proc) { try { proc.kill("SIGKILL"); } catch { /* ignore */ } proc = null; } };
  process.once("exit", killChild);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => { killChild(); process.exit(0); });
  }
}

/** Start at boot if it was left enabled. */
export async function initTunnel(): Promise<void> {
  hookProcessCleanup();
  // 开机先清一次遗留的 cloudflared 孤儿（上次异常退出可能留下），再按需拉起，保证只有一个连接器。
  await killStrayCloudflared();
  try { const cfg = await getTunnelSettings(); if (cfg.enabled) await startTunnel(); await reloadTunnelGate(); } catch { /* non-fatal */ }
}

// ── Cached gate snapshot (sync access for the per-request middleware) ──
let gate: { enabled: boolean; host: string; wl: TunnelWhitelist } = { enabled: false, host: "", wl: { users: [], ips: [] } };
let gateAt = 0;
const GATE_TTL = 15_000;

export async function reloadTunnelGate(): Promise<void> {
  try {
    const c = await getTunnelSettings();
    gate = { enabled: c.enabled, host: tunnelHostFromUrl(status.publicUrl || c.publicUrl), wl: { users: c.whitelistUsers, ips: c.whitelistIps } };
    gateAt = Date.now();
  } catch { /* keep last */ }
}

/** Sync gate snapshot for the request middleware (background-refreshed). */
export function getTunnelGate(): { enabled: boolean; host: string; wl: TunnelWhitelist } {
  if (Date.now() - gateAt > GATE_TTL) void reloadTunnelGate();
  return gate;
}
