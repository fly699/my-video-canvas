import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Server, Plus, Trash2, Plug, Loader2, CheckCircle2, XCircle } from "lucide-react";

// 管理后台「ComfyUI 服务器」独立配置页：维护全局服务器列表（comfy_settings.servers，
// 所有用户/所有节点/深度提取共用），每台可一键「测试」连通性。
// 解析优先级（服务端 resolveComfyBase）：节点自定义地址 > 环境变量 COMFYUI_BASE_URL > 本列表第一台。

const card: React.CSSProperties = { padding: 16, borderRadius: 14, background: "var(--c-surface)", border: "1px solid var(--c-bd2)" };
const input: React.CSSProperties = { width: "100%", padding: "8px 11px", borderRadius: 9, fontSize: 13, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", fontFamily: "monospace" };
const btnPrimary: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", background: "var(--ui-accent, oklch(0.62 0.19 285))", color: "#fff" };
const btnGhost: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t2)" };

export function ComfyServersPanel() {
  const utils = trpc.useUtils();
  const listQ = trpc.comfyui.globalServers.useQuery();
  const servers = listQ.data ?? [];
  // 全列表在线状态（进页自动查一轮）。
  const statusQ = trpc.comfyui.serverStatus.useQuery(
    { baseUrls: servers },
    { enabled: servers.length > 0, refetchOnWindowFocus: false, staleTime: 15_000 },
  );
  const setMut = trpc.comfyui.setGlobalServers.useMutation({
    onSuccess: () => { void utils.comfyui.globalServers.invalidate(); void utils.comfyui.serverStatus.invalidate(); },
    onError: (e) => toast.error("保存失败：" + e.message),
  });

  const [newUrl, setNewUrl] = useState("");
  const [testing, setTesting] = useState<string | null>(null);

  const statusOf = (u: string) => statusQ.data?.find((s) => s.baseUrl === u);

  const add = () => {
    const u = newUrl.trim().replace(/\/+$/, "");
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) { toast.error("地址需以 http:// 或 https:// 开头，如 http://192.168.0.10:8188"); return; }
    if (servers.includes(u)) { toast.info("该地址已在列表中"); return; }
    setMut.mutate({ servers: [...servers, u] }, { onSuccess: () => { setNewUrl(""); toast.success("已添加到全局列表"); } });
  };
  const remove = (u: string) => {
    if (!confirm(`确认从全局列表移除 ${u}？`)) return;
    setMut.mutate({ servers: servers.filter((x) => x !== u) }, { onSuccess: () => toast.success("已移除") });
  };
  const test = async (u: string) => {
    setTesting(u);
    try {
      const r = await utils.comfyui.serverStatus.fetch({ baseUrls: [u] }, { staleTime: 0 });
      const st = r?.[0];
      if (st?.online) toast.success(`连接成功：${u} 在线`);
      else toast.error(`连接失败：${st?.error || "服务器离线或不可达"}`);
      void utils.comfyui.serverStatus.invalidate();
    } catch (e) {
      toast.error("测试失败：" + (e instanceof Error ? e.message : "未知错误"));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, fontSize: 12.5, color: "var(--c-t3)", lineHeight: 1.7 }}>
        这里维护 <b style={{ color: "var(--c-t1)" }}>全局 ComfyUI 服务器列表</b>——所有用户、所有 ComfyUI 节点、深度提取（3D 换视角）、工作流分析共用。
        地址解析优先级：<b style={{ color: "var(--c-t1)" }}>节点自定义地址 → 环境变量 COMFYUI_BASE_URL → 本列表第一台</b>。
        节点没填自定义地址时，会自动用本列表的第一台，请把最常用的放在最前（先删后加即可调序）。
      </div>

      {/* 添加 */}
      <div style={{ ...card, display: "flex", gap: 10, alignItems: "center" }}>
        <input
          style={{ ...input, flex: 1 }}
          placeholder="http://192.168.0.10:8188 或 http://127.0.0.1:8188"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <button style={btnPrimary} onClick={add} disabled={setMut.isPending || !newUrl.trim()}>
          {setMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} 添加
        </button>
      </div>

      {/* 列表 */}
      {listQ.isLoading ? (
        <div style={{ ...card, color: "var(--c-t3)", fontSize: 13 }}><Loader2 size={14} className="animate-spin" style={{ display: "inline", marginRight: 6 }} />加载中…</div>
      ) : servers.length === 0 ? (
        <div style={{ ...card, color: "var(--c-t3)", fontSize: 13 }}>还没有配置任何全局服务器。在上方输入 ComfyUI 地址（默认端口 8188）并点「添加」。</div>
      ) : (
        servers.map((u, i) => {
          const st = statusOf(u);
          const checking = statusQ.isFetching && !st;
          return (
            <div key={u} style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
              <Server size={17} style={{ color: st?.online ? "oklch(0.7 0.18 145)" : "var(--c-t4)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--c-t1)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {u}
                  {i === 0 && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: "oklch(0.62 0.19 285 / 0.15)", color: "oklch(0.75 0.12 285)" }}>默认（列表第一台）</span>}
                </div>
                <div style={{ fontSize: 11.5, marginTop: 3, display: "flex", alignItems: "center", gap: 5, color: st?.online ? "oklch(0.7 0.18 145)" : "var(--c-t4)" }}>
                  {checking ? <><Loader2 size={11} className="animate-spin" /> 检测中…</>
                    : st?.online ? <><CheckCircle2 size={11} /> 在线{typeof st.queueRunning === "number" ? ` · 队列 ${st.queueRunning + (st.queuePending ?? 0)}` : ""}</>
                    : <><XCircle size={11} /> 离线{st?.error ? `：${st.error}` : ""}</>}
                </div>
              </div>
              <button style={btnGhost} onClick={() => void test(u)} disabled={testing === u}>
                {testing === u ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} 测试
              </button>
              <button style={{ ...btnGhost, color: "oklch(0.65 0.2 25)" }} onClick={() => remove(u)} disabled={setMut.isPending}>
                <Trash2 size={13} />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
