import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Server, ClipboardPaste, Plus, Trash2, Save, Loader2, Sparkles } from "lucide-react";
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

  // 一键填入的桥接地址：优先用服务端上报的真实回环地址（http://127.0.0.1:内部端口/api/claude-bridge），
  // 公网隧道下不再把公网域名填进去（老写法虽也能通——服务端会强制重写回环——但显示公网地址误导人）。
  // 服务端未上报（老服务端/启动早期）才兜底页面 origin。
  const bridgeUrl = () => q.data?.bridgeLocalUrl || `${window.location.origin}/api/claude-bridge`;

  // 「本机 Claude（订阅）」一键接入：把服务器地址/模型填成本机桥接的默认值（服务端会自动补
  // /v1/chat/completions）。API Key 需管理员填成与服务端环境变量 CLAUDE_LOCAL_BRIDGE_KEY
  // 一致的值——一键只填地址与模型，key 留给你手动粘贴。
  const applyClaudeLocal = () => {
    setUrl(bridgeUrl());
    // 模型切换约定：id 冒号后缀会被桥接透传给 `claude --model`（sonnet/opus/haiku 或完整模型 id）；
    // 无后缀 = 订阅默认模型。Sonnet 各档订阅都可用；Opus 需 Max 档订阅（Pro 选了会报错）。
    const CLAUDE_LOCAL_MODELS: Model[] = [
      { id: "claude-local", label: "本机 Claude（订阅默认）" },
      { id: "claude-local:sonnet", label: "本机 Claude · Sonnet" },
      { id: "claude-local:opus", label: "本机 Claude · Opus（需 Max）" },
    ];
    setModels((prev) => [...prev, ...CLAUDE_LOCAL_MODELS.filter((m) => !prev.some((p) => p.id === m.id))]);
    toast.success("已填入本机 Claude 地址与 3 个模型（默认/Sonnet/Opus），请把 API Key 填成与服务端 CLAUDE_LOCAL_BRIDGE_KEY 一致的值再保存");
  };

  // 「本机 GPT（ChatGPT 订阅）」一键接入：与 Claude 共用同一桥接地址与 Key，按模型前缀分流。
  // 只需服务器装 @openai/codex 并放好订阅登录凭证（~/.codex/auth.json），加模型条目即可。
  const applyGptLocal = () => {
    setUrl(bridgeUrl());
    // 只预置「订阅默认」一条：具体模型名随 codex 版本/账号变动（真机翻车：预置的 gpt-5.3-codex
    // 在用户账号报「未找到模型元数据」+4xx）。想固定模型：先在服务器验证
    // `codex exec --skip-git-repo-check -m 模型名 "hi"` 能通，再手动加 `gpt-local:模型名` 条目。
    const GPT_LOCAL_MODELS: Model[] = [
      { id: "gpt-local", label: "本机 GPT（订阅默认）" },
    ];
    setModels((prev) => [...prev, ...GPT_LOCAL_MODELS.filter((m) => !prev.some((p) => p.id === m.id))]);
    toast.success("已填入本机 GPT 模型条目（与 Claude 同地址同 Key）——确认服务器已装 @openai/codex 并放好 ~/.codex/auth.json");
  };

  // 「本机 Grok（SuperGrok / X Premium+ 订阅）」一键接入：与 Claude/GPT 共用同一桥接地址与 Key，按前缀分流。
  // 只预置「订阅默认」一条：Grok Build 具体 model id 随版本/账号变动，想固定先在服务器验证
  // `grok -p -m 模型名 "hi"` 能通，再手动加 `grok-local:模型名`（如 grok-local:grok-4.5）。仅文本。
  const applyGrokLocal = () => {
    setUrl(bridgeUrl());
    const GROK_LOCAL_MODELS: Model[] = [
      { id: "grok-local", label: "本机 Grok（订阅默认 · 仅文本）" },
    ];
    setModels((prev) => [...prev, ...GROK_LOCAL_MODELS.filter((m) => !prev.some((p) => p.id === m.id))]);
    toast.success("已填入本机 Grok 模型条目（与 Claude 同地址同 Key）——确认服务器已装官方 Grok Build CLI 并用 SuperGrok/X Premium+ 设备码登录，且勿设 XAI_API_KEY");
  };

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
        vLLM / Ollama / LM Studio / Open WebUI 等。粘贴官方示例 curl 一键解析地址 + 模型 + 密钥；保存后该模型出现在全站选择器，
        门控与 ComfyUI 自建一致（走「ComfyUI 免白名单」开关，零云成本）。地址支持内网（仅服务器访问）。
        <br />
        地址智能识别：填基础地址（如 <code>http://内网IP:8000</code>）会自动补 <code>/v1/chat/completions</code>；
        若已含 <code>chat/completions</code>（如 Open WebUI 的 <code>http://内网IP:3000/api/chat/completions</code>）则原样使用。
        Open WebUI 的密钥在其「设置 › 账户」生成。
      </p>

      {/* 本机 Claude（订阅）一键接入 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 10, background: "oklch(0.68 0.19 285 / 0.08)", border: "1px solid oklch(0.68 0.19 285 / 0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "oklch(0.72 0.16 285)" }}>
          <Sparkles className="w-4 h-4" /> 本机 Claude（订阅）接入
        </div>
        <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.7, margin: 0 }}>
          用你的 <strong>Claude 订阅（Pro/Max）</strong>额度跑画布里的 AI 对话/规划，<strong>不按 token 计费</strong>。原理：服务端把请求转成本机一次 <code>claude -p</code>。三步：
          <br />1) 服务器装 Claude Code：<code>npm i -g @anthropic-ai/claude-code</code>，再 <code>claude setup-token</code> 登录订阅，把拿到的 token 设为服务端环境变量 <code>CLAUDE_CODE_OAUTH_TOKEN</code>（<strong>切勿</strong>同时设 ANTHROPIC_API_KEY，否则变按量计费）。
          <br />2) 服务端再设一个自定义口令环境变量 <code>CLAUDE_LOCAL_BRIDGE_KEY</code>（任意字符串，用于鉴权；不设=桥接不启用）。重启服务。
          <br />3) 点下面「一键填入」→ 把下方 <strong>API Key</strong> 填成与 <code>CLAUDE_LOCAL_BRIDGE_KEY</code> 完全一致的值 → 保存。之后画布模型选择器里会出现「本机 Claude」的 <strong>订阅默认 / Sonnet / Opus</strong> 三个条目，选哪个就用哪个模型（Opus 需 Max 档订阅；也可手动加 <code>claude-local:haiku</code> 或 <code>claude-local:完整模型id</code> 条目）。
          <br /><span style={{ color: "var(--c-t4)" }}>注：额度受订阅用量上限约束、会被限流；订阅计费本为交互式使用，用作后端批量属灰色地带。「一键填入」会自动使用本机回环地址 <code>http://127.0.0.1:内部端口/api/claude-bridge</code>（公网隧道部署也不绕公网）。</span>
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={applyClaudeLocal} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
            style={{ fontSize: 11.5, fontWeight: 600, background: "oklch(0.68 0.19 285 / 0.16)", border: "1px solid oklch(0.68 0.19 285 / 0.45)", color: "oklch(0.72 0.16 285)", cursor: "pointer" }}>
            <Sparkles className="w-3.5 h-3.5" /> 一键填入本机 Claude
          </button>
          <button onClick={applyGptLocal} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
            style={{ fontSize: 11.5, fontWeight: 600, background: "oklch(0.70 0.15 160 / 0.16)", border: "1px solid oklch(0.70 0.15 160 / 0.45)", color: "oklch(0.70 0.13 160)", cursor: "pointer" }}>
            <Sparkles className="w-3.5 h-3.5" /> 一键填入本机 GPT（ChatGPT 订阅）
          </button>
          <button onClick={applyGrokLocal} className="nodrag flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
            style={{ fontSize: 11.5, fontWeight: 600, background: "oklch(0.62 0.02 260 / 0.16)", border: "1px solid oklch(0.62 0.02 260 / 0.45)", color: "var(--c-t2)", cursor: "pointer" }}>
            <Sparkles className="w-3.5 h-3.5" /> 一键填入本机 Grok（SuperGrok 订阅）
          </button>
        </div>
        <p style={{ fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.7, margin: 0 }}>
          <strong>GPT（ChatGPT Plus/Pro 订阅）接入</strong>：与 Claude 共用同一地址同一 Key（按模型前缀分流），零新增环境变量。
          服务器 <code>npm i -g @openai/codex</code> → 在能开浏览器的机器跑 <code>codex</code> 选「Sign in with ChatGPT」登录 →
          把该机 <code>~/.codex/auth.json</code> 拷到服务器同路径（Windows：<code>C:\Users\你\.codex\auth.json</code>）→ 点上面按钮加模型条目 → 保存。
          模型 id 规则同 Claude：<code>gpt-local</code>=订阅默认；想固定具体模型，<strong>先在服务器验证</strong>
          <code>codex exec --skip-git-repo-check -m 模型名 &quot;hi&quot;</code> 能通，再手动加 <code>gpt-local:模型名</code> 条目
          （无效模型名会报「未找到模型元数据」+ 4xx，有效名随 OpenAI 版本/账号变动，故不预置）。
          <strong>切勿</strong>设 <code>CODEX_API_KEY</code>（会绕过订阅变按量计费）；<code>OPENAI_API_KEY</code>（配音 TTS 在用）可共存——auth.json 在时 codex 优先走订阅，但 auth.json 没放好会静默落到它按量计费。
        </p>
        <p style={{ fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.7, margin: 0 }}>
          <strong>Grok（SuperGrok / X Premium+ 订阅）接入</strong>：用订阅额度跑 Grok 文本，<strong>仅文本</strong>（Grok Build 是编码 agent，
          <strong>不含图片/视频</strong>——Grok Imagine 生图/视频只能走 API 付费）。与 Claude/GPT 共用同一地址同一 Key。
          服务器装官方 Grok Build：<code>curl -fsSL https://x.ai/cli/install.sh | bash</code> → 在能开浏览器的机器跑 <code>grok</code> 用
          <strong>SuperGrok/X Premium+ 账号</strong>设备码登录 → 把该机 <code>~/.grok</code> 会话拷到服务器同路径 → 点上面按钮加模型条目 → 保存。
          模型 id：<code>grok-local</code>=订阅默认；想固定，<strong>先在服务器验证</strong> <code>grok -p -m grok-4.5 &quot;hi&quot;</code> 能通，再手动加 <code>grok-local:grok-4.5</code>。
          <strong>切勿</strong>在服务器设 <code>XAI_API_KEY</code>/<code>GROK_API_KEY</code>/<code>GROK_CODE_XAI_API_KEY</code>（会绕过订阅变按量计费）。
          输出异常时可设服务端 <code>GROK_BRIDGE_ARGS</code> 微调 CLI 参数。
        </p>
      </div>

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
      <label style={{ fontSize: 11, color: "var(--c-t3)" }}>服务器地址（base 自动补 /v1/chat/completions；已含 chat/completions 则原样用，如 Open WebUI）<span style={{ color: "oklch(0.7 0.16 25)" }}> *必填</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://172.16.0.10:8000  或  http://host:3000/api/chat/completions" className="nodrag" style={{ ...box, marginTop: 4 }} />
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
