import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Globe, Save, Loader2, Power, ExternalLink, ShieldCheck, DownloadCloud, CheckCircle2, AlertTriangle } from "lucide-react";
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

  const [token, setToken] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [runCf, setRunCf] = useState(true);
  const [users, setUsers] = useState<string>("");   // 逗号分隔的用户 id
  const [ips, setIps] = useState<string>("");

  useEffect(() => {
    if (q.data) {
      setPublicUrl(q.data.publicUrl ?? "");
      setRunCf(q.data.runCloudflared ?? true);
      setUsers((q.data.whitelistUsers ?? []).join(", "));
      setIps((q.data.whitelistIps ?? []).join(", "));
    }
  }, [q.data]);

  const download = async () => {
    try { await dlMut.mutateAsync(); await cf.refetch(); } catch { /* status surfaced below */ }
  };

  const enabled = q.data?.enabled ?? false;
  const running = q.data?.running ?? false;

  const toggle = async () => {
    try { await enableMut.mutateAsync({ enabled: !enabled }); await utils.admin.tunnel.get.invalidate(); toast.success(!enabled ? "已启用隧道，正在建立公网连接…" : "已关闭隧道"); }
    catch (e) { toast.error("操作失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 140)); }
  };
  const saveConfig = async () => {
    try { await configMut.mutateAsync({ token: token.trim() || undefined, publicUrl: publicUrl.trim(), runCloudflared: runCf }); setToken(""); await utils.admin.tunnel.get.invalidate(); toast.success("已保存隧道配置（重新启用后生效）"); }
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
          </>
        ) : (
          <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.6, margin: 0 }}>
            你已有公网入口（域名+反代/端口转发/其它隧道）。<b>无需 cloudflared</b>，只需在下面填外网访问用的公网域名——门控会按该 Host 识别隧道流量并应用下方白名单。
          </p>
        )}

        <label style={{ fontSize: 11, color: "var(--c-t3)" }}>{runCf ? "公网地址（命名隧道必填；快速隧道留空自动获取）" : "公网地址（你的外网访问域名，必填）"}
          <input value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="video.example.com 或 https://video.example.com" className="nodrag" style={{ ...box, marginTop: 4 }} />
        </label>
        <button onClick={saveConfig} disabled={configMut.isPending} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg self-start" style={{ fontSize: 11.5, fontWeight: 600, background: "var(--c-bd1)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}>
          {configMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} 保存配置
        </button>
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
    </div>
  );
}
