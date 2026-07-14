import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mic2, Save, Loader2, PlugZap, CheckCircle2, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";

/** 管理员后台「模型管理 › 本地 VoxCPM 端点」：配置本地 VoxCPM（Gradio TTS·参考音色克隆）的
 *  全站默认地址（DB 优先 + env 兜底）。音频节点选「本地 VoxCPM2」但未在节点里填地址时，用此默认。
 *  只需一个 baseUrl（Gradio 服务无 key/model：音色靠参考音频、端点名固定）。 */
export function VoxcpmEndpointSection() {
  const utils = trpc.useUtils();
  const q = trpc.admin.models.getVoxcpmEndpoint.useQuery();
  const saveMut = trpc.admin.models.setVoxcpmEndpoint.useMutation();
  const testMut = trpc.admin.models.testVoxcpmEndpoint.useMutation();

  const [baseUrl, setBaseUrl] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { if (q.data) setBaseUrl(q.data.baseUrl ?? ""); }, [q.data]);

  const sourceLabel: Record<string, string> = {
    db: "后台配置（本页）", env: "环境变量 VOXCPM_BASE_URL", none: "未配置",
  };

  const save = async () => {
    const u = baseUrl.trim();
    if (u && !/^https?:\/\//i.test(u)) { toast.error("地址必须以 http:// 或 https:// 开头"); return; }
    try {
      await saveMut.mutateAsync({ baseUrl: u });
      await utils.admin.models.getVoxcpmEndpoint.invalidate();
      toast.success(u ? "已保存 VoxCPM 全站默认地址，音频节点未填地址时即用它" : "已清空后台配置，回退环境变量兜底");
    } catch (e) {
      toast.error("保存失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 160));
    }
  };

  const test = async () => {
    setTestResult(null);
    try {
      const r = await testMut.mutateAsync();
      if (r.ok) setTestResult({ ok: true, text: `连通正常 · ${r.host ?? ""} · ${r.ms ?? "?"}ms` });
      else setTestResult({ ok: false, text: r.error || "连通失败" });
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof Error ? e.message : "测试失败" });
    }
  };

  const box: React.CSSProperties = { fontSize: 12, padding: "7px 9px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", width: "100%" };

  return (
    <div style={{ border: "1px solid var(--c-bd2)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
        <Mic2 className="w-4 h-4" style={{ color: "oklch(0.70 0.16 300)" }} /> 本地 VoxCPM 端点（Gradio TTS · 参考音色克隆）
      </div>
      <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.6, margin: 0 }}>
        这是<strong>本地 / 自托管 VoxCPM（Gradio TTS）的全站默认地址</strong>。音频节点选「本地 VoxCPM2」配音时，
        <strong>若节点里没填「Gradio 服务地址」就用这里的默认</strong>（省得每个节点各填一次）。留空则回退环境变量 <code>VOXCPM_BASE_URL</code>。
        <br />
        ⚠️ 这是<strong>「部署后端的服务器」去访问 VoxCPM 的地址、不是浏览器</strong>：后端在宿主机→填那台机 IP:端口（如 <code>http://172.16.0.177:8808</code>）；后端在 Docker 里→ <code>http://host.docker.internal:8808</code>。
        <br />
        （VoxCPM 无需 key/model：音色靠参考音频克隆、Gradio 端点名固定。语音<strong>转写</strong>whisper 是另一处「语音/转写端点」，别混。）
      </p>

      {q.data && (
        <div style={{ fontSize: 11, color: "var(--c-t3)", padding: "6px 10px", borderRadius: 8, background: "var(--c-bd1)", border: "1px solid var(--c-bd2)" }}>
          当前生效来源：<strong style={{ color: "var(--c-t1)" }}>{sourceLabel[q.data.source] ?? q.data.source}</strong>
          {q.data.source === "none" && <span style={{ color: "oklch(0.72 0.16 28)" }}>——VoxCPM 全站默认未配置（节点需各自填地址）</span>}
          {q.data.source === "env" && q.data.envBaseUrl && <span> · env <code>{q.data.envBaseUrl}</code></span>}
        </div>
      )}

      <label style={{ fontSize: 11, color: "var(--c-t3)" }}>Gradio 服务地址（base）
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://172.16.0.177:8808  （容器内后端用 http://host.docker.internal:8808）" className="nodrag" style={{ ...box, marginTop: 4 }} />
      </label>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={save} disabled={saveMut.isPending} className="nodrag flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg"
          style={{ fontSize: 12, fontWeight: 700, background: "oklch(0.7 0.16 150)", border: "1px solid oklch(0.7 0.16 150 / 0.5)", color: "#06250f", cursor: saveMut.isPending ? "not-allowed" : "pointer" }}>
          {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 保存配置
        </button>
        <button onClick={test} disabled={testMut.isPending} className="nodrag flex items-center gap-1.5 px-3 py-2 rounded-lg"
          style={{ fontSize: 12, fontWeight: 600, background: "oklch(0.70 0.16 300 / 0.14)", border: "1px solid oklch(0.70 0.16 300 / 0.4)", color: "oklch(0.72 0.14 300)", cursor: testMut.isPending ? "not-allowed" : "pointer" }}>
          {testMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />} 测试连通（对当前生效地址）
        </button>
        {testResult && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: testResult.ok ? "oklch(0.7 0.16 150)" : "oklch(0.7 0.18 28)" }}>
            {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />} {testResult.text}
          </span>
        )}
      </div>
      <p style={{ fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.6, margin: 0 }}>
        「测试连通」对当前<strong>实际生效</strong>的地址发一次 GET（Gradio 根路径可达即通）。保存后再测。
      </p>
    </div>
  );
}
