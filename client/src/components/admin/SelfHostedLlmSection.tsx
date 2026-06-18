import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Server, ClipboardPaste, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { parseCurlLlm } from "@/lib/parseCurlLlm";

type Model = { id: string; label: string };

/** 管理员后台「模型管理 › 自建 LLM」：粘贴 curl 即可登记一个 OpenAI 兼容的自建 LLM 服务器
 *  （vLLM / Ollama / LM Studio …）。配置存 DB（替代环境变量），保存后全站模型选择器即出现。 */
export function SelfHostedLlmSection() {
  const utils = trpc.useUtils();
  const q = trpc.admin.models.getSelfHostedLlm.useQuery();
  const saveMut = trpc.admin.models.setSelfHostedLlm.useMutation();

  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [curl, setCurl] = useState("");

  useEffect(() => {
    if (q.data) { setUrl(q.data.url ?? ""); setApiKey(q.data.apiKey ?? ""); setModels(q.data.models ?? []); }
  }, [q.data]);

  const applyCurl = () => {
    const p = parseCurlLlm(curl);
    if (!p.url && !p.model) { toast.error("没从 curl 里解析出地址或模型，请检查粘贴内容"); return; }
    if (p.url) setUrl(p.url);
    if (p.apiKey) setApiKey(p.apiKey);
    if (p.model) setModels((prev) => prev.some((m) => m.id === p.model) ? prev : [...prev, { id: p.model!, label: p.model! }]);
    toast.success(`已解析${p.url ? " · 地址" : ""}${p.model ? " · 模型 " + p.model : ""}${p.apiKey ? " · 密钥" : ""}`);
    setCurl("");
  };

  const save = async () => {
    const cleanModels = models.filter((m) => m.id.trim()).map((m) => ({ id: m.id.trim(), label: (m.label || m.id).trim() }));
    if (url.trim() && cleanModels.length === 0) { toast.error("配置了地址就至少要登记一个模型 id"); return; }
    // 反向守卫：填了模型却没地址 → 后端 configured=false、模型不会进任何选择器（静默消失），明确报错。
    if (cleanModels.length > 0 && !url.trim()) { toast.error("登记了模型就必须填「服务器地址」，否则模型不会出现在选择器里"); return; }
    try {
      await saveMut.mutateAsync({ url: url.trim(), apiKey: apiKey, models: cleanModels });
      await Promise.all([utils.admin.models.getSelfHostedLlm.invalidate(), utils.config.selfHostedLlmModels.invalidate()]);
      toast.success("已保存自建 LLM 配置，全站模型选择器即时生效");
    } catch (e) {
      toast.error("保存失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 140));
    }
  };

  const box: React.CSSProperties = { fontSize: 12, padding: "7px 9px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", width: "100%" };

  return (
    <div style={{ border: "1px solid var(--c-bd2)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
        <Server className="w-4 h-4" style={{ color: "oklch(0.70 0.16 200)" }} /> 自建 LLM（OpenAI 兼容端点）
      </div>
      <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.6, margin: 0 }}>
        vLLM / Ollama / LM Studio 等。粘贴官方示例 curl 一键解析地址 + 模型 + 密钥；保存后该模型出现在全站选择器，
        门控与 ComfyUI 自建一致（走「ComfyUI 免白名单」开关，零云成本）。地址支持内网（仅服务器访问）。
      </p>

      {/* curl 粘贴 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea value={curl} onChange={(e) => setCurl(e.target.value)} placeholder={`粘贴 curl，如：\ncurl http://172.16.0.10:8000/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"Qwen3.6-35B-A3B-FP8","messages":[...]}'`}
          rows={3} className="nodrag" style={{ ...box, fontFamily: "monospace", resize: "vertical" }} />
        <button onClick={applyCurl} disabled={!curl.trim()} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg self-start"
          style={{ fontSize: 11.5, fontWeight: 600, background: "oklch(0.70 0.16 200 / 0.16)", border: "1px solid oklch(0.70 0.16 200 / 0.4)", color: "oklch(0.7 0.14 200)", cursor: curl.trim() ? "pointer" : "not-allowed" }}>
          <ClipboardPaste className="w-3.5 h-3.5" /> 从 curl 解析填入
        </button>
      </div>

      {/* 配了模型却没填地址 → 模型不会出现在任何选择器（后端 configured=false）。常驻红条提醒。 */}
      {models.some((m) => m.id.trim()) && !url.trim() && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11.5, lineHeight: 1.6, padding: "8px 10px", borderRadius: 8, background: "oklch(0.70 0.16 25 / 0.10)", border: "1px solid oklch(0.70 0.16 25 / 0.35)", color: "oklch(0.72 0.16 28)" }}>
          <span style={{ fontWeight: 700 }}>⚠</span>
          <span>已登记模型但<strong>「服务器地址」为空</strong>——这样保存后模型<strong>不会出现在任何下拉里</strong>。请在下方填服务器地址（如 <code>http://172.16.0.10:8000</code>）。</span>
        </div>
      )}

      {/* 字段 */}
      <label style={{ fontSize: 11, color: "var(--c-t3)" }}>服务器地址（base，自动去掉 /v1/chat/completions）<span style={{ color: "oklch(0.7 0.16 25)" }}> *必填</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://172.16.0.10:8000" className="nodrag" style={{ ...box, marginTop: 4 }} />
      </label>
      <label style={{ fontSize: 11, color: "var(--c-t3)" }}>API Key（无鉴权可留空）
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="（vLLM 默认无鉴权 → 留空）" className="nodrag" style={{ ...box, marginTop: 4 }} />
      </label>

      {/* 模型列表 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 11, color: "var(--c-t3)" }}>模型（id 必须与服务器一致；label 是选择器里显示的名字）</div>
        {models.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 6 }}>
            <input value={m.id} onChange={(e) => setModels((p) => p.map((x, j) => j === i ? { ...x, id: e.target.value } : x))} placeholder="模型 id，如 Qwen3.6-35B-A3B-FP8" className="nodrag" style={{ ...box, flex: 2 }} />
            <input value={m.label} onChange={(e) => setModels((p) => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="显示名（可选）" className="nodrag" style={{ ...box, flex: 1 }} />
            <button onClick={() => setModels((p) => p.filter((_, j) => j !== i))} className="nodrag px-2 rounded-lg" style={{ background: "oklch(0.65 0.2 25 / 0.12)", border: "1px solid oklch(0.65 0.2 25 / 0.35)", color: "oklch(0.65 0.2 25)", cursor: "pointer" }}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <button onClick={() => setModels((p) => [...p, { id: "", label: "" }])} className="nodrag flex items-center gap-1 px-2.5 py-1.5 rounded-lg self-start" style={{ fontSize: 11, background: "var(--c-bd1)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}><Plus className="w-3 h-3" /> 加一个模型</button>
      </div>

      <button onClick={save} disabled={saveMut.isPending} className="nodrag flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg self-start"
        style={{ fontSize: 12, fontWeight: 700, background: "oklch(0.7 0.16 150)", border: "1px solid oklch(0.7 0.16 150 / 0.5)", color: "#06250f", cursor: saveMut.isPending ? "not-allowed" : "pointer" }}>
        {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 保存配置
      </button>
    </div>
  );
}
