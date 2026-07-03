import { exec } from "child_process";
import { promisify } from "util";
import { isIP } from "net";
import { networkInterfaces } from "os";
import { get as httpsGet } from "https";

const pexec = promisify(exec);

/** 解析 Cloudflare `/cdn-cgi/trace` 响应里的 `ip=` 行（即 Cloudflare 看到的本机公网出口 IP）。纯函数、便于单测。 */
export function parseTraceIp(body: string): string | null {
  const m = /(?:^|\n)\s*ip=([0-9a-fA-F:.]+)/.exec(body || "");
  return m && isIP(m[1]) ? m[1] : null;
}

/** 实测某条线路的「公网出口 IP」：绑定该线路本机源 IP 去访问 Cloudflare trace，返回 CF 看到的公网 IP
 *  （与 CF 连接器面板显示的源 IP 对齐）。localAddress 为空 = 走系统默认路由那条线。失败/超时返回 null。 */
export function fetchPublicEgressIp(localAddress?: string, timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    const opts: Record<string, unknown> = { hostname: "www.cloudflare.com", path: "/cdn-cgi/trace", timeout: timeoutMs, headers: { "user-agent": "avc-egress-check" } };
    if (localAddress && isIP(localAddress)) opts.localAddress = localAddress;
    let done = false;
    const finish = (v: string | null) => { if (!done) { done = true; resolve(v); } };
    const req = httpsGet(opts, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => { body += c.toString(); if (body.length > 8192) req.destroy(); });
      res.on("end", () => finish(parseTraceIp(body)));
      res.on("error", () => finish(null));
    });
    req.on("error", () => finish(null));
    req.on("timeout", () => { req.destroy(); finish(null); });
  });
}

/** 本机所有网卡的非内部（排除回环）IP。用于「出口专线绑定」防呆：edge-bind 必须是本机某网卡地址，
 *  否则 cloudflared 绑定出网会报 "The requested address is not valid in its context" 而整个隧道起不来。 */
export function localInterfaceIps(): { v4: string[]; v6: string[] } {
  const nets = networkInterfaces();
  const v4 = new Set<string>(), v6 = new Set<string>();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] ?? []) {
      if (ni.internal) continue;
      const fam = String(ni.family); // Node 18/22 为 "IPv4"/"IPv6"；个别版本为 4/6
      if (fam === "IPv4" || fam === "4") v4.add(ni.address);
      else if (fam === "IPv6" || fam === "6") v6.add(ni.address.split("%")[0]);
    }
  }
  return { v4: Array.from(v4), v6: Array.from(v6) };
}

/** 给定 IP 是否为本机某网卡地址（IPv6 忽略 %zone 与大小写）。 */
export function isLocalInterfaceIp(ip: string): boolean {
  const { v4, v6 } = localInterfaceIps();
  const norm = ip.split("%")[0].toLowerCase();
  return v4.includes(ip) || v6.some((a) => a.toLowerCase() === norm);
}

/**
 * 专线路由：让「命名隧道」真正走指定上行专线。
 *
 * 背景 —— cloudflared 的 token 命名隧道不应用 `--edge-bind-address`（实测：命令行前置/后置、
 * 环境变量都无效），所以「让命名隧道走某条专线」不能靠 cloudflared，只能在**操作系统路由层**做：
 * 「一个包从哪条线出去」是路由表决定的。给「Cloudflare 边缘那几段 IP」单独加一条更精确的路由、
 * 指向专线 A 的网关，就能让 cloudflared→边缘的流量走 A，其余出站仍走系统默认路由（另一条线）。
 *
 * 设计原则（务必守住）：
 *  1. 只动 CF 边缘那几段 /24，**绝不碰默认路由 0.0.0.0/::**（填错网关最多这几段不通，删掉即恢复，
 *     不会把整机网络断掉）。
 *  2. 自适应：除内置网段，还从 cloudflared 运行日志解析它实际连的边缘 IP，CF 换段也能覆盖。
 *  3. 幂等可逆：重复应用不报错；移除按目的网段删（不依赖网关）。
 *  4. 优雅降级：无管理员权限 / 探测不到网关时，不硬改，改为返回「可手动执行的命令」兜底。
 *  5. 防注入：所有 IP 一律 isIP 校验，网段是常量，绝不把未校验字符串拼进命令。
 */

/** Cloudflare Tunnel 边缘出口网段（cloudflared 连的 IP，见运行日志 198.41.x；也是 CF 文档公开的隧道网段）。 */
export const CF_EDGE_ROUTES = [
  { net: "198.41.192.0", mask: "255.255.255.0", prefix: "198.41.192.0/24" },
  { net: "198.41.200.0", mask: "255.255.255.0", prefix: "198.41.200.0/24" },
] as const;

type Cidr = { net: string; mask: string; prefix: string };

/** 安全护栏：任何要下命令的网段都必须是「非默认路由」且合法 IPv4 网段。挡住 0.0.0.0 / 空 / 非法。 */
function isSafeIpv4Net(net: string): boolean {
  return isIP(net) === 4 && net !== "0.0.0.0";
}

/** 是否落在 Cloudflare 隧道边缘块 198.41.192.0/20（含 198.41.192.0/24 与 198.41.200.0/24）。
 *  只把此块内的边缘 IP 纳入路由——确保「应用路由只针对隧道、绝不误伤局域网/其它流量」：
 *  即便 cloudflared 日志里混进任何非 CF 的 IP，也不会被拿去加路由。 */
function inCloudflareEdgeBlock(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const p = ip.split(".").map(Number);
  return p[0] === 198 && p[1] === 41 && p[2] >= 192 && p[2] <= 207;
}

/** 从 cloudflared 日志里取第一个它实际连的边缘 IP（v4/v6 皆可）。没有则 null。 */
function firstEdgeIpFromLog(log: string): string | null {
  const re = /\bip=([0-9a-fA-F:.]+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log || "")) !== null) { if (isIP(m[1])) return m[1]; }
  return null;
}

/** 某个 IP 属于本机哪块网卡（名字）。找不到返回 null（IPv6 忽略 %zone 与大小写）。 */
function ifaceForIp(ip: string): string | null {
  const nets = networkInterfaces();
  const norm = ip.split("%")[0].toLowerCase();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] ?? []) {
      if (!ni.internal && ni.address.split("%")[0].toLowerCase() === norm) return name;
    }
  }
  return null;
}

export interface EgressInfo {
  sourceIp: string | null;   // 隧道出站实际所用源 IP
  iface: string | null;      // 对应网卡名
  via: "bind" | "route" | "unknown"; // bind=靠 edge-bind 绑定；route=内核选路结果
  dest: string;              // 探测用的 CF 边缘目的 IP
  detail: string;
}

/** 判定「隧道流量实际从哪张网卡/哪个源 IP 出去」。
 *  - 快速隧道且绑定了 edge-bind：cloudflared 把出站源绑到该 IP（bind 覆盖选路）→ 源 IP 即绑定 IP。
 *  - 其余（命名隧道 / 未绑定的快速隧道）：问内核去 CF 边缘该走哪块网卡、哪个源 IP；
 *    命名隧道 + 专线路由也据此如实反映（我们加的路由会被内核选中）。 */
export async function tunnelEgressInfo(edgeBindIp: string, isQuick: boolean, log = ""): Promise<EgressInfo> {
  const dest = firstEdgeIpFromLog(log) ?? "198.41.192.227"; // 优先用日志里真实边缘 IP，否则内置代表 IP
  if (isQuick && edgeBindIp && isIP(edgeBindIp)) {
    return { sourceIp: edgeBindIp, iface: ifaceForIp(edgeBindIp), via: "bind", dest, detail: "快速隧道 --edge-bind-address 绑定" };
  }
  try {
    if (process.platform === "win32") {
      const ps = `$ErrorActionPreference='Stop'; $r=Find-NetRoute -RemoteIPAddress '${dest}' | Select-Object -First 1; $n=(Get-NetAdapter -InterfaceIndex $r.InterfaceIndex -ErrorAction SilentlyContinue).Name; Write-Output ($r.IPAddress + '|' + $n)`;
      const { stdout } = await pexec(`powershell -NoProfile -NonInteractive -Command "${ps}"`, { timeout: 15000, windowsHide: true, encoding: "utf8" });
      const [src, name] = stdout.trim().split("|");
      return { sourceIp: isIP(src) ? src : null, iface: name || null, via: "route", dest, detail: "内核选路（Find-NetRoute）" };
    }
    const { stdout } = await pexec(`ip route get ${dest}`, { timeout: 10000, encoding: "utf8" });
    const src = stdout.match(/\bsrc\s+([0-9a-fA-F:.]+)/)?.[1] ?? "";
    const dev = stdout.match(/\bdev\s+(\S+)/)?.[1] ?? null;
    return { sourceIp: isIP(src) ? src : null, iface: dev, via: "route", dest, detail: "内核选路（ip route get）" };
  } catch (e) {
    return { sourceIp: null, iface: null, via: "unknown", dest, detail: "探测失败：" + (e as Error).message.slice(0, 120) };
  }
}

/** 从 cloudflared 日志里解析它实际连接的边缘 IPv4，收敛为 /24 网段，与内置网段合并去重。
 *  这样即便 Cloudflare 用了内置两段以外的边缘，也能被覆盖到（自适应）。 */
export function edgeCidrsFromLog(log: string): Cidr[] {
  const out = new Map<string, Cidr>();
  for (const c of CF_EDGE_ROUTES) out.set(c.prefix, c);
  const re = /\bip=(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log || "")) !== null) {
    const ip = m[1];
    if (isIP(ip) !== 4) continue;
    if (!inCloudflareEdgeBlock(ip)) continue; // 只针对隧道：块外 IP（含局域网）一律忽略，绝不误伤其它流量
    const p = ip.split(".");
    const net = `${p[0]}.${p[1]}.${p[2]}.0`;
    if (!isSafeIpv4Net(net)) continue;
    const prefix = `${net}/24`;
    if (!out.has(prefix)) out.set(prefix, { net, mask: "255.255.255.0", prefix });
  }
  return Array.from(out.values());
}

/** 日志里是否出现 IPv6 边缘连接（用于提醒：v4 路由盖不住 v6，建议 cloudflared 加 --edge-ip-version 4）。 */
export function logHasIpv6Edge(log: string): boolean {
  // cloudflared 日志形如 ip=2606:4700:... ；粗略匹配 ip= 后带冒号的十六进制。
  return /\bip=[0-9a-fA-F]*:[0-9a-fA-F:]+\b/.test(log || "");
}

/** 一条上行线路的网卡定位：Windows 用接口号 ifIndex，Linux 用网卡名 ifName。 */
export type RouteLine = { ifIndex: number | null; ifName: string | null };
const NO_LINE: RouteLine = { ifIndex: null, ifName: null };

/** 构造单条 route add/del 命令（纯函数、双平台、便于单测）。核心：把路由**钉在所选专线网卡**上——
 *  Windows `IF <ifIndex>`、Linux `dev <ifName>`；add 用低 metric 1 确保盖过默认路由，走这条线。 */
export function routeCommand(platform: NodeJS.Platform, action: "add" | "del", r: Cidr, gateway: string, line: RouteLine, persistent = false): string {
  if (platform === "win32") {
    if (action === "del") return `route delete ${r.net}`;
    const ifPart = line.ifIndex != null ? ` IF ${line.ifIndex}` : "";
    return `route ${persistent ? "-p " : ""}add ${r.net} mask ${r.mask} ${gateway} metric 1${ifPart}`;
  }
  if (action === "del") return `ip route del ${r.prefix}`;
  const devPart = line.ifName ? ` dev ${line.ifName}` : "";
  return `ip route replace ${r.prefix} via ${gateway}${devPart}`;
}

/** 手动「应用」命令（无管理员权限/探测失败时兜底，复制即用，含网卡钉定 + 持久化）。 */
export function manualRouteCommands(gateway: string, cidrs: Cidr[] = [...CF_EDGE_ROUTES], line: RouteLine = NO_LINE): string {
  const sep = process.platform === "win32" ? "\r\n" : "\n";
  return cidrs.map((r) => (process.platform === "win32" ? "" : "sudo ") + routeCommand(process.platform, "add", r, gateway, line, true)).join(sep);
}

/** 手动「移除」命令（移除失败/非管理员时给出，复制即用）。 */
export function manualRemoveCommands(cidrs: Cidr[] = [...CF_EDGE_ROUTES]): string {
  const sep = process.platform === "win32" ? "\r\n" : "\n";
  return cidrs.map((r) => (process.platform === "win32" ? "" : "sudo ") + routeCommand(process.platform, "del", r, "", NO_LINE)).join(sep);
}

/** 由「专线的本机源 IP」反查其所属网卡的默认网关（route add 的下一跳）。探测失败返回 null。 */
export async function detectGatewayForSource(sourceIp: string): Promise<string | null> {
  if (isIP(sourceIp) !== 4 && isIP(sourceIp) !== 6) return null;
  try {
    if (process.platform === "win32") {
      // 源IP → InterfaceIndex → 该网卡默认路由(0.0.0.0/0)按 metric 排序取第一个的 NextHop（网关）
      const ps = `$ErrorActionPreference='Stop'; $i=(Get-NetIPAddress -IPAddress '${sourceIp}').InterfaceIndex; (Get-NetRoute -InterfaceIndex $i -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1 -ExpandProperty NextHop)`;
      const { stdout } = await pexec(`powershell -NoProfile -NonInteractive -Command "${ps}"`, { timeout: 15000, windowsHide: true, encoding: "utf8" });
      const gw = stdout.trim();
      return isIP(gw) ? gw : null;
    }
    // Linux：源IP所在网卡 → 该网卡默认路由网关
    const { stdout: dev } = await pexec(`ip -o -4 addr show | awk '$4 ~ /^${sourceIp}\\// {print $2; exit}'`, { timeout: 10000, encoding: "utf8" });
    const iface = dev.trim();
    if (!iface) return null;
    const { stdout } = await pexec(`ip route show default dev ${iface}`, { timeout: 10000, encoding: "utf8" });
    const m = stdout.match(/default via (\d+\.\d+\.\d+\.\d+)/);
    return m && isIP(m[1]) === 4 ? m[1] : null;
  } catch { return null; }
}

/** 由「所选专线的本机源 IP」反查其所属网卡：接口号(Windows)/网卡名(Linux) + 该网卡自己的默认网关。
 *  这三者用于把 CF 路由**精确钉到用户所选的那块网卡**上（而不是靠猜/默认线路）。 */
export async function detectLineForSource(sourceIp: string): Promise<RouteLine & { gateway: string | null }> {
  const empty = { ifIndex: null, ifName: null, gateway: null };
  if (isIP(sourceIp) !== 4 && isIP(sourceIp) !== 6) return empty;
  try {
    if (process.platform === "win32") {
      const ps = `$ErrorActionPreference='Stop'; $a=Get-NetIPAddress -IPAddress '${sourceIp}' | Select-Object -First 1; $i=$a.InterfaceIndex; $gw=(Get-NetRoute -InterfaceIndex $i -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1 -ExpandProperty NextHop); $n=(Get-NetAdapter -InterfaceIndex $i -ErrorAction SilentlyContinue).Name; Write-Output ($i.ToString() + '|' + $gw + '|' + $n)`;
      const { stdout } = await pexec(`powershell -NoProfile -NonInteractive -Command "${ps}"`, { timeout: 15000, windowsHide: true, encoding: "utf8" });
      const [idx, gw, name] = stdout.trim().split("|");
      return { ifIndex: /^\d+$/.test(idx) ? parseInt(idx, 10) : null, ifName: name?.trim() || null, gateway: isIP(gw) ? gw : null };
    }
    const { stdout: dev } = await pexec(`ip -o -4 addr show | awk '$4 ~ /^${sourceIp}\\// {print $2; exit}'`, { timeout: 10000, encoding: "utf8" });
    const iface = dev.trim();
    if (!iface) return empty;
    const { stdout } = await pexec(`ip route show default dev ${iface}`, { timeout: 10000, encoding: "utf8" });
    const m = stdout.match(/default via (\d+\.\d+\.\d+\.\d+)/);
    return { ifIndex: null, ifName: iface, gateway: m && isIP(m[1]) === 4 ? m[1] : null };
  } catch { return empty; }
}

/** 执行单条 route add/del，路由钉在所选专线网卡（line）上。返回可读的「命令 + 结果」行。绝不对非法网段下命令。 */
async function runRoute(action: "add" | "del", r: Cidr, gateway: string, line: RouteLine): Promise<{ ok: boolean; line: string }> {
  if (!isSafeIpv4Net(r.net)) return { ok: false, line: `[跳过] 非法/默认网段 ${r.net}` };
  if (action === "add" && isIP(gateway) !== 4) return { ok: false, line: `[跳过] 非法网关 ${gateway}` };
  const cmd = routeCommand(process.platform, action, r, gateway, line, false);
  try {
    const { stdout, stderr } = await pexec(cmd, { timeout: 15000, windowsHide: true, encoding: "utf8" });
    const out = (stdout || stderr || "OK").trim().replace(/\s*\r?\n\s*/g, " ");
    // 幂等：Windows「路由已存在」/ Linux replace 都视为成功
    const ok = !/失败|error|denied|拒绝|requires elevation|not enough|The requested operation requires elevation/i.test(out) || /already exists|已经存在/i.test(out);
    return { ok, line: `$ ${cmd}\n  ${out}` };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 200).replace(/\s*\r?\n\s*/g, " ");
    return { ok: false, line: `$ ${cmd}\n  [失败] ${msg}` };
  }
}

export interface RouteApplyResult {
  ok: boolean;
  gateway: string | null;
  iface: string | null;   // 实际应用到的专线网卡（名字；Windows 无名时给 IF<接口号>）
  cidrs: string[];
  needsElevation: boolean;
  manual: string;      // 手动命令（兜底/参考）
  log: string;         // 可读结果
  ipv6Warn: boolean;   // 日志出现 IPv6 边缘 → v4 路由盖不住
}

/** 应用专线路由：把 CF 边缘各段**钉到「所选专线源 IP」对应的那块网卡**（IF/dev），下一跳用该网卡的网关。
 *  gatewayOverride 非空则用它当下一跳（网卡仍取自 sourceIp）。extraLog 传 cloudflared 日志用于自适应网段 + IPv6 提醒。 */
export async function applyTunnelRoutes(sourceIp: string, gatewayOverride?: string, extraLog = ""): Promise<RouteApplyResult> {
  const cidrs = edgeCidrsFromLog(extraLog);
  const ipv6Warn = logHasIpv6Edge(extraLog);
  const l = await detectLineForSource(sourceIp);
  const line: RouteLine = { ifIndex: l.ifIndex, ifName: l.ifName };
  const ifaceLabel = l.ifName ?? (l.ifIndex != null ? `IF ${l.ifIndex}` : "未知网卡");
  const gw = (gatewayOverride && isIP(gatewayOverride) === 4) ? gatewayOverride : (l.gateway ?? "");
  if (isIP(gw) !== 4) {
    return {
      ok: false, gateway: null, iface: l.ifName, cidrs: cidrs.map((c) => c.prefix), needsElevation: false, ipv6Warn,
      manual: manualRouteCommands("<该专线网关IP>", cidrs, line),
      log: `未能确定「所选专线网卡（${ifaceLabel}）」的网关：源 IP ${sourceIp || "(空)"} 所属网卡可能没配默认网关，或请在「专线网关 IP」框手填后重试。`,
    };
  }
  const lines = [`[路由] 所选专线：源 IP ${sourceIp || "(未填)"} → 网卡 ${ifaceLabel} → 网关 ${gw}；把 ${cidrs.length} 个 CF 边缘网段钉到该网卡：`];
  let allOk = true;
  for (const r of cidrs) { const { ok, line: ln } = await runRoute("add", r, gw, line); lines.push(ln); if (!ok) allOk = false; }
  const needsElevation = lines.some((x) => /elevation|拒绝访问|access is denied|requires elevation/i.test(x));
  if (!allOk) lines.push(`（有失败${needsElevation ? "：本服务未以管理员运行" : ""}。请用管理员 CMD 执行：）\n${manualRouteCommands(gw, cidrs, line)}`);
  if (ipv6Warn) lines.push("⚠️ 检测到 cloudflared 连了 IPv6 边缘；v4 路由盖不住 v6。建议让 cloudflared 加 --edge-ip-version 4 固定走 v4，或另加 v6 路由。");
  return { ok: allOk, gateway: gw, iface: l.ifName ?? ifaceLabel, cidrs: cidrs.map((c) => c.prefix), needsElevation, ipv6Warn, manual: manualRouteCommands(gw, cidrs, line), log: lines.join("\n") };
}

/** 移除专线路由（按目的网段删，不依赖网关/网卡）。best-effort。失败/非管理员时在 log 附上可手动执行的删除命令。 */
export async function removeTunnelRoutes(extraLog = ""): Promise<{ ok: boolean; log: string; manual: string }> {
  const cidrs = edgeCidrsFromLog(extraLog);
  const lines = ["[路由] 移除 CF 边缘专线路由（回退默认线路）："];
  let ok = true; let needsElevation = false;
  for (const r of cidrs) {
    const res = await runRoute("del", r, "", NO_LINE);
    lines.push(res.line);
    if (/elevation|拒绝访问|access is denied|requires elevation/i.test(res.line)) needsElevation = true;
    if (!res.ok && !/not found|找不到|does not exist|element/i.test(res.line)) ok = false;
  }
  const manual = manualRemoveCommands(cidrs);
  if (!ok || needsElevation) lines.push(`（移除失败${needsElevation ? "：本服务未以管理员运行" : ""}。请用管理员 CMD/PowerShell 执行：）\n${manual}`);
  return { ok, log: lines.join("\n"), manual };
}

/** 检测当前这些 CF 网段是否已被路由到某网关（用于面板「检测路由状态」）。 */
export async function tunnelRouteStatus(extraLog = ""): Promise<{ log: string; active: boolean }> {
  const cidrs = edgeCidrsFromLog(extraLog);
  const lines = ["[路由] 当前 CF 边缘网段路由状态："];
  let active = false;
  for (const r of cidrs) {
    const cmd = process.platform === "win32" ? `route print ${r.net}` : `ip route show ${r.prefix}`;
    try {
      const { stdout } = await pexec(cmd, { timeout: 10000, windowsHide: true, encoding: "utf8" });
      const hit = process.platform === "win32"
        ? new RegExp(`${r.net.replace(/\./g, "\\.")}\\s`).test(stdout)
        : stdout.trim().length > 0;
      if (hit) { active = true; lines.push(`${r.prefix}: 已配 → ${stdout.trim().replace(/\s*\r?\n\s*/g, " ").slice(0, 200)}`); }
      else lines.push(`${r.prefix}: 未配（走默认路由）`);
    } catch (e) { lines.push(`${r.prefix}: 查询失败 ${(e as Error).message.slice(0, 80)}`); }
  }
  return { log: lines.join("\n"), active };
}
