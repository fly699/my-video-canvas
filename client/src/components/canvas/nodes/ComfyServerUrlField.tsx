import { useCallback, useMemo, useState } from "react";
import { RefreshCw, Plus, X, Activity } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useComfyServersStore } from "../../../hooks/useComfyServersStore";

const MAX_SERVERS = 20;

function statusLine(s: { online: boolean; vramFreeMB?: number; vramTotalMB?: number; queueRunning?: number; queuePending?: number; version?: string; error?: string } | undefined): string {
  if (!s) return "";
  if (!s.online) return s.error || "离线";
  const parts: string[] = [];
  if (typeof s.vramFreeMB === "number" && typeof s.vramTotalMB === "number") {
    parts.push(`${(s.vramFreeMB / 1024).toFixed(1)}/${(s.vramTotalMB / 1024).toFixed(1)}G 空闲`);
  }
  const q = (s.queueRunning ?? 0) + (s.queuePending ?? 0);
  if (s.queueRunning != null || s.queuePending != null) parts.push(`队列 ${q}`);
  if (s.version) parts.push(`v${s.version}`);
  return parts.join(" · ") || "在线";
}

/**
 * ComfyUI 服务器地址录入栏（多地址）。
 * - 输入框 + datalist：可手填或从已保存地址中快速选择。
 * - ＋按钮：把当前地址保存到列表（去重，随节点 payload 持久化）。
 * - 刷新按钮：刷新所有已录入地址的模型并集（由父级的 onRefresh 触发）。
 * - 地址 chips：点击选用、× 移除。
 */
export function ComfyServerUrlField({
  id, value, onChange, serverUrls, onChangeServerUrls,
  isFetching, onRefresh, accent, borderAccent, borderDefault, fieldBase,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  serverUrls: string[];
  onChangeServerUrls: (next: string[]) => void;
  /** 提供则渲染"刷新模型"按钮；工作流节点无模型拉取，可省略。 */
  isFetching?: boolean;
  onRefresh?: () => void;
  accent: string;
  borderAccent: string;
  borderDefault: string;
  fieldBase: React.CSSProperties;
}) {
  // Global, cross-project server registry (localStorage). The displayed list is
  // the union of this node's legacy per-node addresses and the global registry;
  // new saves go to the global registry so every node can pick them.
  const globalServers = useComfyServersStore((s) => s.servers);
  const addGlobalServer = useComfyServersStore((s) => s.add);
  const removeGlobalServer = useComfyServersStore((s) => s.remove);
  const allServers = useMemo(
    () => Array.from(new Set([...serverUrls, ...globalServers])),
    [serverUrls, globalServers],
  );

  const saveCurrent = useCallback(() => {
    const u = value.trim();
    if (!u) { toast.info("请先填写服务器地址"); return; }
    if (allServers.includes(u)) { toast.info("该地址已在列表中"); return; }
    if (allServers.length >= MAX_SERVERS) { toast.info(`地址数量已达上限（${MAX_SERVERS}）`); return; }
    addGlobalServer(u);
    toast.success("已保存到全局服务器列表（所有节点可选）");
  }, [value, allServers, addGlobalServer]);

  const remove = useCallback((u: string) => {
    // Remove from both sources so it disappears regardless of where it lived.
    removeGlobalServer(u);
    if (serverUrls.includes(u)) onChangeServerUrls(serverUrls.filter((s) => s !== u));
  }, [serverUrls, onChangeServerUrls, removeGlobalServer]);

  // Live server status (online · VRAM · queue), fetched on demand.
  const [probe, setProbe] = useState(false);
  const probeUrls = useMemo(
    () => Array.from(new Set([value.trim(), ...allServers].filter(Boolean))),
    [value, allServers],
  );
  const statusQuery = trpc.comfyui.serverStatus.useQuery(
    { baseUrls: probeUrls },
    { enabled: probe && probeUrls.length > 0, refetchOnWindowFocus: false, staleTime: 15_000 },
  );
  const statusByUrl = useMemo(
    () => new Map((statusQuery.data ?? []).map((s) => [s.baseUrl, s] as const)),
    [statusQuery.data],
  );
  const onCheckStatus = useCallback(() => {
    if (probeUrls.length === 0) { toast.info("请先填写服务器地址"); return; }
    if (!probe) setProbe(true); else statusQuery.refetch();
  }, [probe, probeUrls.length, statusQuery]);

  return (
    <>
      <div className="flex items-center gap-1.5">
        <input
          placeholder="http://127.0.0.1:8188（留空使用全局默认）"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          list={`comfy-servers-${id}`}
          className="nodrag flex-1"
          style={fieldBase}
          onFocus={(e) => { e.currentTarget.style.borderColor = borderAccent; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = borderDefault; }}
        />
        <datalist id={`comfy-servers-${id}`}>
          {allServers.map((u) => <option key={u} value={u} />)}
        </datalist>
        <button
          onClick={saveCurrent}
          className="nodrag flex-shrink-0 flex items-center justify-center rounded-md"
          title="保存到全局服务器列表（所有 ComfyUI 节点共用，浏览器本地持久化）"
          style={{ width: 30, height: 30, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: accent, cursor: "pointer" }}
        >
          <Plus className="w-3 h-3" />
        </button>
        <button
          onClick={onCheckStatus}
          disabled={statusQuery.isFetching}
          className="nodrag flex-shrink-0 flex items-center justify-center rounded-md"
          title="检测服务器状态（在线 · 显存空闲 · 队列深度）"
          style={{ width: 30, height: 30, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: statusQuery.isFetching ? "var(--c-t4)" : accent, cursor: statusQuery.isFetching ? "wait" : "pointer" }}
        >
          <Activity className={statusQuery.isFetching ? "w-3 h-3 animate-pulse" : "w-3 h-3"} />
        </button>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isFetching}
            className="nodrag flex-shrink-0 flex items-center justify-center rounded-md"
            title="刷新模型列表（拉取所有已录入服务器的 checkpoint / lora 等并合并）"
            style={{
              width: 30, height: 30,
              background: "var(--c-surface)",
              border: "1px solid var(--c-bd2)",
              color: isFetching ? "var(--c-t4)" : accent,
              cursor: isFetching ? "wait" : "pointer",
            }}
          >
            <RefreshCw className={isFetching ? "w-3 h-3 animate-spin" : "w-3 h-3"} />
          </button>
        )}
      </div>
      {/* Live status of the currently-typed address (shown after a probe). */}
      {probe && value.trim() && (() => {
        const s = statusByUrl.get(value.trim());
        if (!s && !statusQuery.isFetching) return null;
        const online = s?.online === true;
        return (
          <div className="flex items-center gap-1.5 mt-1.5" style={{ fontSize: 10, color: "var(--c-t3)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: statusQuery.isFetching && !s ? "var(--c-t4)" : online ? "oklch(0.72 0.18 150)" : "oklch(0.62 0.20 25)" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {statusQuery.isFetching && !s ? "检测中…" : statusLine(s)}
            </span>
          </div>
        );
      })()}
      {allServers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {allServers.map((u) => {
            const active = value.trim() === u;
            const s = probe ? statusByUrl.get(u) : undefined;
            return (
              <span key={u} className="inline-flex items-center gap-1 rounded-md"
                style={{ fontSize: 10, padding: "2px 4px 2px 7px", background: active ? `${accent}1f` : "var(--c-surface)", border: `1px solid ${active ? borderAccent : "var(--c-bd2)"}`, color: active ? accent : "var(--c-t2)" }}>
                {s && (
                  <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: s.online ? "oklch(0.72 0.18 150)" : "oklch(0.62 0.20 25)" }} title={s.online ? statusLine(s) : (s.error || "离线")} />
                )}
                <button onClick={() => onChange(u)} className="nodrag" style={{ cursor: "pointer", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s ? `${u}\n${s.online ? statusLine(s) : (s.error || "离线")}` : `使用 ${u}`}>{u}</button>
                <button onClick={() => remove(u)} className="nodrag flex items-center" style={{ cursor: "pointer", color: "var(--c-t4)" }} title="从列表移除"><X style={{ width: 10, height: 10 }} /></button>
              </span>
            );
          })}
        </div>
      )}
    </>
  );
}
