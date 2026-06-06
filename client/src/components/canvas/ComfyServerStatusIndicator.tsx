import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Server, Plus, X, Cpu, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useComfyServersStore } from "../../hooks/useComfyServersStore";
import { aggregateComfyStatus, type ComfyServerStatus } from "../../lib/comfyAggregateStatus";

// Load → colour for a gauge fill (green → amber → red).
function loadColor(pct: number | null): string {
  if (pct == null) return "var(--c-bd3)";
  if (pct >= 85) return "oklch(0.63 0.23 25)";    // red
  if (pct >= 60) return "oklch(0.75 0.16 80)";    // amber
  return "oklch(0.72 0.18 155)";                  // green
}

const dotColor = (h: string): string =>
  h === "ok" ? "oklch(0.72 0.18 155)"
    : h === "degraded" ? "oklch(0.75 0.16 80)"
    : h === "offline" ? "oklch(0.63 0.23 25)"
    : "var(--c-t4)";

const gb = (mb?: number) => (typeof mb === "number" ? (mb / 1024).toFixed(1) + "G" : "—");

/** A tiny vertical gauge (equalizer-style) used in the compact bar. */
function MiniBar({ label, pct, title }: { label: string; pct: number | null; title: string }) {
  const h = pct == null ? 0 : Math.max(6, pct); // keep a sliver so an active bar is visible
  return (
    <div title={title} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
      <div style={{ position: "relative", width: 3.5, height: 12, borderRadius: 2, background: "var(--c-bd1)", overflow: "hidden" }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${h}%`, background: loadColor(pct), transition: "height 400ms ease, background 300ms ease" }} />
      </div>
      <span style={{ fontSize: 6.5, lineHeight: 1, color: "var(--c-t4)", fontWeight: 700 }}>{label}</span>
    </div>
  );
}

/** A labelled horizontal bar used in the detail panel. */
function PanelBar({ label, pct, valueText }: { label: string; pct: number | null; valueText: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 26, fontSize: 9.5, color: "var(--c-t3)", fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--c-bd1)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct ?? 0}%`, background: loadColor(pct), transition: "width 400ms ease" }} />
      </div>
      <span style={{ width: 64, textAlign: "right", fontSize: 9.5, color: "var(--c-t2)", fontVariantNumeric: "tabular-nums" }}>{valueText}</span>
    </div>
  );
}

export function ComfyServerStatusIndicator() {
  const servers = useComfyServersStore((s) => s.servers);
  const addServer = useComfyServersStore((s) => s.add);
  const removeServer = useComfyServersStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [btnRect, setBtnRect] = useState<DOMRect | null>(null);
  const [draft, setDraft] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);

  const statusQuery = trpc.comfyui.serverStatus.useQuery(
    { baseUrls: servers },
    { refetchInterval: 5000, refetchOnWindowFocus: true, staleTime: 4000 },
  );
  const statuses = (statusQuery.data ?? []) as ComfyServerStatus[];
  const agg = aggregateComfyStatus(statuses);

  useEffect(() => {
    if (open && btnRef.current) setBtnRect(btnRef.current.getBoundingClientRect());
  }, [open]);

  const vramTitle = agg.vramPct == null ? "显存：无数据" : `显存占用 ${agg.vramPct}%`;
  const ramTitle = agg.ramPct == null ? "内存：无数据" : `系统内存占用 ${agg.ramPct}%`;
  const gpuTitle = agg.gpuPct == null ? "GPU 计算%：需 ComfyUI-Crystools 扩展" : `GPU 计算负荷 ${agg.gpuPct}%`;

  const addDraft = () => { const u = draft.trim(); if (u) { addServer(u); setDraft(""); } };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        data-active={open ? "true" : "false"}
        title="ComfyUI 服务器状态（点击配置）"
        className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-xs transition-all"
        style={{
          background: open ? "oklch(0.68 0.22 285 / 0.12)" : "transparent",
          border: open ? "1px solid oklch(0.68 0.22 285 / 0.3)" : "1px solid transparent",
          color: "var(--c-t3)",
        }}
        onMouseEnter={(e) => { if (!open) { e.currentTarget.style.background = "var(--c-elevated)"; e.currentTarget.style.color = "var(--c-t1)"; } }}
        onMouseLeave={(e) => { if (!open) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--c-t3)"; } }}
      >
        <span className="rounded-full" style={{ width: 6, height: 6, background: dotColor(agg.health), boxShadow: agg.health === "ok" || agg.health === "degraded" ? `0 0 5px ${dotColor(agg.health)}` : undefined }} />
        <Server className="w-3.5 h-3.5" />
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2 }}>
          <MiniBar label="G" pct={agg.gpuPct} title={gpuTitle} />
          <MiniBar label="V" pct={agg.vramPct} title={vramTitle} />
          <MiniBar label="M" pct={agg.ramPct} title={ramTitle} />
        </div>
        {agg.queue > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--c-t2)", fontVariantNumeric: "tabular-nums" }} title={`队列 ${agg.queue}`}>{agg.queue}</span>
        )}
      </button>

      {open && btnRect && createPortal(
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 99980 }} onMouseDown={(e) => { if (btnRef.current?.contains(e.target as Node)) return; setOpen(false); }} />
          <div
            className="animate-scale-in"
            style={{
              position: "fixed", zIndex: 99981,
              top: btnRect.bottom + 6,
              right: Math.max(8, window.innerWidth - btnRect.right),
              width: 340, maxHeight: "70vh", overflowY: "auto",
              background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 12,
              boxShadow: "0 12px 40px oklch(0 0 0 / 0.45)", padding: 12, color: "var(--c-t1)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <div className="flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5" style={{ color: "oklch(0.72 0.13 175)" }} />
                <span style={{ fontSize: 12, fontWeight: 700 }}>ComfyUI 服务器</span>
              </div>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 10, color: "var(--c-t3)" }}>
                  在线 {agg.online}/{agg.total} · 队列 {agg.queue}
                </span>
                <button title="刷新" className="topbar-btn" style={{ width: 22, height: 22 }} onClick={() => statusQuery.refetch()}>
                  <RefreshCw className={`w-3 h-3 ${statusQuery.isFetching ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* Per-server rows */}
            {statuses.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--c-t4)", padding: "10px 2px" }}>未配置 ComfyUI 服务器。下方添加地址即可。</div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {statuses.map((s) => {
                  const vramPct = s.vramTotalMB ? Math.round(((s.vramTotalMB - (s.vramFreeMB ?? s.vramTotalMB)) / s.vramTotalMB) * 100) : null;
                  const ramPct = s.ramTotalMB ? Math.round(((s.ramTotalMB - (s.ramFreeMB ?? s.ramTotalMB)) / s.ramTotalMB) * 100) : null;
                  const queue = (s.queueRunning ?? 0) + (s.queuePending ?? 0);
                  const inRegistry = servers.includes(s.baseUrl);
                  return (
                    <div key={s.baseUrl} style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)", borderRadius: 9, padding: "8px 9px" }}>
                      <div className="flex items-center gap-1.5" style={{ marginBottom: 6 }}>
                        <span className="rounded-full" style={{ width: 6, height: 6, flexShrink: 0, background: s.online ? "oklch(0.72 0.18 155)" : "oklch(0.63 0.23 25)" }} />
                        <span title={s.baseUrl} style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>{s.baseUrl}</span>
                        {s.version && <span style={{ fontSize: 9, color: "var(--c-t4)" }}>v{s.version}</span>}
                        {queue > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: "oklch(0.72 0.13 175)" }} title="运行+排队">⏳{queue}</span>}
                        {inRegistry && (
                          <button title="移除此服务器" onClick={() => removeServer(s.baseUrl)} className="nodrag" style={{ flexShrink: 0, padding: 1, lineHeight: 0, background: "none", border: "none", color: "var(--c-t4)", cursor: "pointer" }}>
                            <X style={{ width: 11, height: 11 }} />
                          </button>
                        )}
                      </div>
                      {s.online ? (
                        <div className="flex flex-col gap-1">
                          {s.deviceName && <div style={{ fontSize: 9, color: "var(--c-t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.deviceName}>{s.deviceName}</div>}
                          <PanelBar label="GPU" pct={s.gpuUtilization ?? null} valueText={typeof s.gpuUtilization === "number" ? `${s.gpuUtilization}%` : "需Crystools"} />
                          <PanelBar label="显存" pct={vramPct} valueText={`${gb(s.vramTotalMB && s.vramFreeMB != null ? s.vramTotalMB - s.vramFreeMB : undefined)}/${gb(s.vramTotalMB)}`} />
                          <PanelBar label="内存" pct={ramPct} valueText={`${gb(s.ramTotalMB && s.ramFreeMB != null ? s.ramTotalMB - s.ramFreeMB : undefined)}/${gb(s.ramTotalMB)}`} />
                        </div>
                      ) : (
                        <div style={{ fontSize: 10, color: "oklch(0.7 0.18 25)" }}>{s.error ?? "离线"}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add server */}
            <div className="flex items-center gap-1.5" style={{ marginTop: 10 }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addDraft(); }}
                placeholder="http://127.0.0.1:8188"
                spellCheck={false}
                style={{ flex: 1, padding: "6px 9px", borderRadius: 8, fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", fontFamily: "monospace" }}
              />
              <button
                onClick={addDraft}
                disabled={!draft.trim()}
                className="flex items-center gap-1 px-2.5 rounded-lg text-xs font-medium"
                style={{ height: 30, background: draft.trim() ? "oklch(0.72 0.13 175 / 0.15)" : "var(--c-surface)", border: `1px solid ${draft.trim() ? "oklch(0.72 0.13 175 / 0.45)" : "var(--c-bd2)"}`, color: draft.trim() ? "oklch(0.72 0.13 175)" : "var(--c-t4)", cursor: draft.trim() ? "pointer" : "not-allowed" }}
              >
                <Plus className="w-3 h-3" /> 添加
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
