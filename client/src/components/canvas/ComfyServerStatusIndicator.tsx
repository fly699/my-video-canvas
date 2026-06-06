import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Server, Plus, X, Cpu, RefreshCw, Pin, PinOff, Zap, Ban, ListX } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useComfyServersStore } from "../../hooks/useComfyServersStore";
import { usePersistentState } from "../../hooks/usePersistentState";
import { type ComfyServerStatus } from "../../lib/comfyAggregateStatus";

function loadColor(pct: number | null): string {
  if (pct == null) return "var(--c-bd3)";
  if (pct >= 85) return "oklch(0.63 0.23 25)";
  if (pct >= 60) return "oklch(0.75 0.16 80)";
  return "oklch(0.72 0.18 155)";
}

const gb = (mb?: number) => (typeof mb === "number" ? (mb / 1024).toFixed(1) + "G" : "—");

function usedPct(total?: number, free?: number): number | null {
  if (typeof total !== "number" || total <= 0 || typeof free !== "number") return null;
  return Math.max(0, Math.min(100, Math.round(((total - free) / total) * 100)));
}

function MiniBar({ label, pct, title }: { label: string; pct: number | null; title: string }) {
  const h = pct == null ? 0 : Math.max(6, pct);
  return (
    <div title={title} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
      <div style={{ position: "relative", width: 3.5, height: 12, borderRadius: 2, background: "var(--c-bd1)", overflow: "hidden" }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${h}%`, background: loadColor(pct), transition: "height 400ms ease, background 300ms ease" }} />
      </div>
      <span style={{ fontSize: 6.5, lineHeight: 1, color: "var(--c-t4)", fontWeight: 700 }}>{label}</span>
    </div>
  );
}

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

/** One compact per-server group shown inline in the topbar: dot + G/V/M bars. */
function ServerChip({ s }: { s: ComfyServerStatus }) {
  const vram = usedPct(s.vramTotalMB, s.vramFreeMB);
  const ram = usedPct(s.ramTotalMB, s.ramFreeMB);
  const queue = (s.queueRunning ?? 0) + (s.queuePending ?? 0);
  const host = (() => { try { return new URL(s.baseUrl).host; } catch { return s.baseUrl; } })();
  const dot = s.online ? (vram != null && vram >= 90 ? "oklch(0.75 0.16 80)" : "oklch(0.72 0.18 155)") : "oklch(0.63 0.23 25)";
  return (
    <div className="flex items-center gap-1" style={{ flexShrink: 0 }} title={`${host}${s.online ? "" : "（离线）"}`}>
      <span className="rounded-full" style={{ width: 5, height: 5, background: dot, flexShrink: 0 }} />
      <div style={{ display: "flex", alignItems: "flex-end", gap: 1.5 }}>
        <MiniBar label="G" pct={s.gpuUtilization ?? null} title={`${host} GPU 计算 ${s.gpuUtilization != null ? s.gpuUtilization + "%" : "需Crystools"}`} />
        <MiniBar label="V" pct={vram} title={`${host} 显存 ${vram ?? "—"}%`} />
        <MiniBar label="M" pct={ram} title={`${host} 内存 ${ram ?? "—"}%`} />
      </div>
      {queue > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: "var(--c-t3)" }}>{queue}</span>}
    </div>
  );
}

export function ComfyServerStatusIndicator() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // Personal (this browser) registry.
  const localServers = useComfyServersStore((s) => s.servers);
  const addLocal = useComfyServersStore((s) => s.add);
  const removeLocal = useComfyServersStore((s) => s.remove);

  // Admin-managed global registry (DB) — every user reads it; admins edit it.
  const utils = trpc.useUtils();
  const globalQ = trpc.comfyui.globalServers.useQuery(undefined, { refetchInterval: 60_000, staleTime: 30_000 });
  const globalServers = globalQ.data ?? [];
  const setGlobalMut = trpc.comfyui.setGlobalServers.useMutation({
    onSuccess: () => utils.comfyui.globalServers.invalidate(),
    onError: (e) => toast.error(`更新全局服务器失败：${e.message}`),
  });
  const setGlobal = (next: string[]) => setGlobalMut.mutate({ servers: next });

  // Union of global + personal, used both for probing and for the dedup'd panel list.
  const servers = Array.from(new Set([...globalServers, ...localServers]));
  const isGlobal = (url: string) => globalServers.includes(url);

  // Add: admins add to the shared global list; everyone else adds personally.
  const addServer = (url: string) => { if (isAdmin) setGlobal([...globalServers, url]); else addLocal(url); };
  // Remove: a global entry is removed globally (admin only); a personal one locally.
  const removeServer = (url: string) => {
    if (isGlobal(url)) { if (isAdmin) setGlobal(globalServers.filter((u) => u !== url)); }
    else removeLocal(url);
  };

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [btnRect, setBtnRect] = useState<DOMRect | null>(null);

  // Pin / drag / resize — persisted so the panel survives reloads.
  const [pinned, setPinned] = usePersistentState<boolean>("ui:comfyStatus:pinned:v1", false, { validate: (v) => (typeof v === "boolean" ? v : null) });
  const [pos, setPos] = usePersistentState<{ left: number; top: number } | null>("ui:comfyStatus:pos:v1", null, {
    validate: (v) => {
      if (v === null) return null as unknown as { left: number; top: number } | null;
      if (!v || typeof v !== "object") return null;
      const o = v as { left?: unknown; top?: unknown };
      if (typeof o.left !== "number" || typeof o.top !== "number") return null;
      if (typeof window !== "undefined" && (o.left < 0 || o.left > window.innerWidth - 80 || o.top < 0 || o.top > window.innerHeight - 60)) return null;
      return { left: o.left, top: o.top };
    },
  });
  const [size, setSize] = usePersistentState<{ w: number; h: number }>("ui:comfyStatus:size:v1", { w: 360, h: 440 }, {
    validate: (v) => {
      if (!v || typeof v !== "object") return null;
      const o = v as { w?: unknown; h?: unknown };
      if (typeof o.w !== "number" || typeof o.h !== "number" || o.w < 260 || o.h < 200) return null;
      return { w: o.w, h: o.h };
    },
  });

  const visible = open || pinned;

  const statusQuery = trpc.comfyui.serverStatus.useQuery(
    { baseUrls: servers },
    { refetchInterval: 5000, refetchOnWindowFocus: true, staleTime: 4000 },
  );
  const statuses = (statusQuery.data ?? []) as ComfyServerStatus[];
  const onlineCount = statuses.filter((s) => s.online).length;
  const totalQueue = statuses.reduce((n, s) => n + (s.queueRunning ?? 0) + (s.queuePending ?? 0), 0);

  const actionMut = trpc.comfyui.serverAction.useMutation();
  const runAction = (baseUrl: string, action: "free" | "interrupt" | "clearQueue", label: string) => {
    actionMut.mutate({ baseUrl, action }, {
      onSuccess: () => { toast.success(`${label}成功`); statusQuery.refetch(); },
      onError: (e) => toast.error(`${label}失败：${e.message}`),
    });
  };

  useEffect(() => { if (visible && btnRef.current) setBtnRect(btnRef.current.getBoundingClientRect()); }, [visible]);

  // Drag the panel by its header.
  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    if (!panelRef.current) return;
    e.preventDefault();
    const rect = panelRef.current.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, il = rect.left, it = rect.top;
    const onMove = (mv: MouseEvent) => {
      setPos({
        left: Math.max(0, Math.min(window.innerWidth - rect.width, il + mv.clientX - sx)),
        top: Math.max(0, Math.min(window.innerHeight - 40, it + mv.clientY - sy)),
      });
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  // Resize from the bottom-right handle.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, iw = size.w, ih = size.h;
    const onMove = (mv: MouseEvent) => {
      setSize({ w: Math.max(260, iw + mv.clientX - sx), h: Math.max(200, ih + mv.clientY - sy) });
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  const panelLeft = pos ? pos.left : (btnRect ? Math.max(8, Math.min(btnRect.left, window.innerWidth - size.w - 8)) : 100);
  const panelTop = pos ? pos.top : (btnRect ? btnRect.bottom + 6 : 52);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        data-active={visible ? "true" : "false"}
        title="ComfyUI 服务器状态（点击配置）"
        className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-xs transition-all"
        style={{
          background: visible ? "oklch(0.68 0.22 285 / 0.12)" : "transparent",
          border: visible ? "1px solid oklch(0.68 0.22 285 / 0.3)" : "1px solid transparent",
          color: "var(--c-t3)", flexShrink: 0, whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => { if (!visible) { e.currentTarget.style.background = "var(--c-elevated)"; e.currentTarget.style.color = "var(--c-t1)"; } }}
        onMouseLeave={(e) => { if (!visible) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--c-t3)"; } }}
      >
        <Server className="w-3.5 h-3.5 flex-shrink-0" />
        {statuses.length === 0 ? (
          <span style={{ fontSize: 10, color: "var(--c-t4)" }}>配置</span>
        ) : (
          <div className="flex items-center" style={{ gap: 6, flexWrap: "nowrap" }}>
            {statuses.map((s, i) => (
              <div key={s.baseUrl} className="flex items-center" style={{ gap: 6, flexShrink: 0 }}>
                {i > 0 && <span style={{ width: 1, height: 14, background: "var(--c-bd1)" }} />}
                <ServerChip s={s} />
              </div>
            ))}
          </div>
        )}
      </button>

      {visible && createPortal(
        <>
          {!pinned && <div style={{ position: "fixed", inset: 0, zIndex: 99980 }} onMouseDown={(e) => { if (btnRef.current?.contains(e.target as Node)) return; setOpen(false); }} />}
          <div
            ref={panelRef}
            className="animate-scale-in"
            style={{
              position: "fixed", zIndex: 99981,
              left: panelLeft, top: panelTop,
              width: size.w, height: size.h,
              display: "flex", flexDirection: "column",
              background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 12,
              boxShadow: "0 12px 40px oklch(0 0 0 / 0.45)", color: "var(--c-t1)", overflow: "hidden",
            }}
          >
            {/* Header (drag handle) */}
            <div onMouseDown={startDrag} className="flex items-center justify-between" style={{ padding: "9px 11px", borderBottom: "1px solid var(--c-bd1)", cursor: "move", flexShrink: 0 }}>
              <div className="flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5" style={{ color: "oklch(0.72 0.13 175)" }} />
                <span style={{ fontSize: 12, fontWeight: 700 }}>ComfyUI 服务器</span>
                <span style={{ fontSize: 10, color: "var(--c-t3)" }}>在线 {onlineCount}/{statuses.length} · 队列 {totalQueue}</span>
              </div>
              <div className="flex items-center gap-0.5">
                <button title="刷新全部" className="topbar-btn" style={{ width: 22, height: 22 }} onClick={() => statusQuery.refetch()}>
                  <RefreshCw className={`w-3 h-3 ${statusQuery.isFetching ? "animate-spin" : ""}`} />
                </button>
                <button title={pinned ? "取消固定" : "固定显示"} className="topbar-btn" style={{ width: 22, height: 22, color: pinned ? "oklch(0.68 0.22 285)" : undefined }} onClick={() => { setPinned((p) => !p); setOpen(true); }}>
                  {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                </button>
                <button title="关闭" className="topbar-btn" style={{ width: 22, height: 22 }} onClick={() => { setOpen(false); setPinned(false); }}>
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Body (scrolls) */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 11 }}>
              {statuses.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--c-t4)", padding: "8px 2px" }}>未配置 ComfyUI 服务器。下方添加地址即可。</div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {statuses.map((s) => {
                    const vram = usedPct(s.vramTotalMB, s.vramFreeMB);
                    const ram = usedPct(s.ramTotalMB, s.ramFreeMB);
                    const queue = (s.queueRunning ?? 0) + (s.queuePending ?? 0);
                    const global = isGlobal(s.baseUrl);
                    const canRemove = global ? isAdmin : localServers.includes(s.baseUrl);
                    const busy = actionMut.isPending && actionMut.variables?.baseUrl === s.baseUrl;
                    return (
                      <div key={s.baseUrl} style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)", borderRadius: 9, padding: "8px 9px" }}>
                        <div className="flex items-center gap-1.5" style={{ marginBottom: 6 }}>
                          <span className="rounded-full" style={{ width: 6, height: 6, flexShrink: 0, background: s.online ? "oklch(0.72 0.18 155)" : "oklch(0.63 0.23 25)" }} />
                          <span title={s.baseUrl} style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>{s.baseUrl}</span>
                          {global && <span title="管理员配置·所有用户可见" style={{ flexShrink: 0, fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 4, background: "oklch(0.68 0.22 285 / 0.15)", color: "oklch(0.72 0.16 285)", border: "1px solid oklch(0.68 0.22 285 / 0.3)" }}>全局</span>}
                          {s.version && <span style={{ fontSize: 9, color: "var(--c-t4)" }}>v{s.version}</span>}
                          {queue > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: "oklch(0.72 0.13 175)" }} title="运行+排队">⏳{queue}</span>}
                          {canRemove && (
                            <button title={global ? "从全局移除（所有用户）" : "移除此服务器"} onClick={() => removeServer(s.baseUrl)} style={{ flexShrink: 0, padding: 1, lineHeight: 0, background: "none", border: "none", color: "var(--c-t4)", cursor: "pointer" }}>
                              <X style={{ width: 11, height: 11 }} />
                            </button>
                          )}
                        </div>
                        {s.online ? (
                          <>
                            <div className="flex flex-col gap-1">
                              {s.deviceName && <div style={{ fontSize: 9, color: "var(--c-t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.deviceName}>{s.deviceName}</div>}
                              <PanelBar label="GPU" pct={s.gpuUtilization ?? null} valueText={typeof s.gpuUtilization === "number" ? `${s.gpuUtilization}%` : "需Crystools"} />
                              <PanelBar label="显存" pct={vram} valueText={`${gb(s.vramTotalMB != null && s.vramFreeMB != null ? s.vramTotalMB - s.vramFreeMB : undefined)}/${gb(s.vramTotalMB)}`} />
                              <PanelBar label="内存" pct={ram} valueText={`${gb(s.ramTotalMB != null && s.ramFreeMB != null ? s.ramTotalMB - s.ramFreeMB : undefined)}/${gb(s.ramTotalMB)}`} />
                            </div>
                            {/* Per-server actions */}
                            <div className="flex items-center gap-1" style={{ marginTop: 7 }}>
                              <ActBtn icon={<Zap className="w-3 h-3" />} label="释放显存" disabled={busy} onClick={() => runAction(s.baseUrl, "free", "释放显存")} />
                              <ActBtn icon={<Ban className="w-3 h-3" />} label="中断" disabled={busy} onClick={() => runAction(s.baseUrl, "interrupt", "中断")} />
                              <ActBtn icon={<ListX className="w-3 h-3" />} label="清空队列" disabled={busy} onClick={() => runAction(s.baseUrl, "clearQueue", "清空队列")} />
                              <ActBtn icon={<RefreshCw className="w-3 h-3" />} label="刷新" disabled={statusQuery.isFetching} onClick={() => statusQuery.refetch()} />
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span style={{ fontSize: 10, color: "oklch(0.7 0.18 25)" }}>{s.error ?? "离线"}</span>
                            <ActBtn icon={<RefreshCw className="w-3 h-3" />} label="重试" disabled={statusQuery.isFetching} onClick={() => statusQuery.refetch()} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add server */}
              <div style={{ marginTop: 10, marginBottom: 4, fontSize: 9.5, color: "var(--c-t4)" }}>
                {isAdmin ? "添加到全局列表（所有用户自动可见）" : "添加到本机列表（仅本浏览器）"}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { const u = draft.trim(); if (u) { addServer(u); setDraft(""); } } }}
                  placeholder="http://127.0.0.1:8188"
                  spellCheck={false}
                  style={{ flex: 1, padding: "6px 9px", borderRadius: 8, fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", fontFamily: "monospace" }}
                />
                <button
                  onClick={() => { const u = draft.trim(); if (u) { addServer(u); setDraft(""); } }}
                  disabled={!draft.trim()}
                  className="flex items-center gap-1 px-2.5 rounded-lg text-xs font-medium"
                  style={{ height: 30, background: draft.trim() ? "oklch(0.72 0.13 175 / 0.15)" : "var(--c-surface)", border: `1px solid ${draft.trim() ? "oklch(0.72 0.13 175 / 0.45)" : "var(--c-bd2)"}`, color: draft.trim() ? "oklch(0.72 0.13 175)" : "var(--c-t4)", cursor: draft.trim() ? "pointer" : "not-allowed" }}
                >
                  <Plus className="w-3 h-3" /> {isAdmin ? "添加(全局)" : "添加"}
                </button>
              </div>
            </div>

            {/* Resize handle */}
            <div onMouseDown={startResize} title="拖拽缩放" style={{ position: "absolute", right: 0, bottom: 0, width: 16, height: 16, cursor: "nwse-resize", zIndex: 2 }}>
              <div style={{ position: "absolute", right: 3, bottom: 3, width: 7, height: 7, borderRight: "2px solid var(--c-bd3)", borderBottom: "2px solid var(--c-bd3)" }} />
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function ActBtn({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center gap-1 px-1.5 rounded text-[9.5px] font-medium transition-all"
      style={{ height: 22, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: disabled ? "var(--c-t4)" : "var(--c-t2)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1 }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--c-elevated)"; e.currentTarget.style.color = "var(--c-t1)"; } }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--c-input)"; e.currentTarget.style.color = disabled ? "var(--c-t4)" : "var(--c-t2)"; }}
    >
      {icon}{label}
    </button>
  );
}
