import { spawn, type ChildProcess } from "child_process";
import { isIP } from "net";
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
  const named = cfg.token.trim().length > 0;
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
