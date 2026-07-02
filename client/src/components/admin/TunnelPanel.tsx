import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Globe, Save, Loader2, Power, ExternalLink, ShieldCheck, DownloadCloud, CheckCircle2, AlertTriangle, Wifi, BookOpen, ChevronDown, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";

/** 管理员后台「公网隧道」：一键启用内置 cloudflared 隧道（快速隧道免账号，或填 Cloudflare
 *  命名隧道 Token），公网经此访问时受**单独的隧道白名单**门控——不在名单的访客只能看到登录页，
 *  其余一切（生成/存储/代理/实时）一律 403。 */
export function TunnelPanel() {
  const utils = trpc.useUtils();
  const q = trpc.admin.tunnel.get.useQuery(undefined, { refetchInterval: 5000 });
  const cf = trpc.admin.tunnel.cloudflared.useQuery(undefined, { refetchInterval: 3000 });
  const enableMut = trpc.admin.tunnel.setEnabled.useMutation();
  const configMut = trpc.admin.tunnel.setConfig.useMutation();
  const wlMut = trpc.admin.tunnel.setWhitelist.useMutation();
  const dlMut = trpc.admin.tunnel.downloadCloudflared.useMutation();

  const emailMut = trpc.admin.tunnel.setEmailNotify.useMutation();
  const testMut = trpc.admin.tunnel.testEmail.useMutation();
  const checkMut = trpc.admin.tunnel.checkConnectivity.useMutation();
  type CheckResult = { reachable: boolean; status?: number; host?: string; error?: string };
  const [checkRes, setCheckRes] = useState<CheckResult | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  // 专线路由（让命名隧道走指定专线）
  const detectGwMut = trpc.admin.tunnel.detectRouteGateway.useMutation();
  const applyRoutesMut = trpc.admin.tunnel.applyRoutes.useMutation();
  const removeRoutesMut = trpc.admin.tunnel.removeRoutes.useMutation();
  const routeStatusMut = trpc.admin.tunnel.routeStatus.useMutation();
  const [routeGw, setRouteGw] = useState("");        // 专线网关（自动探测预填，可手改）
  const [routeLog, setRouteLog] = useState("");       // 路由操作结果回显
  const routeBusy = detectGwMut.isPending || applyRoutesMut.isPending || removeRoutesMut.isPending || routeStatusMut.isPending;

  const [token, setToken] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [runCf, setRunCf] = useState(true);
  const [edgeBind, setEdgeBind] = useState("");
  const [users, setUsers] = useState<string>("");   // 逗号分隔的用户 id
  const [ips, setIps] = useState<string>("");
  const [em, setEm] = useState({ to: "", host: "", port: 587, user: "", pass: "", secure: false, from: "" });

  useEffect(() => {
    if (q.data) {
      setPublicUrl(q.data.publicUrl ?? "");
      setRunCf(q.data.runCloudflared ?? true);
      setEdgeBind(q.data.edgeBindAddress ?? "");
      setUsers((q.data.whitelistUsers ?? []).join(", "));
      setIps((q.data.whitelistIps ?? []).join(", "));
      const e = q.data.email; if (e) setEm({ to: e.to, host: e.host, port: e.port, user: e.user, pass: "", secure: e.secure, from: e.from });
    }
  }, [q.data]);

  const saveEmail = async () => {
    try { await emailMut.mutateAsync({ to: em.to.trim(), host: em.host.trim(), port: em.port, user: em.user.trim(), pass: em.pass || undefined, secure: em.secure, from: em.from.trim() }); setEm((s) => ({ ...s, pass: "" })); await utils.admin.tunnel.get.invalidate(); toast.success("已保存邮件通知配置"); }
    catch (e) { toast.error("保存失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 140)); }
  };
  const testEmail = async () => {
    try { await testMut.mutateAsync(); toast.success("测试邮件已发送，请查收"); }
    catch (e) { toast.error((e instanceof Error ? e.message : String(e)).slice(0, 180)); }
  };

  const download = async () => {
    try { await dlMut.mutateAsync(); await cf.refetch(); } catch { /* status surfaced below */ }
  };
  const checkConn = async () => {
    setCheckRes(null);
    try { setCheckRes(await checkMut.mutateAsync()); }
    catch (e) { setCheckRes({ reachable: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 180) }); }
  };

  const enabled = q.data?.enabled ?? false;
  const running = q.data?.running ?? false;

  const toggle = async () => {
    try { await enableMut.mutateAsync({ enabled: !enabled }); await utils.admin.tunnel.get.invalidate(); toast.success(!enabled ? "已启用隧道，正在建立公网连接…" : "已关闭隧道"); }
    catch (e) { toast.error("操作失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 140)); }
  };
  const saveConfig = async () => {
    try {
      const r = await configMut.mutateAsync({ token: token.trim() || undefined, publicUrl: publicUrl.trim(), runCloudflared: runCf, edgeBindAddress: edgeBind.trim() });
      setToken(""); await utils.admin.tunnel.get.invalidate();
      if (r.routeReverted) { if (r.routeLog) setRouteLog(r.routeLog); toast.success("已保存；已关闭专线并移除专线路由，回退默认线路"); }
      else toast.success("已保存隧道配置（重新启用后生效）");
    }
    catch (e) { toast.error("保存失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 140)); }
  };
  const saveWl = async () => {
    const wu = users.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n));
    const wi = ips.split(",").map((s) => s.trim()).filter(Boolean);
    try { await wlMut.mutateAsync({ whitelistUsers: wu, whitelistIps: wi }); await utils.admin.tunnel.get.invalidate(); toast.success(`已保存隧道白名单（${wu.length} 用户 · ${wi.length} IP）`); }
    catch (e) { toast.error("保存失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 140)); }
  };

  const box: React.CSSProperties = { fontSize: 12, padding: "7px 9px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", width: "100%" };
  const card: React.CSSProperties = { border: "1px solid var(--c-bd2)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ padding: "12px 16px", background: "oklch(0.70 0.16 25 / 0.10)", border: "1px solid oklch(0.70 0.16 25 / 0.35)", borderRadius: 10, fontSize: 12.5, lineHeight: 1.7, color: "var(--c-t2)" }}>
        <strong style={{ color: "var(--c-t1)" }}>⚠ 公网暴露</strong>：启用后本服务可被公网访问。<strong>务必先把自己加入下方「隧道白名单」</strong>，否则启用后你自己也会被拦。
        非白名单访客经隧道访问时只能看到登录页，其余一律 403。本地/局域网访问不受影响。
      </div>

      {/* 开关 + 状态 */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
          <Globe className="w-4 h-4" style={{ color: "oklch(0.70 0.16 25)" }} /> 内置公网隧道（cloudflared）
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button onClick={toggle} disabled={enableMut.isPending} className="nodrag flex items-center gap-1.5 px-4 py-2 rounded-lg"
            style={{ fontSize: 12, fontWeight: 700, cursor: "pointer", background: enabled ? "oklch(0.65 0.2 25 / 0.16)" : "oklch(0.7 0.16 150)", border: `1px solid ${enabled ? "oklch(0.65 0.2 25 / 0.4)" : "oklch(0.7 0.16 150 / 0.5)"}`, color: enabled ? "oklch(0.7 0.16 25)" : "#06250f" }}>
            {enableMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />} {enabled ? "关闭隧道" : "启用隧道"}
          </button>
          <span style={{ fontSize: 11.5, color: "var(--c-t3)" }}>
            状态：{enabled ? (running ? <b style={{ color: "oklch(0.72 0.16 150)" }}>● 运行中</b> : <b style={{ color: "oklch(0.75 0.15 75)" }}>○ 启动中/未连接</b>) : "已关闭"}
            {q.data?.error && <span style={{ color: "oklch(0.7 0.16 25)" }}> · {q.data.error}</span>}
          </span>
        </div>
        {q.data?.publicUrl && (
          <div style={{ fontSize: 12, color: "var(--c-t2)" }}>公网地址：<a href={q.data.publicUrl} target="_blank" rel="noreferrer" style={{ color: "oklch(0.7 0.14 200)", textDecoration: "none" }}>{q.data.publicUrl} <ExternalLink className="inline w-3 h-3" /></a></div>
        )}
        {q.data?.log && q.data.log.trim() && (
          <details style={{ fontSize: 11 }}>
            <summary style={{ cursor: "pointer", color: "var(--c-t3)", userSelect: "none" }}>查看 cloudflared 日志（排错用）</summary>
            <pre style={{ marginTop: 6, maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 8, padding: 8, color: "var(--c-t2)", fontSize: 10.5, lineHeight: 1.5 }}>{q.data.log}</pre>
          </details>
        )}
      </div>

      {/* 配置：模式 + cloudflared 状态 + token/域名 */}
      <div style={card}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>隧道配置</div>
        {/* 模式切换 */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {([[true, "app 自起 cloudflared"], [false, "我已有公网入口（只门控）"]] as const).map(([v, label]) => (
            <button key={String(v)} onClick={() => setRunCf(v)} className="nodrag px-3 py-1.5 rounded-lg" style={{ fontSize: 11.5, fontWeight: 600, cursor: "pointer",
              background: runCf === v ? "oklch(0.70 0.16 200 / 0.16)" : "var(--c-bd1)", border: `1px solid ${runCf === v ? "oklch(0.70 0.16 200 / 0.5)" : "var(--c-bd2)"}`, color: runCf === v ? "oklch(0.7 0.14 200)" : "var(--c-t3)" }}>{label}</button>
          ))}
        </div>

        {/* 开机自启说明 */}
        <details style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.65, background: "var(--c-bd1)", borderRadius: 8, padding: "8px 11px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--c-t2)" }}>如何让公网隧道随宿主机开机自启？</summary>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 9 }}>
            <div>
              <b style={{ color: "var(--c-t2)" }}>说明：</b>「app 自起 cloudflared」模式下，cloudflared 不是独立服务，而是<b>本应用启动隧道时拉起的子进程</b>，生命周期跟着应用走；应用启动时若隧道为「已启用」会<b>自动把它拉起</b>。所以要随宿主机启动，本质是让<b>应用本身随机器启动</b>。
            </div>
            <div>
              <b style={{ color: "var(--c-t2)" }}>方式一（推荐 · 随应用一起起）：</b>把本应用注册成开机服务，隧道就会跟着自动起。
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                <li>Windows（开机即启、登录前）：以管理员运行 <code>deploy\install-services.bat</code>（NSSM 注册为 Windows 服务）。</li>
                <li>Windows（登录后自启）：<code>deploy\add-to-startup.bat</code>。</li>
                <li>Linux：把应用做成 systemd 服务设为开机启动即可（应用起来后会自动起隧道）。</li>
              </ul>
              前提：隧道在本页保持「启用」+「app 自起 cloudflared」，且 cloudflared 已就绪（上方「下载 cloudflared」或装在系统 PATH）。
            </div>
            <div>
              <b style={{ color: "var(--c-t2)" }}>方式二（让 cloudflared 自己随机器起、独立于应用）：</b>用 Cloudflare <b>命名隧道</b> + cloudflared 官方的 <code>cloudflared service install</code>（注册成 systemd / Windows 服务，开机自启、独立运行），把隧道回源(Service)指向 <code>http://localhost:&lt;本页显示的回源端口&gt;</code>；本页这边切到<b>「我已有公网入口（只门控）」</b>模式即可（应用不再自己起 cloudflared，只按公网域名做白名单门控）。
            </div>
          </div>
        </details>

        {runCf ? (
          <>
            {/* cloudflared 安装状态 + 一键下载 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, flexWrap: "wrap", padding: "8px 10px", borderRadius: 8, background: "var(--c-bd1)" }}>
              {cf.data?.installed ? (
                <span style={{ display: "flex", alignItems: "center", gap: 5, color: "oklch(0.72 0.16 150)" }}><CheckCircle2 className="w-3.5 h-3.5" /> cloudflared 已就绪{cf.data.source === "downloaded" ? "（应用内置）" : "（系统 PATH）"}</span>
              ) : (
                <>
                  <span style={{ display: "flex", alignItems: "center", gap: 5, color: "oklch(0.72 0.15 60)" }}><AlertTriangle className="w-3.5 h-3.5" /> 未检测到 cloudflared（{cf.data?.platform}）</span>
                  {cf.data?.canAutoDownload ? (
                    <button onClick={download} disabled={cf.data?.downloading} className="nodrag flex items-center gap-1 px-2.5 py-1 rounded-md" style={{ fontSize: 11, fontWeight: 600, cursor: cf.data?.downloading ? "default" : "pointer", background: "oklch(0.70 0.16 200 / 0.16)", border: "1px solid oklch(0.70 0.16 200 / 0.4)", color: "oklch(0.7 0.14 200)" }}>
                      {cf.data?.downloading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 下载中…</> : <><DownloadCloud className="w-3.5 h-3.5" /> 下载 cloudflared</>}
                    </button>
                  ) : <span style={{ color: "var(--c-t4)" }}>· 该平台需手动安装</span>}
                  {cf.data?.error && <span style={{ color: "oklch(0.7 0.16 25)" }}>· {cf.data.error}</span>}
                </>
              )}
            </div>
            <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.6, margin: 0 }}>
              留空 Token = <b>快速隧道</b>（免账号，自动 *.trycloudflare.com，重启会变）。填 Cloudflare <b>命名隧道 Token</b> = 固定自有域名（更稳），此时在下面填你在 Cloudflare 配置的公网域名。
            </p>
            {token.trim() && q.data?.originPort ? (
              <div style={{ fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.5 }}>命名隧道请在 Cloudflare 面板把该隧道的回源(Service)设为 <code>http://localhost:{q.data.originPort}</code></div>
            ) : null}
            <label style={{ fontSize: 11, color: "var(--c-t3)" }}>命名隧道 Token（可选，{q.data?.hasToken ? "已配置，留空保持不变" : "未配置"}）
              <input value={token} onChange={(e) => setToken(e.target.value)} placeholder={q.data?.hasToken ? "••••••（留空保持不变）" : "粘贴 cloudflared tunnel token"} className="nodrag" style={{ ...box, marginTop: 4 }} />
            </label>
            {q.data?.hasToken && (
              <button
                onClick={async () => {
                  if (!window.confirm("清除命名隧道 Token，切回快速隧道（*.trycloudflare.com，重启会变网址）？停用再启用后生效。")) return;
                  try { await configMut.mutateAsync({ token: "" }); setToken(""); await utils.admin.tunnel.get.invalidate(); toast.success("已清除 Token，切回快速隧道（停用再启用生效）"); }
                  catch (e) { toast.error("清除失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 140)); }
                }}
                disabled={configMut.isPending}
                className="nodrag"
                style={{ alignSelf: "flex-start", fontSize: 11, padding: "4px 10px", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t2)", cursor: "pointer" }}
              >清除 Token（切回快速隧道）</button>
            )}
          </>
        ) : (
          <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.6, margin: 0 }}>
            你已有公网入口（域名+反代/端口转发/其它隧道）。<b>无需 cloudflared</b>，只需在下面填外网访问用的公网域名——门控会按该 Host 识别隧道流量并应用下方白名单。
          </p>
        )}

        <label style={{ fontSize: 11, color: "var(--c-t3)" }}>{runCf ? "公网地址（命名隧道必填；快速隧道留空自动获取）" : "公网地址（你的外网访问域名，必填）"}
          <input value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="video.example.com 或 https://video.example.com" className="nodrag" style={{ ...box, marginTop: 4 }} />
        </label>
        {runCf && (<>
          <label style={{ fontSize: 11, color: "var(--c-t3)" }}>出口专线绑定（多条上行专线时用；填某条线路本机网卡的源 IP）
            <input value={edgeBind} onChange={(e) => setEdgeBind(e.target.value)} placeholder="如 192.168.12.24（留空=系统默认路由）" className="nodrag" style={{ ...box, marginTop: 4 }} />
            <div style={{ fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.5, marginTop: 3 }}>填该专线本机网卡的源 IP。<b>快速隧道</b>靠它即可走该专线；<b>命名隧道</b>（token）cloudflared 不吃此绑定，需用下方「专线路由」把流量导到该专线（改后停用再启用生效）。<b>关闭专线</b>：清空本框保存 → 自动移除专线路由回退默认线路；停用隧道也会自动回退。</div>
          </label>

          {/* 专线路由：命名隧道走指定专线的唯一可行办法——把 CF 边缘网段路由到专线网关（OS 路由层）。 */}
          <div style={{ border: "1px solid var(--c-bd2)", borderRadius: 10, padding: 10, background: "var(--c-base)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--c-t2)" }}>专线路由（让命名隧道走这条专线）</div>
            <div style={{ fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.5 }}>
              命名隧道不应用「出口专线绑定」，只能在系统路由层选线：把 Cloudflare 边缘网段（198.41.192.0/24、198.41.200.0/24 等，自适应）路由到<b>专线网关</b>，其余出站仍走默认路由。<b>需本服务以管理员运行</b>；若无权限，下方会给出可手动执行的命令。只动这几段、绝不碰默认路由。<b>关闭专线</b>：点「移除路由」手动回退，或停用隧道/清空上方「出口专线绑定」自动回退。
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input value={routeGw} onChange={(e) => setRouteGw(e.target.value)} placeholder="专线网关 IP（留空=自动探测）" className="nodrag" style={{ ...box, flex: "1 1 160px", marginTop: 0 }} />
              <button disabled={routeBusy} onClick={async () => {
                const r = await detectGwMut.mutateAsync().catch((e) => ({ gateway: null, error: String(e) }));
                if (r.gateway) { setRouteGw(r.gateway); setRouteLog(`探测到专线网关：${r.gateway}`); }
                else setRouteLog(("error" in r && r.error) ? r.error : "未探测到网关，请在「出口专线绑定」填源 IP 或手动填网关");
              }} className="nodrag" style={{ fontSize: 11, padding: "6px 10px", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t2)", cursor: "pointer", whiteSpace: "nowrap" }}>自动探测网关</button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button disabled={routeBusy} onClick={async () => {
                try { const r = await applyRoutesMut.mutateAsync({ gateway: routeGw.trim() || undefined }); setRouteLog(r.log); if (r.gateway && !routeGw.trim()) setRouteGw(r.gateway); (r.ok ? toast.success : toast.error)(r.ok ? "已应用专线路由" : "部分/全部路由未生效，见下方结果"); }
                catch (e) { setRouteLog(String(e)); toast.error("应用失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 140)); }
              }} className="nodrag flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 600, padding: "6px 12px", borderRadius: 7, border: "1px solid oklch(0.68 0.22 285 / 0.4)", background: "oklch(0.68 0.22 285 / 0.14)", color: "oklch(0.78 0.16 285)", cursor: "pointer" }}>
                {applyRoutesMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} 应用专线路由
              </button>
              <button disabled={routeBusy} onClick={async () => { const r = await removeRoutesMut.mutateAsync().catch((e) => ({ log: String(e) })); setRouteLog(r.log); toast.success("已移除专线路由，回退默认线路"); }} className="nodrag" style={{ fontSize: 11, padding: "6px 12px", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t2)", cursor: "pointer" }}>移除路由（关闭专线）</button>
              <button disabled={routeBusy} onClick={async () => { const r = await routeStatusMut.mutateAsync().catch((e) => ({ log: String(e) })); setRouteLog(r.log); }} className="nodrag" style={{ fontSize: 11, padding: "6px 12px", borderRadius: 7, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t2)", cursor: "pointer" }}>检测路由状态</button>
            </div>
            {routeLog && (
              <pre style={{ margin: 0, maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 8, padding: 8, color: "var(--c-t2)", fontSize: 10.5, lineHeight: 1.5 }}>{routeLog}</pre>
            )}
          </div>
        </>)}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={saveConfig} disabled={configMut.isPending} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ fontSize: 11.5, fontWeight: 600, background: "var(--c-bd1)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
            {configMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} 保存配置
          </button>
          {/* 连通性自检：服务器去 GET 自己的公网地址，判断 Cloudflare→隧道→回源是否端到端通 */}
          <button onClick={checkConn} disabled={checkMut.isPending} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ fontSize: 11.5, fontWeight: 600, background: "oklch(0.70 0.16 200 / 0.16)", border: "1px solid oklch(0.70 0.16 200 / 0.4)", color: "oklch(0.7 0.14 200)", cursor: "pointer" }}>
            {checkMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />} 检测命名隧道是否连通
          </button>
        </div>
        {checkRes && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11.5, lineHeight: 1.6, padding: "8px 10px", borderRadius: 8,
            background: checkRes.reachable ? "oklch(0.7 0.16 150 / 0.12)" : "oklch(0.70 0.16 25 / 0.10)",
            border: `1px solid ${checkRes.reachable ? "oklch(0.7 0.16 150 / 0.4)" : "oklch(0.70 0.16 25 / 0.35)"}`,
            color: checkRes.reachable ? "oklch(0.72 0.16 150)" : "oklch(0.72 0.16 28)" }}>
            {checkRes.reachable ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
            <span>{checkRes.reachable
              ? <>隧道连通正常（HTTP {checkRes.status}{checkRes.host ? ` · ${checkRes.host}` : ""}）：Cloudflare → cloudflared → 本服务 回源成功。</>
              : <>未连通：{checkRes.error}</>}</span>
          </div>
        )}

        {/* 命名隧道图文配置引导 */}
        <div>
          <button onClick={() => setShowGuide((v) => !v)} className="nodrag flex items-center gap-1.5" style={{ fontSize: 11.5, fontWeight: 600, background: "none", border: "none", color: "oklch(0.7 0.14 200)", cursor: "pointer", padding: 0 }}>
            <BookOpen className="w-3.5 h-3.5" /> 命名隧道配置图文引导（固定自有域名）<ChevronDown className="w-3.5 h-3.5" style={{ transform: showGuide ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
          </button>
          {showGuide && (
            <ol style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 11.5, lineHeight: 1.85, color: "var(--c-t2)", display: "flex", flexDirection: "column", gap: 6 }}>
              <li>登录 <a href="https://one.dash.cloudflare.com/" target="_blank" rel="noreferrer" style={{ color: "oklch(0.7 0.14 200)" }}>Cloudflare Zero Trust 控制台 <ExternalLink className="inline w-3 h-3" /></a>，左侧进入 <b>Networks → Tunnels</b>（旧版在 Access → Tunnels）。</li>
              <li>点 <b>Create a tunnel</b> → 选 <b>Cloudflared</b> → 给隧道起个名字（如 <code>my-video-canvas</code>）→ Save。</li>
              <li>在 “Install and run a connector” 页，找到形如 <code>cloudflared … run --token <b>eyJ...</b></code> 的命令，<b>复制其中的 token（eyJ 开头那串）</b>。无需自己跑命令，本应用会用它启动 cloudflared。</li>
              <li>把上面复制的 token 粘到本页 <b>「命名隧道 Token」</b>输入框。</li>
              <li>回到 Cloudflare 隧道页的 <b>Public Hostname</b> 标签 → <b>Add a public hostname</b>：
                <ul style={{ margin: "2px 0 0", paddingLeft: 16 }}>
                  <li><b>Subdomain + Domain</b>：选你托管在 Cloudflare 的域名，填子域（如 <code>video.example.com</code>）。</li>
                  <li><b>Service</b>：Type 选 <b>HTTP</b>，URL 填 <code>localhost:{q.data?.originPort ?? "<本机回源端口>"}</code>（即本应用的内部回环端口，见下方提示）。</li>
                </ul>
              </li>
              <li>把同一个公网域名（如 <code>video.example.com</code>）填到本页下方 <b>「公网地址」</b>，并把要放行的用户/IP 加入 <b>隧道白名单</b>。</li>
              <li>点 <b>保存配置</b> → 顶部 <b>启用隧道</b> → 等状态变 <b>● 运行中</b> → 点 <b>「检测命名隧道是否连通」</b>确认端到端打通。</li>
            </ol>
          )}
        </div>
      </div>

      {/* 单独白名单 */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600 }}><ShieldCheck className="w-4 h-4" style={{ color: "oklch(0.7 0.16 150)" }} /> 隧道白名单（仅这些用户/IP 可经公网使用）</div>
        <label style={{ fontSize: 11, color: "var(--c-t3)" }}>允许的用户 id（逗号分隔；在「用户管理」里查 id）
          <input value={users} onChange={(e) => setUsers(e.target.value)} placeholder="如 1, 7, 23" className="nodrag" style={{ ...box, marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 11, color: "var(--c-t3)" }}>允许的 IP（逗号分隔；公网访客的来源 IP）
          <input value={ips} onChange={(e) => setIps(e.target.value)} placeholder="如 203.0.113.5, 198.51.100.7" className="nodrag" style={{ ...box, marginTop: 4 }} />
        </label>
        <button onClick={saveWl} disabled={wlMut.isPending} className="nodrag flex items-center gap-1.5 px-4 py-2 rounded-lg self-start" style={{ fontSize: 12, fontWeight: 700, background: "oklch(0.7 0.16 150)", border: "1px solid oklch(0.7 0.16 150 / 0.5)", color: "#06250f", cursor: "pointer" }}>
          {wlMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 保存白名单
        </button>
      </div>

      {/* 新网址自动发邮件（SMTP） */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600 }}><Globe className="w-4 h-4" style={{ color: "oklch(0.7 0.14 200)" }} /> 新网址自动发邮件</div>
        <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.6, margin: 0 }}>快速隧道每次重启地址会变。配好 SMTP 后，系统在获取到新公网地址时会自动把地址发到下面的收件邮箱。（Gmail 用应用专用密码；465 勾选 SSL，587 不勾。）</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={{ fontSize: 11, color: "var(--c-t3)" }}>收件邮箱<input value={em.to} onChange={(e) => setEm((s) => ({ ...s, to: e.target.value }))} placeholder="you@example.com" className="nodrag" style={{ ...box, marginTop: 4 }} /></label>
          <label style={{ fontSize: 11, color: "var(--c-t3)" }}>发件人 From<input value={em.from} onChange={(e) => setEm((s) => ({ ...s, from: e.target.value }))} placeholder="留空=用 SMTP 用户名" className="nodrag" style={{ ...box, marginTop: 4 }} /></label>
          <label style={{ fontSize: 11, color: "var(--c-t3)" }}>SMTP 主机<input value={em.host} onChange={(e) => setEm((s) => ({ ...s, host: e.target.value }))} placeholder="smtp.gmail.com" className="nodrag" style={{ ...box, marginTop: 4 }} /></label>
          <label style={{ fontSize: 11, color: "var(--c-t3)" }}>端口<input type="number" value={em.port} onChange={(e) => setEm((s) => ({ ...s, port: parseInt(e.target.value, 10) || 587 }))} className="nodrag" style={{ ...box, marginTop: 4 }} /></label>
          <label style={{ fontSize: 11, color: "var(--c-t3)" }}>SMTP 用户名<input value={em.user} onChange={(e) => setEm((s) => ({ ...s, user: e.target.value }))} placeholder="you@gmail.com" className="nodrag" style={{ ...box, marginTop: 4 }} /></label>
          <label style={{ fontSize: 11, color: "var(--c-t3)" }}>SMTP 密码{q.data?.email?.hasPass ? "（已配置，留空保持不变）" : ""}<input type="password" value={em.pass} onChange={(e) => setEm((s) => ({ ...s, pass: e.target.value }))} placeholder={q.data?.email?.hasPass ? "••••••" : "应用专用密码"} className="nodrag" style={{ ...box, marginTop: 4 }} /></label>
        </div>
        <label style={{ fontSize: 11, color: "var(--c-t3)", display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={em.secure} onChange={(e) => setEm((s) => ({ ...s, secure: e.target.checked }))} /> 使用 SSL（端口 465 勾选；587/STARTTLS 不勾）
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={saveEmail} disabled={emailMut.isPending} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ fontSize: 11.5, fontWeight: 600, background: "var(--c-bd1)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
            {emailMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} 保存
          </button>
          <button onClick={testEmail} disabled={testMut.isPending} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ fontSize: 11.5, fontWeight: 600, background: "oklch(0.70 0.16 200 / 0.16)", border: "1px solid oklch(0.70 0.16 200 / 0.4)", color: "oklch(0.7 0.14 200)", cursor: "pointer" }}>
            {testMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />} 发送测试邮件
          </button>
        </div>
      </div>
    </div>
  );
}
