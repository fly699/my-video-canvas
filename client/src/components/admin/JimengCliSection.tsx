import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Film, Save, Loader2, Stethoscope } from "lucide-react";
import { trpc } from "@/lib/trpc";

/** #328 管理员后台「模型管理 › 即梦（dreamina）CLI」：本机桥接型视频 provider。
 *  在部署机安装 dreamina + 人工 web 登录后，在此开启开关（可选填可执行路径 / session），
 *  「即梦」分组的视频模型即出现在 video_task 节点的模型选择器里，可选比例/分辨率/时长——
 *  与其它 API 模型形态一致。配置存 DB（替代 JIMENG_CLI_* env），保存即生效、无需重启。 */
export function JimengCliSection() {
  const utils = trpc.useUtils();
  const q = trpc.admin.models.getJimengCli.useQuery();
  const saveMut = trpc.admin.models.setJimengCli.useMutation();

  const [enabled, setEnabled] = useState(false);
  const [bin, setBin] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [inspect, setInspect] = useState<{ installed: boolean; version?: string; loggedIn: boolean; credit?: string; error?: string; bin: string } | null>(null);

  useEffect(() => {
    if (q.data) {
      setEnabled(!!q.data.enabled);
      setBin(q.data.bin ?? "");
      setSessionId(q.data.sessionId ?? "");
    }
  }, [q.data]);

  const runInspect = async () => {
    setInspecting(true); setInspect(null);
    try {
      const r = await utils.admin.models.inspectJimengCli.fetch();
      setInspect(r);
    } catch (e) {
      setInspect({ installed: false, loggedIn: false, bin, error: e instanceof Error ? e.message : String(e) });
    } finally { setInspecting(false); }
  };

  const save = async () => {
    try {
      await saveMut.mutateAsync({ enabled, bin: bin.trim(), sessionId: sessionId.trim() });
      await utils.admin.models.getJimengCli.invalidate();
      toast.success("已保存即梦 CLI 配置，立即生效（无需重启）");
    } catch (e) {
      toast.error("保存失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 140));
    }
  };

  const box: React.CSSProperties = { fontSize: 12, padding: "7px 9px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", width: "100%" };
  const hue = 12; // 与 models.ts 的「即梦」平台色一致

  return (
    <div style={{ border: "1px solid var(--c-bd2)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
        <Film className="w-4 h-4" style={{ color: `oklch(0.7 0.18 ${hue})` }} /> 即梦（dreamina）CLI · 本机桥接视频
      </div>
      <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.7, margin: 0 }}>
        即梦 CLI 是装在<strong>服务器主机</strong>上、独立登录的命令行工具。启用后，「即梦」分组的
        <strong>文生 / 图生 / 首尾帧 / 多帧 / 全能参考</strong>视频模型出现在视频节点的模型选择器里，
        可选<strong>比例 / 分辨率 / 时长</strong>，与其它 API 模型用法一致（异步任务制，走系统轮询取回结果）。
        配置存数据库（替代 <code>JIMENG_CLI_*</code> 环境变量），<strong>保存即生效、无需重启</strong>。
      </p>

      {/* 部署三步 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderRadius: 10, background: `oklch(0.7 0.15 ${hue} / 0.08)`, border: `1px solid oklch(0.7 0.15 ${hue} / 0.3)` }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: `oklch(0.72 0.14 ${hue})` }}>部署三步（在服务器主机上，仅需一次）</div>
        <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.9, margin: 0 }}>
          <strong>1) 安装</strong>：<code>curl -fsSL https://jimeng.jianying.com/cli | bash</code>（装出可执行文件 <code>dreamina</code>）。
          <br /><strong>2) 登录</strong>：<code>dreamina login</code> → 在浏览器打开链接完成 web 授权
          （⚠️ 官方要求<strong>人工登录</strong>，不能由 Agent 代登；<code>dreamina user_credit</code> 能返回积分即成功）。
          <br /><strong>3) 回到本页</strong>：打开下面「启用」开关并保存 → 点「检测」确认已安装且已登录。
        </p>
      </div>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--c-t2)", cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="nodrag" style={{ marginTop: 2 }} />
        <span><strong>启用即梦 CLI 视频</strong><br /><span style={{ fontSize: 11, color: "var(--c-t3)" }}>关闭时「即梦」分组模型不出现在选择器，提交也会被拒。需白名单用户方可使用（与 Poyo/HF 同门控）。</span></span>
      </label>

      <label style={{ fontSize: 11, color: "var(--c-t2)", fontWeight: 700 }}>可执行文件路径（留空 = 走主机 PATH 里的 <code>dreamina</code>）
        <input value={bin} onChange={(e) => setBin(e.target.value)} placeholder="dreamina / 绝对路径 / wsl dreamina" className="nodrag" style={{ ...box, marginTop: 4, fontFamily: "monospace" }} />
        <span style={{ display: "block", fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.7, marginTop: 3 }}>
          · Linux/macOS 服务器：留空即可（走 PATH）。<br />
          · <b>Windows 服务器（本平台 Node 原生运行）</b>：即梦 CLI 装在 WSL 里时填 <code>wsl dreamina</code>；
          若有 Windows 原生可执行文件则填含扩展名的完整路径（如 <code>{"C:\\\\dreamina\\\\dreamina.exe"}</code>）——
          Node 无法直接 spawn <code>.cmd</code>/裸命令。⚠️ 走 WSL 时文生视频先可用；图生/首尾帧等要传本机文件的模式需路径转换（待校准）。
        </span>
      </label>
      <label style={{ fontSize: 11, color: "var(--c-t2)", fontWeight: 700 }}>默认 session（可选，按项目隔离任务；留空用默认 session 0）
        <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="留空即可" className="nodrag" style={{ ...box, marginTop: 4, fontFamily: "monospace" }} />
      </label>

      {/* 检测 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={runInspect} disabled={inspecting} className="nodrag flex items-center gap-1.5"
          style={{ fontSize: 11.5, fontWeight: 700, padding: "6px 12px", borderRadius: 8, cursor: inspecting ? "wait" : "pointer",
            background: `oklch(0.7 0.18 ${hue} / 0.14)`, border: `1px solid oklch(0.7 0.18 ${hue} / 0.4)`, color: `oklch(0.72 0.16 ${hue})` }}>
          {inspecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stethoscope className="w-3.5 h-3.5" />} 检测（安装 / 登录 / 积分）
        </button>
        <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>在服务端跑 <code>dreamina version</code> + <code>user_credit</code>，确认真机已装好且已登录。</span>
      </div>
      {inspect && (
        <div style={{ fontSize: 11.5, padding: "8px 10px", borderRadius: 8, lineHeight: 1.7,
          background: inspect.installed && inspect.loggedIn ? "oklch(0.70 0.15 160 / 0.10)" : "oklch(0.70 0.16 25 / 0.10)",
          border: `1px solid ${inspect.installed && inspect.loggedIn ? "oklch(0.70 0.15 160 / 0.35)" : "oklch(0.70 0.16 25 / 0.35)"}`,
          color: inspect.installed && inspect.loggedIn ? "oklch(0.70 0.13 160)" : "oklch(0.72 0.16 28)" }}>
          <div><strong>{inspect.installed ? "✓ 已安装" : "✗ 未检测到 dreamina"}</strong>{inspect.version ? `（${inspect.version}）` : ""} · <strong>{inspect.loggedIn ? "✓ 已登录" : "✗ 未登录 / 无法确认"}</strong></div>
          {inspect.credit && <div style={{ color: "var(--c-t3)", marginTop: 2, wordBreak: "break-all" }}>账户：{inspect.credit}</div>}
          {inspect.error && <div style={{ color: "var(--c-t4)", marginTop: 2, wordBreak: "break-all" }}>{inspect.error}</div>}
        </div>
      )}

      <button onClick={save} disabled={saveMut.isPending} className="nodrag flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg self-start"
        style={{ fontSize: 12, fontWeight: 700, background: "oklch(0.7 0.16 150)", border: "1px solid oklch(0.7 0.16 150 / 0.5)", color: "#06250f", cursor: saveMut.isPending ? "not-allowed" : "pointer" }}>
        {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 保存配置
      </button>
    </div>
  );
}
