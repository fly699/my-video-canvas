import { spawn, type ChildProcess } from "child_process";
import { isIP } from "net";
import { applyTunnelRoutes, removeTunnelRoutes } from "./tunnelRoute";
import { parseQuickTunnelUrl, tunnelHostFromUrl, type TunnelWhitelist } from "./tunnelGate";
import { getTunnelSettings, setTunnelSettings } from "../db";
import { resolveCloudflaredPath } from "./cloudflaredBin";
import { sendTunnelUrlEmail } from "./tunnelEmail";

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
let routedIp: string | null = null; // 已为哪个专线源 IP 加了 CF 边缘路由（停用时据此删除）

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

/** 组装 cloudflared 启动参数。
 *  Quick tunnel 转发到本机专用回环监听（纯 HTTP → 避免自签 TLS 502）；Named tunnel 的回源在 CF
 *  面板配到 http://localhost:<回环端口>。
 *  出口专线绑定 --edge-bind-address 是 `tunnel` 命令层的**全局**参数，必须放在子命令 `run` 之前
 *  ——否则命名隧道会把它落到 `run` 后面被拒/忽略，导致「一绑就连不上」（快速隧道因无子命令而侥幸可用）。
 *  绑定后 cloudflared 到 Cloudflare 边缘的出站源 IP 固定为该地址，从而走指定专线（还需 OS 路由把该
 *  源/边缘网段导向对应线路的网关）。仅接受合法 IP。 */
export function buildCloudflaredArgs(named: boolean, token: string, tunnelPort: number, edgeBindAddress: string): string[] {
  const bindIp = (edgeBindAddress ?? "").trim();
  const edge = bindIp && isIP(bindIp) ? ["--edge-bind-address", bindIp] : [];
  return named
    ? ["tunnel", ...edge, "run", "--token", token.trim()]
    : ["tunnel", ...edge, "--no-autoupdate", "--url", `http://localhost:${tunnelPort}`];
}

export async function startTunnel(): Promise<void> {
  if (proc) return;
  const cfg = await getTunnelSettings();
  if (!cfg.runCloudflared) { status = { running: false, publicUrl: cfg.publicUrl, error: null }; return; } // 纯门控模式：不起进程
  const bin = await resolveCloudflaredPath();
  if (!bin) { status = { running: false, publicUrl: "", error: "未检测到 cloudflared，请在「公网隧道」页点「下载 cloudflared」，或改用「我已有公网入口」模式" }; return; }
  if (!tunnelPort) { status = { running: false, publicUrl: "", error: "隧道内部回环监听未就绪，请稍后重试" }; return; }
  const named = cfg.token.trim().length > 0;
  const args = buildCloudflaredArgs(named, cfg.token.trim(), tunnelPort, cfg.edgeBindAddress ?? "");
  // 出口专线绑定「双保险」：cloudflared 的旗标几乎都能用环境变量设置，且环境变量对进程全局生效、
  // 命名/快速隧道都吃、与命令行参数位置无关。之前「快速隧道能绑、命名隧道不吃」大概率是 --edge-bind-address
  // 参数在 run 子命令层级上没被命名隧道读取；改用 TUNNEL_EDGE_BIND_ADDRESS 环境变量即可绕开位置问题。
  // 参数仍保留（快速隧道已验证有效），二者叠加，哪个生效都行。
  const bindIp = (cfg.edgeBindAddress ?? "").trim();
  const env = bindIp && isIP(bindIp) ? { ...process.env, TUNNEL_EDGE_BIND_ADDRESS: bindIp } : process.env;
  try {
    // windowsHide：Windows 上不弹出 cloudflared 的控制台黑窗（否则用户很容易误手关掉窗口，
    // 连带把隧道进程杀掉）。stdout/stderr 仍通过管道进 logBuf，日志照收不误。
    proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env });
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
  // 出口专线：命名隧道不吃 --edge-bind-address，改用 OS 路由把 CF 边缘网段导向该专线网关（自动探测），
  // 让「隧道→边缘」的流量走这条专线；其余出站仍走默认路由。app 自己执行（需以管理员运行；失败会在
  // 日志里给出手动命令）。启用时加、停用时删。
  if (bindIp && isIP(bindIp)) {
    routedIp = bindIp;
    void applyTunnelRoutes(bindIp).then((r) => { logBuf = (logBuf + "\n" + r.log + "\n").slice(-8000); });
  }
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
  if (routedIp) { const ip = routedIp; routedIp = null; void removeTunnelRoutes(ip).then((log) => { logBuf = (logBuf + "\n" + log + "\n").slice(-8000); }); }
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
