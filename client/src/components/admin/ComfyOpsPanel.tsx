import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { io, type Socket } from "socket.io-client";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  Server, Gauge, TerminalSquare, Zap, Plus, Trash2, Pencil, Plug, Loader2,
  ShieldAlert, X, RefreshCw, Cpu, HardDrive, Box, Container, Play, Square, RotateCw, FileText,
  Package, Download, Stethoscope,
} from "lucide-react";

// ComfyUI 运维中心（P0）：服务器注册(SSH凭据) + 只读资源仪表盘 + 交互式终端 +
// 快捷命令执行。变更类操作 admin-only（后端 adminProcedure 强制）；危险命令服务端
// 检测、前端红色二次确认；终端走 xterm + socket.io 实时 shell。

const card: React.CSSProperties = {
  background: "var(--c-surface, #1a1a22)", border: "1px solid var(--c-bd2, rgba(255,255,255,0.08))",
  borderRadius: 14, padding: 20,
};
const input: React.CSSProperties = {
  width: "100%", padding: "8px 11px", border: "1px solid var(--c-bd2)", borderRadius: 7,
  background: "var(--c-input)", color: "var(--c-t1)", fontSize: 13, outline: "none",
};
const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 500, color: "var(--c-t2)", marginBottom: 5 };
const btnPrimary: React.CSSProperties = {
  padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: "pointer",
  background: "oklch(0.58 0.22 285 / 0.85)", border: "1px solid oklch(0.68 0.22 285 / 0.4)", color: "#fff",
};
const btnGhost: React.CSSProperties = {
  padding: "7px 12px", fontSize: 12, fontWeight: 500, borderRadius: 7, cursor: "pointer",
  background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)",
};

type SubTab = "servers" | "dashboard" | "docker" | "models" | "terminal" | "exec";
const SUB_TABS: [SubTab, string, typeof Server][] = [
  ["servers", "服务器", Server],
  ["dashboard", "资源仪表盘", Gauge],
  ["docker", "Docker", Container],
  ["models", "模型/节点", Package],
  ["terminal", "终端", TerminalSquare],
  ["exec", "快捷命令", Zap],
];

export function ComfyOpsPanel() {
  const [sub, setSub] = useState<SubTab>("servers");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {SUB_TABS.map(([key, lbl, Icon]) => (
          <button key={key} onClick={() => setSub(key)} style={{
            ...btnGhost, display: "inline-flex", alignItems: "center", gap: 7,
            background: sub === key ? "oklch(0.68 0.22 285 / 0.16)" : "var(--c-input)",
            border: `1px solid ${sub === key ? "oklch(0.68 0.22 285 / 0.4)" : "var(--c-bd2)"}`,
            color: sub === key ? "oklch(0.82 0.14 285)" : "var(--c-t2)", fontWeight: sub === key ? 700 : 500,
          }}>
            <Icon size={15} /> {lbl}
          </button>
        ))}
      </div>
      {sub === "servers" && <ServersPanel />}
      {sub === "dashboard" && <DashboardPanel />}
      {sub === "docker" && <DockerPanel />}
      {sub === "models" && <ModelsPanel />}
      {sub === "terminal" && <TerminalPanel />}
      {sub === "exec" && <ExecPanel />}
    </div>
  );
}

// ── 服务器注册 ────────────────────────────────────────────────────────────────
type ServerForm = {
  id?: number; name: string; comfyBaseUrl: string; sshHost: string; sshPort: number;
  sshUser: string; authType: "password" | "privateKey"; secret: string; passphrase: string;
  deployForm: "docker" | "bare" | "systemd"; dockerContainer: string; comfyPath: string;
  trustMode: boolean; enabled: boolean; note: string;
};
const emptyForm: ServerForm = {
  name: "", comfyBaseUrl: "", sshHost: "", sshPort: 22, sshUser: "root", authType: "password",
  secret: "", passphrase: "", deployForm: "bare", dockerContainer: "", comfyPath: "", trustMode: false, enabled: true, note: "",
};

function ServersPanel() {
  const utils = trpc.useUtils();
  const crypto = trpc.comfyOps.servers.cryptoReady.useQuery();
  const servers = trpc.comfyOps.servers.list.useQuery();
  const [form, setForm] = useState<ServerForm | null>(null);
  const [testing, setTesting] = useState<number | null>(null);

  const create = trpc.comfyOps.servers.create.useMutation({
    onSuccess: () => { toast.success("服务器已添加"); setForm(null); utils.comfyOps.servers.list.invalidate(); },
    onError: (e) => toast.error("添加失败：" + e.message),
  });
  const update = trpc.comfyOps.servers.update.useMutation({
    onSuccess: () => { toast.success("已保存"); setForm(null); utils.comfyOps.servers.list.invalidate(); },
    onError: (e) => toast.error("保存失败：" + e.message),
  });
  const del = trpc.comfyOps.servers.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); utils.comfyOps.servers.list.invalidate(); },
    onError: (e) => toast.error("删除失败：" + e.message),
  });
  const test = trpc.comfyOps.servers.testConnection.useMutation();

  const submit = () => {
    if (!form) return;
    const payload = {
      name: form.name, comfyBaseUrl: form.comfyBaseUrl || undefined, sshHost: form.sshHost,
      sshPort: form.sshPort, sshUser: form.sshUser, authType: form.authType,
      secret: form.secret || undefined, passphrase: form.passphrase || undefined,
      deployForm: form.deployForm, dockerContainer: form.dockerContainer || undefined,
      comfyPath: form.comfyPath || undefined, trustMode: form.trustMode, enabled: form.enabled, note: form.note || undefined,
    };
    if (form.id) update.mutate({ id: form.id, ...payload });
    else create.mutate(payload);
  };

  const runTest = async (id: number) => {
    setTesting(id);
    try {
      const r = await test.mutateAsync({ id });
      r.ok ? toast.success("连接成功：" + r.message) : toast.error("连接失败：" + r.message);
    } catch (e) { toast.error("测试失败：" + (e as Error).message); }
    finally { setTesting(null); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {crypto.data && !crypto.data.ready && (
        <div style={{ ...card, borderColor: "oklch(0.7 0.18 60 / 0.4)", color: "oklch(0.82 0.14 60)", fontSize: 13 }}>
          ⚠ 未配置 <code>SSH_KEY_SECRET</code> 环境变量，无法加密保存 SSH 凭据。请先在服务器 .env 配置后重启。
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, color: "var(--c-t3)" }}>已注册 {servers.data?.length ?? 0} 台服务器</div>
        <button style={{ ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 6 }}
          onClick={() => setForm({ ...emptyForm })} disabled={!crypto.data?.ready}>
          <Plus size={15} /> 添加服务器
        </button>
      </div>

      {servers.data?.map((s) => (
        <div key={s.id} style={{ ...card, display: "flex", alignItems: "center", gap: 14 }}>
          <Server size={18} style={{ color: s.enabled ? "oklch(0.7 0.18 145)" : "var(--c-t4)", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--c-t1)" }}>
              {s.name}
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: "var(--c-input)", color: "var(--c-t3)" }}>
                {s.deployForm === "docker" ? "🐳 Docker" : s.deployForm === "systemd" ? "⚙ systemd" : "🖥 裸机"}
              </span>
              {s.trustMode && <span style={{ marginLeft: 6, fontSize: 11, color: "oklch(0.78 0.16 60)" }}>· 信任模式</span>}
              {!s.enabled && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--c-t4)" }}>· 已停用</span>}
            </div>
            <div style={{ fontSize: 12, color: "var(--c-t3)", marginTop: 2 }}>
              {s.sshUser}@{s.sshHost}:{s.sshPort} · {s.authType === "privateKey" ? "私钥" : "密码"}
              {s.secretLast4 ? ` (…${s.secretLast4})` : ""}{s.comfyBaseUrl ? ` · API ${s.comfyBaseUrl}` : ""}
            </div>
          </div>
          <button style={btnGhost} onClick={() => runTest(s.id)} disabled={testing === s.id}>
            {testing === s.id ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} 测试
          </button>
          <button style={btnGhost} onClick={() => setForm({
            ...emptyForm, id: s.id, name: s.name, comfyBaseUrl: s.comfyBaseUrl ?? "", sshHost: s.sshHost,
            sshPort: s.sshPort, sshUser: s.sshUser, authType: s.authType, deployForm: s.deployForm,
            dockerContainer: s.dockerContainer ?? "", comfyPath: s.comfyPath ?? "", trustMode: s.trustMode,
            enabled: s.enabled, note: s.note ?? "", secret: "", passphrase: "",
          })}><Pencil size={14} /></button>
          <button style={{ ...btnGhost, color: "oklch(0.65 0.2 25)" }}
            onClick={() => { if (confirm(`确认删除服务器「${s.name}」？`)) del.mutate({ id: s.id }); }}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      {form && (
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{form.id ? "编辑服务器" : "添加服务器"}</div>
            <button style={btnGhost} onClick={() => setForm(null)}><X size={15} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={label}>显示名</label><input style={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label style={label}>ComfyUI API 地址（可空）</label><input style={input} placeholder="http://192.168.0.10:8188" value={form.comfyBaseUrl} onChange={(e) => setForm({ ...form, comfyBaseUrl: e.target.value })} /></div>
            <div><label style={label}>SSH 主机</label><input style={input} placeholder="192.168.0.10" value={form.sshHost} onChange={(e) => setForm({ ...form, sshHost: e.target.value })} /></div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ width: 90 }}><label style={label}>端口</label><input style={input} type="number" value={form.sshPort} onChange={(e) => setForm({ ...form, sshPort: Number(e.target.value) || 22 })} /></div>
              <div style={{ flex: 1 }}><label style={label}>用户</label><input style={input} value={form.sshUser} onChange={(e) => setForm({ ...form, sshUser: e.target.value })} /></div>
            </div>
            <div><label style={label}>认证方式</label>
              <select style={input} value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value as ServerForm["authType"] })}>
                <option value="password">密码</option><option value="privateKey">私钥</option>
              </select>
            </div>
            <div><label style={label}>部署形态</label>
              <select style={input} value={form.deployForm} onChange={(e) => setForm({ ...form, deployForm: e.target.value as ServerForm["deployForm"] })}>
                <option value="bare">裸机</option><option value="docker">Docker</option><option value="systemd">systemd</option>
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={label}>{form.authType === "privateKey" ? "私钥（PEM）" : "密码"}{form.id ? "（留空=不修改）" : ""}</label>
              {form.authType === "privateKey"
                ? <textarea style={{ ...input, minHeight: 90, fontFamily: "monospace", fontSize: 11 }} value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                : <input style={input} type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />}
            </div>
            {form.authType === "privateKey" && (
              <div><label style={label}>私钥口令（可空）</label><input style={input} type="password" value={form.passphrase} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} /></div>
            )}
            {form.deployForm === "docker" && (
              <div><label style={label}>容器名</label><input style={input} value={form.dockerContainer} onChange={(e) => setForm({ ...form, dockerContainer: e.target.value })} /></div>
            )}
            <div><label style={label}>ComfyUI 路径（可空）</label><input style={input} placeholder="/opt/ComfyUI" value={form.comfyPath} onChange={(e) => setForm({ ...form, comfyPath: e.target.value })} /></div>
            <div style={{ gridColumn: "1 / -1" }}><label style={label}>备注</label><input style={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          </div>
          <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--c-t2)", cursor: "pointer" }}>
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> 启用
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--c-t2)", cursor: "pointer" }}>
              <input type="checkbox" checked={form.trustMode} onChange={(e) => setForm({ ...form, trustMode: e.target.checked })} /> 信任模式（安全命令可自动执行）
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button style={btnGhost} onClick={() => setForm(null)}>取消</button>
            <button style={btnPrimary} onClick={submit} disabled={create.isPending || update.isPending}>
              {(create.isPending || update.isPending) ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 资源仪表盘（只读）─────────────────────────────────────────────────────────
function bar(used: number, total: number, color: string) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--c-bd1)", overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color }} />
    </div>
  );
}

function DashboardPanel() {
  const dash = trpc.comfyOps.dashboard.useQuery(undefined, { refetchInterval: 5000 });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, color: "var(--c-t3)" }}>每 5 秒自动刷新 · 仅显示已配 ComfyUI API 地址的服务器</div>
        <button style={btnGhost} onClick={() => dash.refetch()}><RefreshCw size={14} /> 刷新</button>
      </div>
      {dash.data?.length === 0 && <div style={{ ...card, color: "var(--c-t3)", fontSize: 13 }}>暂无服务器。请先在「服务器」页添加。</div>}
      {dash.data?.map((s) => {
        const st = s.status;
        const vramTotal = st?.vramTotalMB ?? 0, vramFree = st?.vramFreeMB ?? 0, vramUsed = vramTotal - vramFree;
        const ramTotal = st?.ramTotalMB ?? 0, ramFree = st?.ramFreeMB ?? 0, ramUsed = ramTotal - ramFree;
        return (
          <div key={s.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: st?.online ? "oklch(0.7 0.18 145)" : "oklch(0.65 0.2 25)" }} />
              <div style={{ fontSize: 14, fontWeight: 700 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: "var(--c-t3)" }}>{s.comfyBaseUrl}</div>
              {st?.version && <span style={{ fontSize: 11, color: "var(--c-t4)" }}>v{st.version}</span>}
              <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--c-t3)" }}>
                {st?.online ? `队列 运行 ${st.queueRunning ?? 0} / 等待 ${st.queuePending ?? 0}` : (st?.error ? `离线：${st.error}` : "离线")}
              </div>
            </div>
            {st?.online && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--c-t3)", marginBottom: 4 }}><Cpu size={12} /> GPU {st.gpuUtilization != null ? `${st.gpuUtilization}%` : "—"}</div>
                  {bar(st.gpuUtilization ?? 0, 100, "oklch(0.68 0.2 285)")}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--c-t3)", marginBottom: 4 }}><HardDrive size={12} /> 显存 {(vramUsed / 1024).toFixed(1)}/{(vramTotal / 1024).toFixed(1)}G</div>
                  {bar(vramUsed, vramTotal, "oklch(0.7 0.18 145)")}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--c-t3)", marginBottom: 4 }}><Box size={12} /> 内存 {(ramUsed / 1024).toFixed(1)}/{(ramTotal / 1024).toFixed(1)}G</div>
                  {bar(ramUsed, ramTotal, "oklch(0.7 0.16 230)")}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 模型 / LoRA / 自定义节点 ──────────────────────────────────────────────────
const MODEL_CATS: [string, string][] = [
  ["ckpts", "Checkpoint"], ["loras", "LoRA"], ["vaes", "VAE"], ["controlnets", "ControlNet"],
  ["ipadapters", "IPAdapter"], ["clips", "CLIP"], ["unets", "UNet"], ["upscaleModels", "放大模型"],
  ["clipVisions", "CLIP Vision"], ["embeddings", "Embedding"],
];
const MODEL_DIRS_UI = ["checkpoints", "loras", "vae", "controlnet", "clip", "text_encoders", "unet", "diffusion_models", "ipadapter", "upscale_models", "embeddings", "clip_vision", "style_models"] as const;

function ModelsPanel() {
  const servers = trpc.comfyOps.servers.list.useQuery();
  const [serverId, setServerId] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const models = trpc.comfyOps.models.list.useQuery({ serverId: serverId! }, { enabled: serverId != null, retry: false });
  const nodes = trpc.comfyOps.models.nodes.useQuery({ serverId: serverId! }, { enabled: serverId != null, retry: false });
  const [gitUrl, setGitUrl] = useState("");
  const [dlUrl, setDlUrl] = useState(""); const [dlDir, setDlDir] = useState<typeof MODEL_DIRS_UI[number]>("checkpoints"); const [dlName, setDlName] = useState("");
  const [errText, setErrText] = useState(""); const [hint, setHint] = useState("");

  const installNode = trpc.comfyOps.models.installNode.useMutation({
    onSuccess: (r) => { r.ok ? toast.success("节点已安装，请重启 ComfyUI") : toast.error("安装失败，见输出"); setGitUrl(""); nodes.refetch(); },
    onError: (e) => toast.error("安装失败：" + e.message),
  });
  const installModelMut = trpc.comfyOps.models.installModel.useMutation({
    onSuccess: (r) => { r.ok ? toast.success("模型已下载") : toast.error("下载失败，见输出"); setDlUrl(""); setDlName(""); },
    onError: (e) => toast.error("下载失败：" + e.message),
  });
  const diagnose = async () => {
    if (!errText.trim()) return;
    try { const r = await utils.comfyOps.models.diagnose.fetch({ errorText: errText }); setHint(r.hint); }
    catch (e) { toast.error("诊断失败：" + (e as Error).message); }
  };

  const m = models.data as Record<string, string[]> | undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <select style={{ ...input, maxWidth: 280 }} value={serverId ?? ""} onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : null)}>
        <option value="">选择服务器…</option>
        {servers.data?.filter((s) => s.enabled).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      {serverId == null && <div style={{ ...card, color: "var(--c-t3)", fontSize: 13 }}>选择一台服务器查看其模型与自定义节点。模型列表走 ComfyUI API（需配 API 地址），节点/安装走 SSH（需配 comfyPath）。</div>}

      {serverId != null && (
        <>
          {/* 模型清单 */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Box size={16} style={{ color: "oklch(0.7 0.18 145)" }} />
              <div style={{ fontSize: 14, fontWeight: 700 }}>模型清单（ComfyUI API）</div>
              <button style={{ ...btnGhost, marginLeft: "auto" }} onClick={() => models.refetch()}><RefreshCw size={13} /> 刷新</button>
            </div>
            {models.isLoading && <div style={{ fontSize: 13, color: "var(--c-t3)" }}>加载中…</div>}
            {models.error && <div style={{ fontSize: 13, color: "oklch(0.7 0.2 25)" }}>读取失败：{models.error.message}</div>}
            {m && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {MODEL_CATS.map(([key, lbl]) => (
                  <span key={key} title={(m[key] ?? []).slice(0, 30).join("\n")} style={{ fontSize: 12, padding: "5px 11px", borderRadius: 8, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t2)" }}>
                    {lbl} <b style={{ color: "var(--c-t1)" }}>{(m[key] ?? []).length}</b>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 自定义节点 */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Package size={16} style={{ color: "oklch(0.68 0.2 285)" }} />
              <div style={{ fontSize: 14, fontWeight: 700 }}>自定义节点（{nodes.data?.length ?? 0}）</div>
              <button style={{ ...btnGhost, marginLeft: "auto" }} onClick={() => nodes.refetch()}><RefreshCw size={13} /> 刷新</button>
            </div>
            {nodes.error && <div style={{ fontSize: 13, color: "oklch(0.7 0.2 25)" }}>{nodes.error.message}</div>}
            {nodes.data && nodes.data.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 160, overflow: "auto" }}>
                {nodes.data.map((n) => <span key={n.name} style={{ fontSize: 11.5, padding: "3px 8px", borderRadius: 6, background: "var(--c-input)", color: "var(--c-t3)" }}>{n.isGit ? "📦" : "📁"} {n.name}</span>)}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <input style={input} placeholder="https://github.com/作者/插件仓库  (git clone 安装)" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} />
              <button style={{ ...btnPrimary, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }} disabled={installNode.isPending || !gitUrl.trim()}
                onClick={() => serverId != null && installNode.mutate({ serverId, gitUrl: gitUrl.trim() })}>
                {installNode.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 安装节点
              </button>
            </div>
          </div>

          {/* 下载模型 */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>下载模型 / LoRA</div>
            <input style={input} placeholder="模型直链 URL（https）" value={dlUrl} onChange={(e) => setDlUrl(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <select style={{ ...input, maxWidth: 200 }} value={dlDir} onChange={(e) => setDlDir(e.target.value as typeof MODEL_DIRS_UI[number])}>
                {MODEL_DIRS_UI.map((d) => <option key={d} value={d}>models/{d}</option>)}
              </select>
              <input style={input} placeholder="保存文件名（如 model.safetensors）" value={dlName} onChange={(e) => setDlName(e.target.value)} />
              <button style={{ ...btnPrimary, whiteSpace: "nowrap" }} disabled={installModelMut.isPending || !dlUrl.trim() || !dlName.trim()}
                onClick={() => serverId != null && installModelMut.mutate({ serverId, url: dlUrl.trim(), dir: dlDir, filename: dlName.trim() })}>
                {installModelMut.isPending ? <Loader2 size={14} className="animate-spin" /> : "下载"}
              </button>
            </div>
          </div>

          {/* 错误诊断 */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Stethoscope size={16} style={{ color: "oklch(0.75 0.16 60)" }} />
              <div style={{ fontSize: 14, fontWeight: 700 }}>错误诊断（缺节点 / 缺文件 / 维度不匹配）</div>
            </div>
            <textarea style={{ ...input, minHeight: 70, fontFamily: "monospace", fontSize: 11.5 }} placeholder="把 ComfyUI 报错原文贴进来，自动给出修复建议" value={errText} onChange={(e) => setErrText(e.target.value)} />
            <button style={{ ...btnPrimary, alignSelf: "flex-start" }} onClick={diagnose} disabled={!errText.trim()}>诊断</button>
            {hint && <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--c-t2)", background: "var(--c-input)", border: "1px solid var(--c-bd2)", borderRadius: 8, padding: 12, whiteSpace: "pre-wrap" }}>{hint}</div>}
          </div>
        </>
      )}
    </div>
  );
}

// ── 交互式终端 ────────────────────────────────────────────────────────────────
function TerminalPanel() {
  const servers = trpc.comfyOps.servers.list.useQuery();
  const [serverId, setServerId] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const sessionRef = useRef<string | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const disconnect = () => {
    const s = socketRef.current, sid = sessionRef.current;
    if (s && sid) s.emit("ops:term:close", { sessionId: sid });
    s?.disconnect();
    socketRef.current = null; sessionRef.current = null;
    xtermRef.current?.dispose(); xtermRef.current = null;
    setConnected(false);
  };
  useEffect(() => () => disconnect(), []);

  const connect = () => {
    if (serverId == null || !termRef.current) return;
    disconnect();
    const term = new Terminal({ fontSize: 13, fontFamily: "monospace", theme: { background: "#0b0e16" }, cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);
    try { fit.fit(); } catch { /* ignore */ }
    xtermRef.current = term; fitRef.current = fit;

    const socket = io("/", { path: "/api/socket", transports: ["websocket", "polling"], withCredentials: true });
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("ops:term:open", { serverId, cols: term.cols, rows: term.rows }, (r: { sessionId?: string; error?: string }) => {
        if (r.error || !r.sessionId) { term.writeln(`\r\n\x1b[31m连接失败：${r.error ?? "未知"}\x1b[0m`); return; }
        sessionRef.current = r.sessionId; setConnected(true);
        term.onData((d) => socket.emit("ops:term:input", { sessionId: r.sessionId, data: d }));
        term.onResize(({ cols, rows }) => socket.emit("ops:term:resize", { sessionId: r.sessionId, cols, rows }));
      });
    });
    socket.on("ops:term:data", (d: { sessionId: string; chunk: string }) => { if (d.sessionId === sessionRef.current) term.write(d.chunk); });
    socket.on("ops:term:exit", () => { term.writeln("\r\n\x1b[33m[会话已结束]\x1b[0m"); setConnected(false); });
  };

  useEffect(() => {
    const onResize = () => { try { fitRef.current?.fit(); } catch { /* ignore */ } };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <select style={{ ...input, maxWidth: 280 }} value={serverId ?? ""} onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">选择服务器…</option>
          {servers.data?.filter((s) => s.enabled).map((s) => <option key={s.id} value={s.id}>{s.name}（{s.sshHost}）</option>)}
        </select>
        {!connected
          ? <button style={btnPrimary} onClick={connect} disabled={serverId == null}>连接</button>
          : <button style={{ ...btnGhost, color: "oklch(0.65 0.2 25)" }} onClick={disconnect}>断开</button>}
        <span style={{ fontSize: 12, color: connected ? "oklch(0.7 0.18 145)" : "var(--c-t4)" }}>{connected ? "● 已连接" : "○ 未连接"}</span>
      </div>
      <div ref={termRef} style={{ height: 460, borderRadius: 10, overflow: "hidden", border: "1px solid var(--c-bd2)", background: "#0b0e16", padding: 6 }} />
    </div>
  );
}

// ── Docker 容器管理 ───────────────────────────────────────────────────────────
function DockerPanel() {
  const servers = trpc.comfyOps.servers.list.useQuery();
  const [serverId, setServerId] = useState<number | null>(null);
  const [logs, setLogs] = useState<{ container: string; text: string } | null>(null);
  const utils = trpc.useUtils();
  const list = trpc.comfyOps.docker.list.useQuery({ serverId: serverId! }, { enabled: serverId != null, refetchInterval: 8000, retry: false });
  const action = trpc.comfyOps.docker.action.useMutation({
    onSuccess: (_r, v) => { toast.success(`已${v.action === "start" ? "启动" : v.action === "stop" ? "停止" : "重启"} ${v.container}`); utils.comfyOps.docker.list.invalidate(); },
    onError: (e) => toast.error("操作失败：" + e.message),
  });

  const fetchLogs = async (container: string) => {
    if (serverId == null) return;
    try {
      const text = await utils.comfyOps.docker.logs.fetch({ serverId, container, tail: 300 });
      setLogs({ container, text: text || "(无日志)" });
    } catch (e) { toast.error("拉取日志失败：" + (e as Error).message); }
  };

  const running = (state: string) => /up|running/i.test(state);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <select style={{ ...input, maxWidth: 280 }} value={serverId ?? ""} onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">选择服务器…</option>
          {servers.data?.filter((s) => s.enabled).map((s) => <option key={s.id} value={s.id}>{s.name}{s.deployForm === "docker" ? " 🐳" : ""}</option>)}
        </select>
        {serverId != null && <button style={btnGhost} onClick={() => list.refetch()}><RefreshCw size={14} /> 刷新</button>}
        {list.isFetching && <Loader2 size={14} className="animate-spin" style={{ color: "var(--c-t3)" }} />}
      </div>

      {serverId == null && <div style={{ ...card, color: "var(--c-t3)", fontSize: 13 }}>选择一台服务器查看其 Docker 容器。</div>}
      {list.error && <div style={{ ...card, color: "oklch(0.7 0.2 25)", fontSize: 13 }}>读取失败：{list.error.message}</div>}
      {list.data?.length === 0 && <div style={{ ...card, color: "var(--c-t3)", fontSize: 13 }}>该服务器无容器（或未安装 docker）。</div>}

      {list.data?.map((c) => (
        <div key={c.id} style={{ ...card, display: "flex", alignItems: "center", gap: 14, padding: 16 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: running(c.state || c.status) ? "oklch(0.7 0.18 145)" : "var(--c-t4)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--c-t1)" }}>{c.name || c.id}</div>
            <div style={{ fontSize: 12, color: "var(--c-t3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.image} · {c.status}{c.stat ? ` · CPU ${c.stat.cpu} · 内存 ${c.stat.mem}` : ""}{c.ports ? ` · ${c.ports}` : ""}
            </div>
          </div>
          <button style={btnGhost} title="日志" onClick={() => fetchLogs(c.name || c.id)}><FileText size={14} /></button>
          {running(c.state || c.status)
            ? <>
                <button style={btnGhost} title="重启" disabled={action.isPending} onClick={() => action.mutate({ serverId: serverId!, container: c.name || c.id, action: "restart" })}><RotateCw size={14} /></button>
                <button style={{ ...btnGhost, color: "oklch(0.75 0.16 60)" }} title="停止" disabled={action.isPending} onClick={() => action.mutate({ serverId: serverId!, container: c.name || c.id, action: "stop" })}><Square size={14} /></button>
              </>
            : <button style={{ ...btnGhost, color: "oklch(0.7 0.18 145)" }} title="启动" disabled={action.isPending} onClick={() => action.mutate({ serverId: serverId!, container: c.name || c.id, action: "start" })}><Play size={14} /></button>}
        </div>
      ))}

      {logs && (
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>📋 {logs.container} 日志（最近 300 行）</div>
            <button style={btnGhost} onClick={() => setLogs(null)}><X size={14} /></button>
          </div>
          <pre style={{ fontSize: 11.5, fontFamily: "monospace", whiteSpace: "pre-wrap", maxHeight: 380, overflow: "auto", color: "var(--c-t2)", margin: 0 }}>{logs.text}</pre>
        </div>
      )}
    </div>
  );
}

// ── 快捷命令执行 ──────────────────────────────────────────────────────────────
const QUICK_CMDS: [string, string][] = [
  ["nvidia-smi", "GPU 状态"], ["df -h", "磁盘占用"], ["free -m", "内存"],
  ["docker ps", "容器列表"], ["uptime", "负载"], ["ls -la", "列目录"],
];

function ExecPanel() {
  const servers = trpc.comfyOps.servers.list.useQuery();
  const [serverId, setServerId] = useState<number | null>(null);
  const [cmd, setCmd] = useState("");
  const [out, setOut] = useState("");
  const classify = trpc.comfyOps.classify.useQuery({ command: cmd }, { enabled: cmd.trim().length > 0 });
  const exec = trpc.comfyOps.exec.useMutation();

  const run = async (confirmedDangerous = false) => {
    if (serverId == null || !cmd.trim()) return;
    try {
      const r = await exec.mutateAsync({ serverId, command: cmd, confirmedDangerous });
      if (r.blocked) {
        if (confirm(`⚠ 危险命令：\n${r.reasons.join("\n")}\n\n确认仍要执行？`)) return run(true);
        return;
      }
      setOut(`$ ${cmd}\n${r.output}\n[退出码 ${r.exitCode}${r.timedOut ? " · 超时" : ""} · ${r.durationMs}ms]`);
    } catch (e) { setOut("执行失败：" + (e as Error).message); }
  };

  const dangerous = classify.data?.dangerous;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select style={{ ...input, maxWidth: 280 }} value={serverId ?? ""} onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">选择服务器…</option>
          {servers.data?.filter((s) => s.enabled).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {QUICK_CMDS.map(([c, lbl]) => <button key={c} style={btnGhost} onClick={() => setCmd(c)} title={c}>{lbl}</button>)}
      </div>
      <textarea style={{ ...input, minHeight: 70, fontFamily: "monospace" }} value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="输入要执行的命令（支持多行）" />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button style={{ ...btnPrimary, background: dangerous ? "oklch(0.55 0.22 25 / 0.9)" : btnPrimary.background, borderColor: dangerous ? "oklch(0.6 0.22 25)" : undefined }}
          onClick={() => run(false)} disabled={exec.isPending || serverId == null || !cmd.trim()}>
          {exec.isPending ? <Loader2 size={14} className="animate-spin" /> : dangerous ? <ShieldAlert size={14} /> : <Zap size={14} />} 执行
        </button>
        {dangerous && <span style={{ fontSize: 12, color: "oklch(0.7 0.2 25)" }}>⚠ 危险命令：{classify.data?.reasons.join("、")}（执行需二次确认）</span>}
      </div>
      {out && <pre style={{ ...card, fontSize: 12, fontFamily: "monospace", whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto", color: "var(--c-t1)" }}>{out}</pre>}
    </div>
  );
}
