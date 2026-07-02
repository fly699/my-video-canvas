import { spawn, type ChildProcess } from "child_process";
import { isIP, type Socket } from "net";
import { parseQuickTunnelUrl, tunnelHostFromUrl, type TunnelWhitelist } from "./tunnelGate";
import { getTunnelSettings, setTunnelSettings } from "../db";
import { resolveCloudflaredPath } from "./cloudflaredBin";
import { sendTunnelUrlEmail } from "./tunnelEmail";
import { removeTunnelRoutes } from "./tunnelRoute";

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
  return pick.slice(-500);
}

export async function startTunnel(): Promise<void> {
  if (proc) return;
  const cfg = await getTunnelSettings();
  if (!cfg.runCloudflared) { status = { running: false, publicUrl: cfg.publicUrl, error: null }; return; } // 纯门控模式：不起进程
  const bin = await resolveCloudflaredPath();
  if (!bin) { status = { running: false, publicUrl: "", error: "未检测到 cloudflared，请在「公网隧道」页点「下载 cloudflared」，或改用「我已有公网入口」模式" }; return; }
  if (!tunnelPort) { status = { running: false, publicUrl: "", error: "隧道内部回环监听未就绪，请稍后重试" }; return; }
  // 命名隧道 = 存了 Token 且未选「临时改走快速隧道」。preferQuick 让 Token 保留着也能跑快速隧道，
  // 切回命名隧道无需重新粘贴 Token。
  const named = cfg.token.trim().length > 0 && !cfg.preferQuick;
  // Quick tunnel forwards to our dedicated loopback listener (plain HTTP → no 502 from
  // self-signed TLS). Named tunnel's origin is configured in the CF dashboard — point it
  // at http://localhost:<this port> (shown in the admin UI).
  const args = named ? ["tunnel", "run", "--token", cfg.token.trim()]
                     : ["tunnel", "--no-autoupdate", "--url", `http://localhost:${tunnelPort}`];
  // 出口专线绑定：把 cloudflared 到 Cloudflare 边缘的出站源 IP 绑定到指定线路的源 IP。仅接受合法 IP。
  const bindIp = (cfg.edgeBindAddress ?? "").trim();
  if (bindIp && isIP(bindIp)) args.push("--edge-bind-address", bindIp);
  try {
    // windowsHide：Windows 上不弹出 cloudflared 的控制台黑窗（否则用户很容易误手关掉窗口，
    // 连带把隧道进程杀掉）。stdout/stderr 仍通过管道进 logBuf，日志照收不误。
    proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  } catch {
    status = { running: false, publicUrl: "", error: "无法启动 cloudflared" };
    return;
  }
  status = { running: true, publicUrl: named ? cfg.publicUrl : "", error: null };
  logBuf = "";
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

/** Start at boot if it was left enabled. */
export async function initTunnel(): Promise<void> {
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
