import { exec } from "child_process";
import { promisify } from "util";
import { isIP } from "net";

const pexec = promisify(exec);

// Cloudflare Tunnel 的边缘出口网段（cloudflared 实际连的 IP，见运行日志里的 198.41.x）。
// 把这两段路由到指定专线网关，即可让「隧道 → Cloudflare 边缘」的流量走那条专线；
// 其余出站仍走系统默认路由（另一条专线）。只动这两段，绝不碰默认路由。
export const CF_EDGE_ROUTES = [
  { net: "198.41.192.0", mask: "255.255.255.0", prefix: "198.41.192.0/24" },
  { net: "198.41.200.0", mask: "255.255.255.0", prefix: "198.41.200.0/24" },
] as const;

/** 生成给用户手动执行的命令（app 没有管理员权限、或想自己跑时用）。 */
export function manualRouteCommands(gateway: string): string {
  if (process.platform === "win32") {
    return CF_EDGE_ROUTES.map((r) => `route -p add ${r.net} mask ${r.mask} ${gateway} metric 5`).join("\r\n");
  }
  return CF_EDGE_ROUTES.map((r) => `ip route replace ${r.prefix} via ${gateway}`).join("\n");
}

/** 由「专线的本机源 IP」反查其所属网卡的默认网关（route add 的下一跳）。探测失败返回 null。 */
export async function detectGatewayForSource(sourceIp: string): Promise<string | null> {
  if (!isIP(sourceIp)) return null;
  try {
    if (process.platform === "win32") {
      // 源IP → InterfaceIndex → 该网卡默认路由(0.0.0.0/0)的 NextHop（即网关）
      const ps = `$ErrorActionPreference='Stop'; $i=(Get-NetIPAddress -IPAddress '${sourceIp}').InterfaceIndex; (Get-NetRoute -InterfaceIndex $i -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1 -ExpandProperty NextHop)`;
      const { stdout } = await pexec(`powershell -NoProfile -NonInteractive -Command "${ps}"`, { timeout: 15000, windowsHide: true });
      const gw = stdout.trim();
      return isIP(gw) ? gw : null;
    }
    // Linux：源IP所在网卡 → 该网卡默认路由网关
    const { stdout: dev } = await pexec(`ip -o -4 addr show | awk '$4 ~ /^${sourceIp}\\// {print $2; exit}'`, { timeout: 10000 });
    const iface = dev.trim();
    if (!iface) return null;
    const { stdout } = await pexec(`ip route show default dev ${iface}`, { timeout: 10000 });
    const m = stdout.match(/default via (\d+\.\d+\.\d+\.\d+)/);
    return m && isIP(m[1]) ? m[1] : null;
  } catch { return null; }
}

async function runRoute(action: "add" | "del", r: typeof CF_EDGE_ROUTES[number], gateway: string): Promise<string> {
  const cmd = process.platform === "win32"
    ? (action === "add" ? `route add ${r.net} mask ${r.mask} ${gateway} metric 5` : `route delete ${r.net}`)
    : (action === "add" ? `ip route replace ${r.prefix} via ${gateway}` : `ip route del ${r.prefix} via ${gateway}`);
  try {
    const { stdout, stderr } = await pexec(cmd, { timeout: 15000, windowsHide: true, encoding: "utf8" });
    return `$ ${cmd}\n  ${(stdout || stderr || "OK").trim().replace(/\r?\n/g, " ")}`;
  } catch (e) {
    return `$ ${cmd}\n  [失败] ${(e as Error).message.slice(0, 160).replace(/\r?\n/g, " ")}`;
  }
}

/** 应用专线路由：把 CF 边缘两段指到「源 IP 所属网卡的默认网关」。返回可读日志（含手动命令兜底）。 */
export async function applyTunnelRoutes(sourceIp: string): Promise<{ ok: boolean; gateway: string | null; log: string }> {
  if (!isIP(sourceIp)) return { ok: false, gateway: null, log: "出口专线绑定不是合法 IP，跳过路由" };
  const gw = await detectGatewayForSource(sourceIp);
  if (!gw) return { ok: false, gateway: null, log: `未能自动探测 ${sourceIp} 所属网卡的默认网关（该网卡可能没配网关，或需管理员权限）。可手动在管理员终端执行：\n${manualRouteCommands("<该专线网关IP>")}` };
  const lines = [`[路由] 专线源 ${sourceIp} → 网关 ${gw}，把 CF 边缘网段导向该专线：`];
  for (const r of CF_EDGE_ROUTES) lines.push(await runRoute("add", r, gw));
  const ok = !lines.some((l) => l.includes("[失败]"));
  if (!ok) lines.push(`（若报「拒绝访问/需要提升」，说明本服务未以管理员运行。请以管理员手动执行：\n${manualRouteCommands(gw)}）`);
  return { ok, gateway: gw, log: lines.join("\n") };
}

/** 移除专线路由（停用/清空绑定时）。best-effort。 */
export async function removeTunnelRoutes(sourceIp: string): Promise<string> {
  const gw = (await detectGatewayForSource(sourceIp)) || "";
  const lines = ["[路由] 移除 CF 边缘专线路由："];
  for (const r of CF_EDGE_ROUTES) lines.push(await runRoute("del", r, gw));
  return lines.join("\n");
}
