import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mic, Save, Loader2, PlugZap, CheckCircle2, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";

/** 管理员后台「模型管理 › 语音/转写端点」：配置 OpenAI 兼容的 whisper 转写端点
 *  （自建 faster-whisper / speaches / Forge / OpenAI）。存 DB（DB 优先 + env 兜底），
 *  作用于语音输入兜底、字幕、动态字幕、AI 智能剪辑的全部转写。密钥不回传明文（模式B）。 */
export function TranscribeEndpointSection() {
  const utils = trpc.useUtils();
  const q = trpc.admin.models.getTranscribeEndpoint.useQuery();
  const saveMut = trpc.admin.models.setTranscribeEndpoint.useMutation();
  const testMut = trpc.admin.models.testTranscribeEndpoint.useMutation();

  const [url, setUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");        // 留空=保留原 key（模式B）
  const [keyTouched, setKeyTouched] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (q.data) { setUrl(q.data.url ?? ""); setModel(q.data.model ?? ""); }
  }, [q.data]);

  const sourceLabel: Record<string, string> = {
    db: "后台配置（本页）", env: "环境变量 TRANSCRIBE_*", forge: "内置 Forge", openai: "OpenAI 官方（OPENAI_API_KEY）", none: "未配置",
  };

  const save = async () => {
    const u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) { toast.error("地址必须以 http:// 或 https:// 开头"); return; }
    try {
      await saveMut.mutateAsync({
        url: u,
        model: model.trim(),
        // 仅在用户改动过 key 时才发送（留空且未改动=保留原值；清空 url 时后端会整条清掉）。
        ...(keyTouched ? { apiKey } : {}),
      });
      setApiKey(""); setKeyTouched(false);
      await utils.admin.models.getTranscribeEndpoint.invalidate();
      toast.success(u ? "已保存转写端点，语音/字幕转写即时生效" : "已清空后台配置，回退环境变量兜底");
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
        <Mic className="w-4 h-4" style={{ color: "oklch(0.70 0.16 200)" }} /> 语音 / 转写端点（whisper，OpenAI 兼容）
      </div>
      <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.6, margin: 0 }}>
        这是<strong>「自建 / 自定义」转写后端</strong>（OpenAI 兼容 <code>/v1/audio/transcriptions</code>：自建 faster-whisper / speaches / vLLM）。
        作用于：AI 助手/客户端<strong>语音输入</strong>在无法访问 Google 时的兜底、以及字幕 / 动态字幕 / AI 智能剪辑的转写。
        <strong>自建端点 = 零 API 费用</strong>；留空则回退环境变量 <code>TRANSCRIBE_*</code>。
        <br />
        自建最省：<code>docker run -d -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cpu</code>，地址填 <code>http://127.0.0.1:8000</code>、模型填 <code>Systran/faster-whisper-large-v3</code>、Key 随便填个非空占位串。
        <br />
        <strong>多后端并存</strong>：Groq 云端 whisper 用独立的环境变量 <code>GROQ_API_KEY</code>（不与此处冲突）；内置 Forge / OpenAI 的 whisper-1、gpt-4o-transcribe 无需在此配置。
        转写模型选择器只会列出「已配置 provider」的模型——选哪个就路由到哪个后端，所见即所得。
      </p>

      {/* 当前生效来源 */}
      {q.data && (
        <div style={{ fontSize: 11, color: "var(--c-t3)", padding: "6px 10px", borderRadius: 8, background: "var(--c-bd1)", border: "1px solid var(--c-bd2)" }}>
          当前生效来源：<strong style={{ color: "var(--c-t1)" }}>{sourceLabel[q.data.source] ?? q.data.source}</strong>
          {q.data.dbConfigured && <span>（已保存 · 密钥 {q.data.hasKey ? "已设置" : "未设置"}）</span>}
          {!q.data.dbConfigured && q.data.source === "none" && <span style={{ color: "oklch(0.72 0.16 28)" }}>——语音输入兜底不可用，请在此配置</span>}
          {q.data.envModel && q.data.source === "env" && <span> · env 模型 <code>{q.data.envModel}</code></span>}
        </div>
      )}

      <label style={{ fontSize: 11, color: "var(--c-t3)" }}>端点地址（base，自动补 /v1/audio/transcriptions）
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8000  （容器内后端用 http://host.docker.internal:8000）" className="nodrag" style={{ ...box, marginTop: 4 }} />
      </label>
      <label style={{ fontSize: 11, color: "var(--c-t3)" }}>模型（如 Systran/faster-whisper-large-v3 / whisper-1；留空用默认 whisper-1）
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Systran/faster-whisper-large-v3" className="nodrag" style={{ ...box, marginTop: 4 }} />
      </label>
      <label style={{ fontSize: 11, color: "var(--c-t3)" }}>API Key（自建通常无鉴权，也需填个非空占位串；留空=保留已保存的值）
        <input type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setKeyTouched(true); }}
          placeholder={q.data?.hasKey ? "（已设置，留空保留原值）" : "local-any-nonempty"} className="nodrag" style={{ ...box, marginTop: 4 }} />
      </label>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={save} disabled={saveMut.isPending} className="nodrag flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg"
          style={{ fontSize: 12, fontWeight: 700, background: "oklch(0.7 0.16 150)", border: "1px solid oklch(0.7 0.16 150 / 0.5)", color: "#06250f", cursor: saveMut.isPending ? "not-allowed" : "pointer" }}>
          {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 保存配置
        </button>
        <button onClick={test} disabled={testMut.isPending} className="nodrag flex items-center gap-1.5 px-3 py-2 rounded-lg"
          style={{ fontSize: 12, fontWeight: 600, background: "oklch(0.70 0.16 200 / 0.14)", border: "1px solid oklch(0.70 0.16 200 / 0.4)", color: "oklch(0.7 0.14 200)", cursor: testMut.isPending ? "not-allowed" : "pointer" }}>
          {testMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />} 测试连通（对当前生效端点）
        </button>
        {testResult && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: testResult.ok ? "oklch(0.7 0.16 150)" : "oklch(0.7 0.18 28)" }}>
            {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />} {testResult.text}
          </span>
        )}
      </div>
      <p style={{ fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.6, margin: 0 }}>
        「测试连通」验证的是<strong>当前实际生效</strong>的端点（保存后再测）——对其 <code>/v1/models</code> 发一次带鉴权的 GET，检查可达 + 鉴权。
      </p>
    </div>
  );
}
