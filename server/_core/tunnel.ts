import { spawn, type ChildProcess } from "child_process";
import { parseQuickTunnelUrl, tunnelHostFromUrl, type TunnelWhitelist } from "./tunnelGate";
import { getTunnelSettings, setTunnelSettings } from "../db";
import { resolveCloudflaredPath } from "./cloudflaredBin";

// Manages the built-in cloudflared tunnel process + a small cached gate snapshot the
// per-request Express middleware reads synchronously.

let proc: ChildProcess | null = null;
let status: { running: boolean; publicUrl: string; error: string | null } = { running: false, publicUrl: "", error: null };
let logBuf = "";

// Actual local origin cloudflared forwards to — set at server boot to the REAL
// listening port + scheme (the server auto-picks a free port and may run HTTPS with a
// self-signed cert, so a hardcoded http://localhost:3000 causes 502 Bad Gateway).
let origin = { port: Number(process.env.PORT) || 3000, https: false };
export function setTunnelOrigin(port: number, https: boolean): void { origin = { port, https }; }

export function getTunnelRuntimeStatus() { return { running: status.running, publicUrl: status.publicUrl, error: status.error }; }

export async function startTunnel(): Promise<void> {
  if (proc) return;
  const cfg = await getTunnelSettings();
  if (!cfg.runCloudflared) { status = { running: false, publicUrl: cfg.publicUrl, error: null }; return; } // 纯门控模式：不起进程
  const bin = await resolveCloudflaredPath();
  if (!bin) { status = { running: false, publicUrl: "", error: "未检测到 cloudflared，请在「公网隧道」页点「下载 cloudflared」，或改用「我已有公网入口」模式" }; return; }
  const named = cfg.token.trim().length > 0;
  const originUrl = `${origin.https ? "https" : "http"}://localhost:${origin.port}`;
  // Named tunnel: `tunnel run --token` (route configured in CF dashboard → must point to
  // the SAME originUrl). Quick tunnel: `tunnel --url` → we parse the *.trycloudflare.com URL.
  // `--no-tls-verify`: the app's HTTPS uses a self-signed cert, which cloudflared would
  // otherwise reject → 502. Default Host header passthrough is kept so our gate can match it.
  // Named tunnel: origin URL + TLS verify are configured in the Cloudflare dashboard,
  // so we只 pass the token. Quick tunnel: we own the origin → set scheme + no-tls-verify.
  const tlsArgs = origin.https ? ["--no-tls-verify"] : [];
  const args = named ? ["tunnel", "run", "--token", cfg.token.trim()]
                     : ["tunnel", "--no-autoupdate", ...tlsArgs, "--url", originUrl];
  try {
    proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
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
      if (url && url !== status.publicUrl) { status.publicUrl = url; void setTunnelSettings({ publicUrl: url }).then(reloadTunnelGate); }
    }
  };
  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", onData);
  proc.on("exit", (code) => { status = { running: false, publicUrl: status.publicUrl, error: code ? `cloudflared 已退出 (code ${code})` : null }; proc = null; void reloadTunnelGate(); });
  proc.on("error", (e) => { status = { running: false, publicUrl: "", error: "cloudflared 启动失败：" + e.message }; proc = null; });
}

export function stopTunnel(): void {
  if (proc) { try { proc.kill("SIGTERM"); } catch { /* ignore */ } proc = null; }
  status = { running: false, publicUrl: status.publicUrl, error: null };
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
