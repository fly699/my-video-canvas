import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plug, Save, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";

/** 管理员后台「模型管理 › 桥接 MCP 配置」：贴一段 `{mcpServers:{...}}` JSON（或服务器上一个配置文件路径），
 *  保存后本机 Claude 桥接（claude-local）即可调这些 MCP 服务器（如 ComfyUI）与技能。配置存 DB（替代
 *  CLAUDE_BRIDGE_* 环境变量），保存即生效、无需重启（下一次桥接请求就用上）。 */
export function BridgeMcpSection() {
  const utils = trpc.useUtils();
  const q = trpc.admin.models.getBridgeMcp.useQuery();
  const saveMut = trpc.admin.models.setBridgeMcp.useMutation();

  const [mcpConfig, setMcpConfig] = useState("");
  const [skills, setSkills] = useState(false);
  const [strict, setStrict] = useState(true);
  const [permissionMode, setPermissionMode] = useState("");
  const [allowedTools, setAllowedTools] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [inspectResult, setInspectResult] = useState<{ kind: string; servers: string[]; exists?: boolean; error?: string } | null>(null);

  // 服务端按桥接同款逻辑解析 mcpConfig（读文件/解析 JSON），当场回报「文件存不存在 / 读出几个服务器」。
  const runInspect = async () => {
    setInspecting(true); setInspectResult(null);
    try {
      const r = await utils.admin.models.inspectBridgeMcp.fetch({ mcpConfig: mcpConfig.trim() });
      setInspectResult(r);
    } catch (e) {
      setInspectResult({ kind: "error", servers: [], error: e instanceof Error ? e.message : String(e) });
    } finally { setInspecting(false); }
  };

  useEffect(() => {
    if (q.data) {
      setMcpConfig(q.data.mcpConfig ?? "");
      setSkills(!!q.data.skills);
      setStrict(q.data.strict !== false);
      setPermissionMode(q.data.permissionMode ?? "");
      setAllowedTools(q.data.allowedTools ?? "");
    }
  }, [q.data]);

  // 内联 JSON 时前端先试解析：非法给红条、合法则把 mcpServers 键名列成徽章预览（将放行 mcp__<name>）。
  const preview = useMemo<{ error?: string; servers: string[] }>(() => {
    const t = mcpConfig.trim();
    if (!t) return { servers: [] };
    if (!t.startsWith("{")) return { servers: [] }; // 文件路径形式，不解析
    try {
      const o = JSON.parse(t) as { mcpServers?: Record<string, unknown> };
      if (!o.mcpServers || typeof o.mcpServers !== "object") return { error: "缺少 mcpServers 对象", servers: [] };
      return { servers: Object.keys(o.mcpServers) };
    } catch {
      return { error: "不是合法 JSON", servers: [] };
    }
  }, [mcpConfig]);

  const save = async () => {
    const t = mcpConfig.trim();
    if (t.startsWith("{") && preview.error) { toast.error("MCP 配置" + preview.error + "，请修正后再保存"); return; }
    try {
      await saveMut.mutateAsync({ mcpConfig: t, skills, strict, permissionMode: permissionMode.trim(), allowedTools: allowedTools.trim() });
      await utils.admin.models.getBridgeMcp.invalidate();
      toast.success("已保存桥接 MCP 配置，下一次桥接请求即生效（无需重启）");
    } catch (e) {
      toast.error("保存失败：" + (e instanceof Error ? e.message : String(e)).slice(0, 140));
    }
  };

  const box: React.CSSProperties = { fontSize: 12, padding: "7px 9px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", width: "100%" };
  const toggleRow = (on: boolean, set: (v: boolean) => void, label: string, hint: string) => (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--c-t2)", cursor: "pointer" }}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="nodrag" style={{ marginTop: 2 }} />
      <span><strong>{label}</strong><br /><span style={{ fontSize: 11, color: "var(--c-t3)" }}>{hint}</span></span>
    </label>
  );

  return (
    <div style={{ border: "1px solid var(--c-bd2)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
        <Plug className="w-4 h-4" style={{ color: "oklch(0.68 0.19 285)" }} /> 桥接 MCP 配置（本机 Claude 桥接的 MCP / 技能增强）
      </div>
      <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.7, margin: 0 }}>
        让「本机 Claude（订阅）」桥接能调 <strong>MCP 服务器</strong>（如 ComfyUI）与运行 <strong>技能</strong>。
        把 <code>{"C:\\Users\\你\\.claude.json"}</code> 里的 <code>mcpServers</code> 片段整段贴进下面框（形如
        <code>{'{"mcpServers":{"comfyui-a":{"command":"npx","args":["-y","comfyui-mcp"],"env":{"COMFYUI_URL":"http://172.16.0.10:8188"}}}}'}</code>），
        或填服务器上一个配置文件的<strong>绝对路径</strong>。保存后<strong>下一次桥接请求即生效，无需重启</strong>（替代手动改 <code>.env</code> 的 <code>CLAUDE_BRIDGE_MCP_CONFIG</code>）。
        <br />
        <span style={{ color: "var(--c-t4)" }}>注：桥接子进程跑在 <code>{"CLAUDE_CONFIG_DIR=C:\\avc\\claude"}</code>（非你的 <code>{"~/.claude.json"}</code>），
        故<strong>内联 JSON 最稳</strong>——它不依赖 claude 自带的 MCP 注册。MCP 程序本身由配置里的 <code>command</code>（如 <code>npx -y comfyui-mcp</code>）在请求时自动拉起/下载，首次联网下载可能较慢，建议在服务器 <code>npm i -g</code> 全局装好以免首请求超时。
        ⚠️ 这会把工具/MCP 能力开放给桥接口，请仅在内网/受信任部署开启，别接可写文件系统/跑命令的高危 MCP。</span>
      </p>

      {/* 醒目提示：两个最常见踩坑 —— 覆盖 .env、OAuth MCP 需在 allowedTools 手动放行 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderRadius: 10, background: "oklch(0.75 0.15 60 / 0.10)", border: "1px solid oklch(0.75 0.15 60 / 0.35)" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "oklch(0.72 0.15 60)" }}>⚠️ 两个必看要点（照此填，别再改 .env）</div>
        <p style={{ fontSize: 11, color: "var(--c-t2)", lineHeight: 1.8, margin: 0 }}>
          <strong>1. 本页配置优先、覆盖 <code>.env</code>：</strong>只要这里存了配置，<code>.env</code> 里的 <code>CLAUDE_BRIDGE_*</code> 就<strong>被忽略</strong>——改 <code>.env</code> 不生效，一切以本页为准。
          <br />
          <strong>2. 同时用 OAuth 型 MCP（如 higgsfield）+ 本地 MCP（如 comfyui）时：</strong>
          ① 下面「严格模式」<strong>关闭</strong>（否则忽略 claude 自带的 OAuth 配置，higgsfield 就没了）；
          ② 一旦「严格模式」关了并依赖 OAuth 的 higgsfield，它<strong>不在上面这份配置里</strong>，不会被自动放行——必须在下面「高级 › allowedTools」里<strong>手动</strong>把 <code>mcp__higgsfield</code> 连同每个 <code>mcp__comfyui-*</code> 都列全（allowedTools 一旦填写就<strong>只放行你列的这些</strong>，漏了就没工具）。
        </p>
      </div>

      {/* 本地离线三步法（推荐）：装一次 → 改成本地命令 → 填文件路径 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderRadius: 10, background: "oklch(0.70 0.15 160 / 0.08)", border: "1px solid oklch(0.70 0.15 160 / 0.3)" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "oklch(0.70 0.13 160)" }}>接 ComfyUI MCP · 本地离线三步法（推荐，装一次后不再联网）</div>
        <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.8, margin: 0 }}>
          <strong>1) 服务器装一次</strong>（仅这步联网）：<code>npm i -g comfyui-mcp</code>。装完落本机全局，之后离线秒起（只连内网 ComfyUI，不碰外网）。
          <br /><strong>2) 写好一个 mcp.json</strong>（如 <code>{"C:\\avc\\mcp.json"}</code>），每台 ComfyUI 一条，启动方式用本地命令 <code>cmd /c comfyui-mcp</code>（别用 <code>npx -y</code>，那样每次联网）：
        </p>
        <div style={{ fontSize: 10.5, color: "oklch(0.70 0.13 160)", fontWeight: 600 }}>📄 mcp.json 示例内容（只读 · 放到服务器文件里，别填到本页输入框）</div>
        <pre style={{ fontSize: 10.5, fontFamily: "monospace", margin: 0, padding: "8px 10px", borderRadius: 8, background: "oklch(0.70 0.15 160 / 0.06)", border: "1px dashed oklch(0.70 0.15 160 / 0.4)", color: "var(--c-t2)", overflowX: "auto", lineHeight: 1.5, userSelect: "text" }}>{`{
  "mcpServers": {
    "comfyui-a":      { "command": "cmd", "args": ["/c", "comfyui-mcp"], "env": { "COMFYUI_URL": "http://172.16.0.10:8188" } },
    "comfyui-b-8188": { "command": "cmd", "args": ["/c", "comfyui-mcp"], "env": { "COMFYUI_URL": "http://172.16.0.8:8188" } }
  }
}`}</pre>
        <p style={{ fontSize: 11, color: "var(--c-t3)", lineHeight: 1.8, margin: 0 }}>
          <strong>3) 下面框里只填这个文件的绝对路径</strong>（如 <code>{"C:\\avc\\mcp.json"}</code>）→ 保存。不用把整段 JSON 贴进来，填路径即可（会自动读出服务器名放行 <code>mcp__*</code>）。多台就在 mcp.json 里加行、IP/端口按实际改；只要一台就删掉多余的行。
        </p>
      </div>

      {/* MCP 配置 —— 唯一的输入框 */}
      <label style={{ fontSize: 11, color: "var(--c-t2)", fontWeight: 700 }}>✏️ 在此输入 —— MCP 配置（填 <code>{"C:\\avc\\mcp.json"}</code> 这样的文件路径，或直接贴 <code>{"{mcpServers:{...}}"}</code> JSON；留空=不挂 MCP）
        <textarea value={mcpConfig} onChange={(e) => setMcpConfig(e.target.value)} rows={6}
          placeholder={`C:\\avc\\mcp.json\n\n（或直接把整段 {"mcpServers":{...}} JSON 贴在这里）`}
          className="nodrag" style={{ ...box, marginTop: 4, fontFamily: "monospace", resize: "vertical" }} />
      </label>

      {/* 测试读取：填了文件路径时页面无法在浏览器里读服务器文件，靠这个按钮让服务端读一遍回报结果 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={runInspect} disabled={inspecting || !mcpConfig.trim()} className="nodrag flex items-center gap-1.5"
          style={{ fontSize: 11.5, fontWeight: 700, padding: "6px 12px", borderRadius: 8, cursor: inspecting ? "wait" : "pointer",
            background: "oklch(0.68 0.19 285 / 0.14)", border: "1px solid oklch(0.68 0.19 285 / 0.4)", color: "oklch(0.72 0.16 285)" }}>
          {inspecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />} 测试读取 / 解析（服务端）
        </button>
        <span style={{ fontSize: 10.5, color: "var(--c-t4)" }}>填文件路径时，用这个确认服务器上真读到了、解析出几个 MCP。</span>
      </div>
      {inspectResult && (
        inspectResult.servers.length > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11, padding: "8px 10px", borderRadius: 8, background: "oklch(0.70 0.15 160 / 0.10)", border: "1px solid oklch(0.70 0.15 160 / 0.35)" }}>
            <span style={{ fontWeight: 700, color: "oklch(0.70 0.13 160)" }}>✓ 读到 {inspectResult.servers.length} 个：</span>
            {inspectResult.servers.map((n) => (
              <span key={n} style={{ padding: "2px 8px", borderRadius: 999, background: "oklch(0.70 0.15 160 / 0.14)", border: "1px solid oklch(0.70 0.15 160 / 0.4)", color: "oklch(0.70 0.13 160)", fontFamily: "monospace" }}>mcp__{n}</span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11.5, padding: "8px 10px", borderRadius: 8, background: "oklch(0.70 0.16 25 / 0.10)", border: "1px solid oklch(0.70 0.16 25 / 0.35)", color: "oklch(0.72 0.16 28)", lineHeight: 1.6 }}>
            <span style={{ fontWeight: 700 }}>✗ 没读到任何 MCP 服务器。</span>{inspectResult.error ? " " + inspectResult.error : ""}
            <br /><span style={{ color: "var(--c-t4)" }}>常见原因：文件路径写错 / 服务器上根本没有这个文件 / 文件里没有 mcpServers。可改为「直接把整段 JSON 贴进上面框」——那样最稳，页面会立刻显示解析结果。</span>
          </div>
        )
      )}

      {/* 解析预览 / 错误 */}
      {preview.error && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, padding: "8px 10px", borderRadius: 8, background: "oklch(0.70 0.16 25 / 0.10)", border: "1px solid oklch(0.70 0.16 25 / 0.35)", color: "oklch(0.72 0.16 28)" }}>
          <span style={{ fontWeight: 700 }}>⚠</span><span>MCP 配置{preview.error}（内联 JSON 必须合法且含 <code>mcpServers</code> 对象）。</span>
        </div>
      )}
      {preview.servers.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11 }}>
          <span style={{ color: "var(--c-t3)" }}>将放行：</span>
          {preview.servers.map((n) => (
            <span key={n} style={{ padding: "2px 8px", borderRadius: 999, background: "oklch(0.68 0.19 285 / 0.14)", border: "1px solid oklch(0.68 0.19 285 / 0.4)", color: "oklch(0.72 0.16 285)", fontFamily: "monospace" }}>mcp__{n}</span>
          ))}
        </div>
      )}

      {/* 开关 */}
      {toggleRow(skills, setSkills, "启用技能（Skill 工具）", "对应 CLAUDE_BRIDGE_SKILLS=1，放行 Skill 工具让桥接能跑技能。")}
      {toggleRow(strict, setStrict, "严格模式（--strict-mcp-config）", "默认开：只认上面这份配置、忽略 claude 自带（~/.claude）里的 MCP。用 OAuth 型 MCP（如 higgsfield，靠 claude mcp add/login 把凭证存在 claude 自带配置里）时必须【关闭】才能合并进来；关闭后记得在下面 allowedTools 手动放行它的 mcp__<名>。")}

      {/* 高级项（折叠） */}
      <button onClick={() => setShowAdvanced((v) => !v)} className="nodrag flex items-center gap-1 self-start"
        style={{ fontSize: 11.5, fontWeight: 600, color: "var(--c-t2)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} 高级（一般无需改）
      </button>
      {showAdvanced && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 12, borderLeft: "2px solid var(--c-bd2)" }}>
          <label style={{ fontSize: 11, color: "var(--c-t3)" }}>权限模式 permissionMode（留空=default）
            <input value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)} placeholder="default" className="nodrag" style={{ ...box, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 11, color: "var(--c-t3)" }}>allowedTools 覆盖（逗号分隔）
            <span style={{ display: "block", fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.7, marginTop: 2 }}>
              留空 = 自动放行「只读工具集 + Skill + 上面配置里每个 mcp__*」。<strong>一旦填写就完全替换默认</strong>，只放行你列的这些。
              关了严格模式、要用 OAuth 的 higgsfield 时，它不在上面配置里、不会被自动放行 → 必须在此把它连同所有本地 MCP 一起列全。
              例：<code style={{ wordBreak: "break-all" }}>mcp__higgsfield,mcp__comfyui-a,mcp__comfyui-a-8189,…,mcp__comfyui-b-8191</code>
            </span>
            <input value={allowedTools} onChange={(e) => setAllowedTools(e.target.value)} placeholder="留空=自动放行；填了就要列全（含 mcp__higgsfield + 每个 mcp__comfyui-*）" className="nodrag" style={{ ...box, marginTop: 4 }} />
          </label>
        </div>
      )}

      <button onClick={save} disabled={saveMut.isPending} className="nodrag flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg self-start"
        style={{ fontSize: 12, fontWeight: 700, background: "oklch(0.7 0.16 150)", border: "1px solid oklch(0.7 0.16 150 / 0.5)", color: "#06250f", cursor: saveMut.isPending ? "not-allowed" : "pointer" }}>
        {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 保存配置
      </button>
    </div>
  );
}
