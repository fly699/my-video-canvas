import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Server, ClipboardPaste, Plus, Trash2, Save, Loader2, Sparkles, ChevronUp, ChevronDown } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { parseCurlLlm } from "@/lib/parseCurlLlm";

type Model = { id: string; label: string };
type SrvCfg = { url: string; apiKey: string; models: Model[] };

/** 管理员后台「模型管理 › 自建 LLM」：可登记【多个】OpenAI 兼容的自建 LLM 服务器
 *  （vLLM / Ollama / LM Studio / 本机订阅桥接 …），每个服务器各自 URL/Key + 各自模型，按模型 id
 *  路由到其所属服务器。粘贴 curl 一键新增/合并；保存后全站模型选择器出现所有服务器的模型。 */
export function SelfHostedLlmSection() {
  const utils = trpc.useUtils();
  const q = trpc.admin.models.getSelfHostedLlm.useQuery();
  const saveMut = trpc.admin.models.setSelfHostedLlm.useMutation();

  const [servers, setServers] = useState<SrvCfg[]>([]);
  const [curl, setCurl] = useState("");

  useEffect(() => {
    if (q.data) {
      const list = (q.data.servers ?? []).map((s) => ({ url: s.url ?? "", apiKey: s.apiKey ?? "", models: s.models ?? [] }));
      setServers(list);
    }
  }, [q.data]);

  const bridgeUrl = () => q.data?.bridgeLocalUrl || `${window.location.origin}/api/claude-bridge`;

  // 更新某台服务器（不可变）。
  const patchServer = (i: number, patch: Partial<SrvCfg>) => setServers((p) => p.map((s, j) => j === i ? { ...s, ...patch } : s));
  const patchModels = (i: number, fn: (m: Model[]) => Model[]) => setServers((p) => p.map((s, j) => j === i ? { ...s, models: fn(s.models) } : s));

  // 本机订阅桥接（Claude/GPT/Grok）——三者共用同一台「桥接服务器」（url=本机回环 /api/claude-bridge）。
  // 找到已存在的桥接服务器（url 含 /api/claude-bridge），没有则新建一台；把模型条目并入它。
  const addBridgeModels = (add: Model[], hint: string) => {
    setServers((prev) => {
      const idx = prev.findIndex((s) => /\/api\/claude-bridge/i.test(s.url));
      if (idx >= 0) {
        return prev.map((s, j) => j === idx ? { ...s, models: [...s.models, ...add.filter((m) => !s.models.some((p) => p.id === m.id))] } : s);
      }
      return [...prev, { url: bridgeUrl(), apiKey: "", models: add }];
    });
    toast.success(hint);
  };
  const applyClaudeLocal = () => addBridgeModels([
    { id: "claude-local", label: "本机 Claude（订阅默认）" },
    { id: "claude-local:sonnet", label: "本机 Claude · Sonnet" },
    { id: "claude-local:opus", label: "本机 Claude · Opus（需 Max）" },
  ], "已把本机 Claude 3 个模型并入「桥接服务器」（自动新建/复用 http://127.0.0.1:内部端口/api/claude-bridge）。请把该服务器 API Key 填成与 CLAUDE_LOCAL_BRIDGE_KEY 一致再保存");
  const applyGptLocal = () => addBridgeModels([{ id: "gpt-local", label: "本机 GPT（订阅默认）" }],
    "已把本机 GPT 条目并入「桥接服务器」（与 Claude 同地址同 Key）——确认服务器已装 @openai/codex 并放好 ~/.codex/auth.json");
  const applyGrokLocal = () => addBridgeModels([{ id: "grok-local", label: "本机 Grok（订阅默认 · 仅文本）" }],
    "已把本机 Grok 条目并入「桥接服务器」（与 Claude 同地址同 Key）——确认已装官方 Grok Build CLI 并用 SuperGrok/X Premium+ 登录，勿设 XAI_API_KEY");

  // 从 curl 解析：找 url 相同的服务器则并入其模型，否则【新增一台服务器】——多次粘贴不同 curl = 多台服务器，
  // 不再互相覆盖（正是本次修复的核心）。
  const applyCurl = () => {
    const p = parseCurlLlm(curl);
    if (!p.url && !p.model) { toast.error("没从 curl 里解析出地址或模型，请检查粘贴内容"); return; }
    setServers((prev) => {
      if (p.url) {
        const idx = prev.findIndex((s) => s.url.trim() === p.url!.trim());
        if (idx >= 0) {
          return prev.map((s, j) => j === idx ? {
            ...s,
            apiKey: p.apiKey || s.apiKey,
            models: p.model && !s.models.some((m) => m.id === p.model) ? [...s.models, { id: p.model, label: p.model }] : s.models,
          } : s);
        }
        return [...prev, { url: p.url, apiKey: p.apiKey || "", models: p.model ? [{ id: p.model, label: p.model }] : [] }];
      }
      // 只解析出模型没地址：并到最后一台服务器（没有则提示先建服务器）。
      if (!prev.length) { toast.error("curl 里没有服务器地址，请先「加一个服务器」再粘贴，或在 curl 里带上地址"); return prev; }
      const last = prev.length - 1;
      return prev.map((s, j) => j === last && p.model && !s.models.some((m) => m.id === p.model) ? { ...s, models: [...s.models, { id: p.model!, label: p.model! }] } : s);
    });
    toast.success(`已解析${p.url ? " · 新增/合并服务器" : ""}${p.model ? " · 模型 " + p.model : ""}${p.apiKey ? " · 密钥" : ""}`);
    setCurl("");
  };

  const moveModel = (si: number, i: number, dir: -1 | 1) => patchModels(si, (p) => {
    const j = i + dir;
    if (j < 0 || j >= p.length) return p;
    const next = [...p];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const save = async () => {
    const trimmed = servers.map((s) => ({ url: s.url.trim(), apiKey: s.apiKey, models: s.models.filter((m) => m.id.trim()).map((m) => ({ id: m.id.trim(), label: (m.label || m.id).trim() })) }));
    // 守卫：登记了模型却没填地址 → 保存后这些模型不会进任何选择器（静默消失）。明确拦截，别让用户模型丢失。
    const orphan = trimmed.find((s) => !s.url && s.models.length > 0);
    if (orphan) { toast.error(`有服务器登记了模型却没填「服务器地址」——请补上地址，否则它的模型不会出现在选择器`); return; }
    const cleaned = trimmed.filter((s) => s.url); // 空地址且无模型的空卡：丢弃
    for (const s of cleaned) {
      if (!/^https?:\/\//i.test(s.url)) { toast.error(`地址必须以 http:// 或 https:// 开头：${s.url.slice(0, 50)}`); return; }
      if (s.models.length === 0) { toast.error(`服务器 ${s.url.slice(0, 40)} 没登记任何模型 id——请至少加一个，否则它的模型不会出现在选择器`); return; }
    }
    try {
      await saveMut.mutateAsync({ servers: cleaned });
      await Promise.all([utils.admin.models.getSelfHostedLlm.invalidate(), utils.config.selfHostedLlmModels.invalidate()]);
      toast.success(`已保存 ${cleaned.length} 台自建服务器配置，全站模型选择器即时生效`);
    } catch (e) {
      toast.error("保存失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 140));
    }
  };

  const box: React.CSSProperties = { fontSize: 12, padding: "7px 9px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", width: "100%" };
  const arrowBtn: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: 22, borderRadius: 6, background: "var(--c-bd1)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" };

  return (
    <div style={{ border: "1px solid var(--c-bd2)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
        <Server className="w-4 h-4" style={{ color: "oklch(0.70 0.16 200)" }} /> 自建 LLM（OpenAI 兼容端点 · 支持多服务器）
      </div>
      <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.6, margin: 0 }}>
        vLLM / Ollama / LM Studio / Open WebUI / 本机订阅桥接等，<strong>可登记多台服务器</strong>：每台各自地址/Key/模型，按模型自动路由到其所属服务器。
        粘贴官方示例 curl 一键<strong>新增/合并</strong>一台服务器（多次粘贴不同 curl = 多台，不再互相覆盖）。保存后这些模型出现在全站选择器，门控与 ComfyUI 自建一致（走「ComfyUI 免白名单」开关，零云成本）。地址支持内网。
        <br />
        地址智能识别：填基础地址（如 <code>http://内网IP:8000</code>）会自动补 <code>/v1/chat/completions</code>；已含 <code>chat/completions</code>（如 Open WebUI）则原样使用。
      </p>

      {/* 本机订阅桥接 一键接入（并入「桥接服务器」）*/}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 10, background: "oklch(0.68 0.19 285 / 0.08)", border: "1px solid oklch(0.68 0.19 285 / 0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "oklch(0.72 0.16 285)" }}>
          <Sparkles className="w-4 h-4" /> 本机订阅桥接（Claude / GPT / Grok）一键接入
        </div>
        <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.7, margin: 0 }}>
          用你的 <strong>Claude / ChatGPT / SuperGrok 订阅</strong>额度跑画布 AI，<strong>不按 token 计费</strong>（服务端把请求转成本机一次 CLI 调用）。三者共用<strong>同一台「桥接服务器」</strong>（地址=本机回环 <code>/api/claude-bridge</code>，一键会自动新建/复用）。
          需先在服务器装对应 CLI（<code>@anthropic-ai/claude-code</code> / <code>@openai/codex</code> / 官方 Grok Build）并放好订阅登录凭证，再设服务端口令 <code>CLAUDE_LOCAL_BRIDGE_KEY</code>；点一键后把该桥接服务器的 <strong>API Key</strong> 填成与之相同的值再保存。详见部署文档「本机 claude 桥接」。
          <br /><span style={{ color: "var(--c-t4)" }}>⚠️ 切勿同时设 ANTHROPIC_API_KEY / CODEX_API_KEY / XAI_API_KEY（会绕过订阅变按量计费）。模型 id 规则：<code>claude-local</code>/<code>gpt-local</code>/<code>grok-local</code>=订阅默认；加冒号后缀固定具体模型（如 <code>claude-local:opus</code>，需先在服务器验证能通）。</span>
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={applyClaudeLocal} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ fontSize: 11.5, fontWeight: 600, background: "oklch(0.68 0.19 285 / 0.16)", border: "1px solid oklch(0.68 0.19 285 / 0.45)", color: "oklch(0.72 0.16 285)", cursor: "pointer" }}><Sparkles className="w-3.5 h-3.5" /> 一键填入本机 Claude</button>
          <button onClick={applyGptLocal} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ fontSize: 11.5, fontWeight: 600, background: "oklch(0.70 0.15 160 / 0.16)", border: "1px solid oklch(0.70 0.15 160 / 0.45)", color: "oklch(0.70 0.13 160)", cursor: "pointer" }}><Sparkles className="w-3.5 h-3.5" /> 一键填入本机 GPT（ChatGPT 订阅）</button>
          <button onClick={applyGrokLocal} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ fontSize: 11.5, fontWeight: 600, background: "oklch(0.62 0.02 260 / 0.16)", border: "1px solid oklch(0.62 0.02 260 / 0.45)", color: "var(--c-t2)", cursor: "pointer" }}><Sparkles className="w-3.5 h-3.5" /> 一键填入本机 Grok（SuperGrok 订阅）</button>
        </div>
      </div>

      {/* curl 粘贴 → 新增/合并一台服务器 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea value={curl} onChange={(e) => setCurl(e.target.value)} placeholder={`粘贴 curl（每台服务器粘一次，自动新增/合并，不覆盖），如：\ncurl http://172.16.0.10:8000/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"Qwen3.6-35B-A3B-FP8","messages":[...]}'`}
          rows={3} className="nodrag" style={{ ...box, fontFamily: "monospace", resize: "vertical" }} />
        <button onClick={applyCurl} disabled={!curl.trim()} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg self-start"
          style={{ fontSize: 11.5, fontWeight: 600, background: "oklch(0.70 0.16 200 / 0.16)", border: "1px solid oklch(0.70 0.16 200 / 0.4)", color: "oklch(0.7 0.14 200)", cursor: curl.trim() ? "pointer" : "not-allowed" }}>
          <ClipboardPaste className="w-3.5 h-3.5" /> 从 curl 解析（新增/合并服务器）
        </button>
      </div>

      {/* 服务器卡片列表 */}
      {servers.length === 0 && <div style={{ fontSize: 11.5, color: "var(--c-t4)", padding: "8px 2px" }}>还没有自建服务器——粘贴 curl、点上方一键桥接、或点下面「加一个服务器」。</div>}
      {servers.map((s, si) => (
        <div key={si} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10, border: "1px solid var(--c-bd2)", background: "var(--c-bd1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-t2)" }}>服务器 {si + 1}{/\/api\/claude-bridge/i.test(s.url) ? "（本机桥接）" : ""}</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setServers((p) => p.filter((_, j) => j !== si))} title="删除此服务器" aria-label="删除此服务器" className="nodrag flex items-center gap-1 px-2 py-1 rounded-lg"
              style={{ fontSize: 11, background: "oklch(0.65 0.2 25 / 0.12)", border: "1px solid oklch(0.65 0.2 25 / 0.35)", color: "oklch(0.65 0.2 25)", cursor: "pointer" }}><Trash2 className="w-3.5 h-3.5" /> 删除服务器</button>
          </div>
          <label style={{ fontSize: 11, color: "var(--c-t3)" }}>服务器地址（base 自动补 /v1/chat/completions；已含 chat/completions 则原样用）<span style={{ color: "oklch(0.7 0.16 25)" }}> *必填</span>
            <input value={s.url} onChange={(e) => patchServer(si, { url: e.target.value })} placeholder="http://172.16.0.10:8000  或  http://host:3000/api/chat/completions" className="nodrag" style={{ ...box, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 11, color: "var(--c-t3)" }}>API Key（无鉴权可留空；本机桥接填与 CLAUDE_LOCAL_BRIDGE_KEY 相同的值）
            <input value={s.apiKey} onChange={(e) => patchServer(si, { apiKey: e.target.value })} placeholder="（vLLM 默认无鉴权 → 留空）" className="nodrag" style={{ ...box, marginTop: 4 }} />
          </label>
          <div style={{ fontSize: 11, color: "var(--c-t3)" }}>模型（id 必须与服务器一致；label 是选择器显示名）。上下箭头调本服务器内顺序。</div>
          {s.models.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 6 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <button onClick={() => moveModel(si, i, -1)} disabled={i === 0} title="上移" aria-label="上移" className="nodrag" style={{ ...arrowBtn, flex: 1, cursor: i === 0 ? "not-allowed" : "pointer", opacity: i === 0 ? 0.35 : 1 }}><ChevronUp className="w-3 h-3" /></button>
                <button onClick={() => moveModel(si, i, 1)} disabled={i === s.models.length - 1} title="下移" aria-label="下移" className="nodrag" style={{ ...arrowBtn, flex: 1, cursor: i === s.models.length - 1 ? "not-allowed" : "pointer", opacity: i === s.models.length - 1 ? 0.35 : 1 }}><ChevronDown className="w-3 h-3" /></button>
              </div>
              <input value={m.id} onChange={(e) => patchModels(si, (p) => p.map((x, j) => j === i ? { ...x, id: e.target.value } : x))} placeholder="模型 id，如 Qwen3.6-35B-A3B-FP8" className="nodrag" style={{ ...box, flex: 2 }} />
              <input value={m.label} onChange={(e) => patchModels(si, (p) => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="显示名（可选）" className="nodrag" style={{ ...box, flex: 1 }} />
              <button onClick={() => patchModels(si, (p) => p.filter((_, j) => j !== i))} title="删除" aria-label="删除" className="nodrag px-2 rounded-lg" style={{ background: "oklch(0.65 0.2 25 / 0.12)", border: "1px solid oklch(0.65 0.2 25 / 0.35)", color: "oklch(0.65 0.2 25)", cursor: "pointer" }}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <button onClick={() => patchModels(si, (p) => [...p, { id: "", label: "" }])} className="nodrag flex items-center gap-1 px-2.5 py-1.5 rounded-lg self-start" style={{ fontSize: 11, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}><Plus className="w-3 h-3" /> 加一个模型</button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setServers((p) => [...p, { url: "", apiKey: "", models: [] }])} className="nodrag flex items-center gap-1 px-2.5 py-2 rounded-lg" style={{ fontSize: 12, background: "var(--c-bd1)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)", cursor: "pointer" }}><Plus className="w-3.5 h-3.5" /> 加一个服务器</button>
        <button onClick={save} disabled={saveMut.isPending} className="nodrag flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg"
          style={{ fontSize: 12, fontWeight: 700, background: "oklch(0.7 0.16 150)", border: "1px solid oklch(0.7 0.16 150 / 0.5)", color: "#06250f", cursor: saveMut.isPending ? "not-allowed" : "pointer" }}>
          {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 保存配置
        </button>
      </div>
    </div>
  );
}
