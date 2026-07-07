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

      {/* MCP 配置 */}
      <label style={{ fontSize: 11, color: "var(--c-t3)" }}>MCP 配置（<code>{"{mcpServers:{...}}"}</code> JSON，或服务器上配置文件的绝对路径；留空=不挂 MCP）
        <textarea value={mcpConfig} onChange={(e) => setMcpConfig(e.target.value)} rows={6}
          placeholder={`{\n  "mcpServers": {\n    "comfyui-a": {\n      "command": "npx",\n      "args": ["-y", "comfyui-mcp"],\n      "env": { "COMFYUI_URL": "http://172.16.0.10:8188" }\n    }\n  }\n}`}
          className="nodrag" style={{ ...box, marginTop: 4, fontFamily: "monospace", resize: "vertical" }} />
      </label>

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
      {toggleRow(strict, setStrict, "严格模式（--strict-mcp-config）", "默认开：只认上面这份配置。若用 OAuth 型 MCP（靠 claude mcp add 存凭证在自带配置里），需关闭本项才能合并进来。")}

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
          <label style={{ fontSize: 11, color: "var(--c-t3)" }}>allowedTools 覆盖（逗号分隔；留空=默认只读工具集 Read/Glob/Grep/WebSearch/WebFetch + Skill + 各 mcp__*）
            <input value={allowedTools} onChange={(e) => setAllowedTools(e.target.value)} placeholder="留空即用默认" className="nodrag" style={{ ...box, marginTop: 4 }} />
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
