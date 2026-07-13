import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Server, Plus, X, Cpu, RefreshCw, Pin, PinOff, Zap, Ban, ListX, Sparkles, ChevronsLeftRight, ChevronsRightLeft, Eraser, BrainCircuit } from "lucide-react";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { WorkflowRecommenderDialog } from "./WorkflowRecommenderDialog";
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

function PanelBar({ label, pct, used, total }: { label: string; pct: number | null; used: string; total?: string }) {
  // 已用值随负载着色（绿→琥珀→红）；总量保持暗色，一眼区分。
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 26, fontSize: 9.5, color: "var(--c-t3)", fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--c-bd1)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct ?? 0}%`, background: loadColor(pct), transition: "width 400ms ease" }} />
      </div>
      <span style={{ width: 68, textAlign: "right", fontSize: 9.5, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        <span style={{ color: loadColor(pct), fontWeight: 700 }}>{used}</span>
        {total != null && <span style={{ color: "var(--c-t4)" }}>/{total}</span>}
      </span>
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

  // Add: admins choose scope (shared global list vs this browser only); everyone
  // else can only add personally (local). Adding a personal copy of a URL already
  // in the global list is a no-op the dedup'd union absorbs.
  const addServer = (url: string, scope: "global" | "local") => {
    if (scope === "global" && isAdmin) setGlobal([...globalServers, url]);
    else addLocal(url);
  };
  // Remove: a global entry is removed globally (admin only); a personal one locally.
  const removeServer = (url: string) => {
    if (isGlobal(url)) { if (isAdmin) setGlobal(globalServers.filter((u) => u !== url)); }
    else removeLocal(url);
  };

  // 一键「清理画布所有失效服务器」：把当前探测为离线的服务器，从 全局注册表（服务端+浏览器）
  // 以及 画布内每个 ComfyUI 节点的 serverUrls/customBaseUrl 里统统删除。这才是覆盖全画布的清理
  // （模板由模板库对话框单独清）。需先「刷新」拿到在线状态。
  const cleanAllFailed = () => {
    const offline = statuses.filter((s) => !s.online).map((s) => s.baseUrl);
    if (offline.length === 0) { toast.success("没有检测到失效服务器（如未检测请先点刷新）"); return; }
    const offSet = new Set(offline);
    // 1) 全局注册表：服务端（admin）+ 浏览器本地
    if (isAdmin) setGlobal(globalServers.filter((u) => !offSet.has(u)));
    for (const u of offline) removeLocal(u);
    // 2) 画布内所有 ComfyUI 节点
    const cs = useCanvasStore.getState();
    // 含工程智能体(super_agent)：它也带 serverUrls/customBaseUrl（ComfyUI 工作流模式），
    // 全画布失效服务器清理须覆盖它。
    const COMFY = new Set(["comfyui_image", "comfyui_video", "comfyui_workflow", "super_agent"]);
    let nodeCount = 0;
    for (const n of cs.nodes) {
      if (!COMFY.has(n.data.nodeType)) continue;
      const p = n.data.payload as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (Array.isArray(p.serverUrls)) {
        const f = (p.serverUrls as unknown[]).filter((u): u is string => typeof u === "string" && !offSet.has(u));
        if (f.length !== (p.serverUrls as unknown[]).length) patch.serverUrls = f;
      }
      if (typeof p.customBaseUrl === "string" && offSet.has((p.customBaseUrl as string).trim())) patch.customBaseUrl = "";
      if (Object.keys(patch).length) { cs.updateNodeData(n.id, patch); nodeCount++; }
    }
    // 文案须如实反映作用域：非 admin 无权清服务端全局注册表(line 120 门控)，仅清了浏览器
    // 本地列表 + 画布节点。此前无条件写「全局」会误导非 admin「已清全局」，刷新后失效服务器
    // 又出现 → 困惑「为什么清不掉」。
    toast.success(
      isAdmin
        ? `已清理 ${offline.length} 台失效服务器（全局注册表 + ${nodeCount} 个画布节点）`
        : `已清理 ${offline.length} 台失效服务器（本地列表 + ${nodeCount} 个画布节点）；全局注册表需管理员清理`
    );
  };

  // Persist the open state too, so the floating panel reliably survives a reload
  // (pin / position / size are already persisted below).
  const [open, setOpen] = usePersistentState<boolean>("ui:comfyStatus:open:v1", false, { validate: (v) => (typeof v === "boolean" ? v : null), crossTab: false });
  // Compact inline indicator: collapse each server chip to just the online dot +
  // GPU bar, hiding 显存/内存 to keep the toolbar narrow. Persisted across reloads.
  // 弹出面板的精简模式：隐藏每个服务器卡的「选卡」栏与底部操作按钮区，
  // 只留地址/设备/三条指标，监控密度更高。持久化。
  const [panelCompact, setPanelCompact] = usePersistentState<boolean>("ui:comfyStatus:panelCompact:v1", false, { validate: (v) => (typeof v === "boolean" ? v : null), crossTab: false });
  const [draft, setDraft] = useState("");
  // Admins pick where a new address goes; non-admins are always local.
  const [addScope, setAddScope] = useState<"global" | "local">("global");
  // Which server's "recommend workflows" dialog is open.
  const [recommendFor, setRecommendFor] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [btnRect, setBtnRect] = useState<DOMRect | null>(null);

  // Pin / drag / resize — persisted so the panel survives reloads.
  const [pinned, setPinned] = usePersistentState<boolean>("ui:comfyStatus:pinned:v1", false, { validate: (v) => (typeof v === "boolean" ? v : null), crossTab: false });
  const [pos, setPos] = usePersistentState<{ left: number; top: number } | null>("ui:comfyStatus:pos:v1", null, {
    validate: (v) => {
      if (v === null) return null as unknown as { left: number; top: number } | null;
      if (!v || typeof v !== "object") return null;
      const o = v as { left?: unknown; top?: unknown };
      if (typeof o.left !== "number" || typeof o.top !== "number") return null;
      if (typeof window !== "undefined" && (o.left < 0 || o.left > window.innerWidth - 80 || o.top < 0 || o.top > window.innerHeight - 60)) return null;
      return { left: o.left, top: o.top };
    },
    crossTab: false,
  });
  const [size, setSize] = usePersistentState<{ w: number; h: number }>("ui:comfyStatus:size:v1", { w: 360, h: 440 }, {
    validate: (v) => {
      if (!v || typeof v !== "object") return null;
      const o = v as { w?: unknown; h?: unknown };
      if (typeof o.w !== "number" || typeof o.h !== "number" || o.w < 260 || o.h < 200) return null;
      return { w: o.w, h: o.h };
    },
    crossTab: false,
  });

  const visible = open || pinned;

  // Which physical GPU each server uses (its --cuda-device). Crystools reports
  // EVERY host GPU with no per-GPU id and ComfyUI reports a masked index 0 under
  // CUDA_VISIBLE_DEVICES, so on a shared multi-GPU box we can't read it from data.
  // Two layers: admins pin it GLOBALLY (DB, synced to all users); any user can also
  // override LOCALLY (this browser). This map holds the local overrides.
  const [gpuIndexByUrl, setGpuIndexByUrl] = usePersistentState<Record<string, number>>(
    "ui:comfyStatus:gpuIndex:v1", {},
    { validate: (v) => (v && typeof v === "object" ? (v as Record<string, number>) : null) },
  );
  // Admin-managed global GPU pins (DB), read by everyone.
  const globalGpuQ = trpc.comfyui.globalGpuIndex.useQuery(undefined, { refetchInterval: 60_000, staleTime: 30_000 });
  const globalGpuIndex = globalGpuQ.data ?? {};
  const setGlobalGpuMut = trpc.comfyui.setGlobalGpuIndex.useMutation({
    onSuccess: () => utils.comfyui.globalGpuIndex.invalidate(),
    onError: (e) => toast.error(`同步显卡选择失败：${e.message}`),
  });
  // Picking a GPU: admins write the GLOBAL pin (and clear any stale local override
  // so the global one takes effect); non-admins set a local override.
  const pickGpu = (url: string, idx: number) => {
    if (isAdmin) {
      setGlobalGpuMut.mutate({ gpuIndex: { ...globalGpuIndex, [url]: idx } });
      setGpuIndexByUrl((m) => { if (m[url] == null) return m; const n = { ...m }; delete n[url]; return n; });
    } else {
      setGpuIndexByUrl((m) => ({ ...m, [url]: idx }));
    }
  };

  // Smart auto-default: when several servers share ONE host (same machine, each
  // pinned to a different GPU), assign them distinct indices 0,1,2… in order —
  // the common `--cuda-device 0/1/2/3` per port layout. Removes the manual step in
  // the typical setup; a manual override always wins. Single-host servers → 0.
  const autoIndexByUrl: Record<string, number> = (() => {
    const seenPerHost = new Map<string, number>();
    const out: Record<string, number> = {};
    for (const url of servers) {
      let host: string;
      try { host = new URL(url).host; } catch { host = url; }
      const n = seenPerHost.get(host) ?? 0;
      out[url] = n;
      seenPerHost.set(host, n + 1);
    }
    return out;
  })();
  // Effective precedence: local override > admin global pin > auto-by-host-order.
  const effectiveIndexByUrl: Record<string, number> = { ...autoIndexByUrl, ...globalGpuIndex, ...gpuIndexByUrl };

  // Faster polling (0.5s) while the monitor panel is open/pinned — live GPU/VRAM/
  // queue should feel real-time (Crystools data is served from the in-memory WS
  // cache, so the extra rate is cheap); back off to 3s when only the compact
  // header bars are shown.
  const statusQuery = trpc.comfyui.serverStatus.useQuery(
    { baseUrls: servers, gpuIndexByUrl: effectiveIndexByUrl },
    { refetchInterval: visible ? 500 : 3000, refetchOnWindowFocus: true, staleTime: 400 },
  );
  // Render the CONFIGURED server union (global ∪ local) directly, overlaying live
  // status when available. The status probe (serverStatus) is whitelist-gated and
  // can be FORBIDDEN / loading / fail per user, so we must NOT key the UI off its
  // result — otherwise an admin-synced global address would look "empty" to a
  // non-whitelisted user even though it synced fine. Addresses always show; status
  // (online/offline/load) is layered on top.
  const probed = (statusQuery.data ?? []) as ComfyServerStatus[];
  const statusByUrl = new Map(probed.map((s) => [s.baseUrl, s]));
  const statuses: ComfyServerStatus[] = servers.map((url) => statusByUrl.get(url) ?? { baseUrl: url, online: false });
  const probeError = statusQuery.error?.message;
  const onlineCount = statuses.filter((s) => s.online).length;
  const totalQueue = statuses.reduce((n, s) => n + (s.queueRunning ?? 0) + (s.queuePending ?? 0), 0);

  const actionMut = trpc.comfyui.serverAction.useMutation();
  const runAction = (baseUrl: string, action: "free" | "interrupt" | "clearQueue", label: string) => {
    actionMut.mutate({ baseUrl, action }, {
      onSuccess: () => { toast.success(`${label}成功`); statusQuery.refetch(); },
      onError: (e) => toast.error(`${label}失败：${e.message}`),
    });
  };

  // 复位「知识记忆体」：清掉该服务器已学习的资源/节点记忆并立即重学（refreshKnowledge=invalidate+重抓）。
  // 复位后，工程智能体 / ComfyUI 节点 / 画布助手下次调用记忆时拿到的即是最新清单（装/删模型后手动复位用）。
  const refreshKnowledgeMut = trpc.comfyui.refreshKnowledge.useMutation();
  const resetMemory = (baseUrl: string) => {
    refreshKnowledgeMut.mutate({ customBaseUrl: baseUrl }, {
      onSuccess: (r) => {
        if (!r.configured) { toast.error("未配置 ComfyUI 地址"); return; }
        toast.success(`已复位并重建记忆：${r.counts.checkpoints} checkpoint · ${r.counts.loras} LoRA · ${r.counts.nodeClasses} 节点类`);
      },
      onError: (e) => toast.error(`复位记忆失败：${e.message}`),
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

  // Resize from any of the four corners. East/south corners grow rightward/downward;
  // west/north corners keep the OPPOSITE edge anchored (the window moves as it grows),
  // so we also update `pos` — captured from the live rect because `pos` may still be
  // null (auto-anchored under the toolbar button) when the user first grabs a corner.
  const startResize = (corner: "nw" | "ne" | "sw" | "se") => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, iw = size.w, ih = size.h, il = rect.left, it = rect.top;
    const onMove = (mv: MouseEvent) => {
      const dx = mv.clientX - sx, dy = mv.clientY - sy;
      const w = corner.includes("e") ? iw + dx : corner.includes("w") ? iw - dx : iw;
      const h = corner.includes("s") ? ih + dy : corner.includes("n") ? ih - dy : ih;
      const cw = Math.max(260, Math.min(window.innerWidth - 16, w));
      const ch = Math.max(200, Math.min(window.innerHeight - 16, h));
      setSize({ w: cw, h: ch });
      if (corner.includes("w") || corner.includes("n")) {
        setPos({
          left: Math.max(0, corner.includes("w") ? il + iw - cw : il),
          top: Math.max(0, corner.includes("n") ? it + ih - ch : it),
        });
      }
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  const panelLeft = pos ? pos.left : (btnRect ? Math.max(8, Math.min(btnRect.left, window.innerWidth - size.w - 8)) : 100);
  const panelTop = pos ? pos.top : (btnRect ? btnRect.bottom + 6 : 52);

  return (
    <>
      <div className="flex items-center" style={{ gap: 2, flexShrink: 0 }}>
      {/* 顶栏只留一枚汇总徽章（在线数 + 队列），点开在浮层面板里看每台服务器的完整 GVM 柱子/操作，
          省掉一整排小柱子占的横向空间。 */}
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        data-active={visible ? "true" : "false"}
        title="ComfyUI 服务器状态（点击展开详情/配置）"
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
          <span className="flex items-center" style={{ gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: onlineCount > 0 ? "oklch(0.72 0.18 155)" : "var(--c-t4)" }} />
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{onlineCount}/{statuses.length}</span>
            {totalQueue > 0 && <span style={{ color: "oklch(0.75 0.16 80)", fontVariantNumeric: "tabular-nums" }}>· {totalQueue} 队列</span>}
          </span>
        )}
      </button>
      </div>

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
                <button title="清理画布所有失效服务器（从全局列表 + 每个 ComfyUI 节点删除离线地址）"
                  className="topbar-btn" style={{ width: 22, height: 22, color: "oklch(0.66 0.18 30)" }} onClick={cleanAllFailed}>
                  <Eraser className="w-3 h-3" />
                </button>
                <button
                  title={panelCompact ? "展开：显示选卡栏与操作按钮" : "折叠：隐藏选卡栏与操作按钮（仅留指标）"}
                  className="topbar-btn"
                  style={{ width: 22, height: 22, color: panelCompact ? "oklch(0.68 0.22 285)" : undefined }}
                  onClick={() => setPanelCompact((v) => !v)}
                >
                  {panelCompact ? <ChevronsLeftRight className="w-3 h-3" style={{ transform: "rotate(90deg)" }} /> : <ChevronsRightLeft className="w-3 h-3" style={{ transform: "rotate(90deg)" }} />}
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
              {probeError && servers.length > 0 && (
                <div style={{ marginBottom: 9, padding: "6px 8px", borderRadius: 7, fontSize: 10, lineHeight: 1.4, background: "oklch(0.7 0.18 25 / 0.1)", border: "1px solid oklch(0.7 0.18 25 / 0.3)", color: "oklch(0.72 0.16 25)" }}>
                  无法读取服务器状态：{probeError}（地址已同步，状态需相应权限）
                </div>
              )}
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
                              <PanelBar label="GPU" pct={s.gpuUtilization ?? null} used={typeof s.gpuUtilization === "number" ? `${s.gpuUtilization}%` : "需Crystools"} />
                              {/* 精简模式：选卡栏隐藏（监控密度优先） */}
                              {!panelCompact && s.gpus && s.gpus.length > 1 && (
                                <GpuPicker gpus={s.gpus} selected={s.gpuIndex ?? 0} isAdmin={isAdmin} onSelect={(i) => pickGpu(s.baseUrl, i)} />
                              )}
                              <PanelBar label="显存" pct={vram} used={gb(s.vramTotalMB != null && s.vramFreeMB != null ? s.vramTotalMB - s.vramFreeMB : undefined)} total={gb(s.vramTotalMB)} />
                              <PanelBar label="内存" pct={ram} used={gb(s.ramTotalMB != null && s.ramFreeMB != null ? s.ramTotalMB - s.ramFreeMB : undefined)} total={gb(s.ramTotalMB)} />
                            </div>
                            {/* Per-server actions（精简模式隐藏） */}
                            {!panelCompact && (
                              <div className="flex items-center gap-1" style={{ marginTop: 7 }}>
                                <ActBtn icon={<Zap className="w-3 h-3" />} label="释放显存" color="oklch(0.72 0.18 155)" disabled={busy} onClick={() => runAction(s.baseUrl, "free", "释放显存")} />
                                <ActBtn icon={<Ban className="w-3 h-3" />} label="中断" color="oklch(0.65 0.21 25)" disabled={busy} onClick={() => runAction(s.baseUrl, "interrupt", "中断")} />
                                <ActBtn icon={<ListX className="w-3 h-3" />} label="清空队列" color="oklch(0.74 0.16 80)" disabled={busy} onClick={() => runAction(s.baseUrl, "clearQueue", "清空队列")} />
                                <ActBtn icon={<Sparkles className="w-3 h-3" />} label="推荐工作流" color="oklch(0.72 0.18 285)" onClick={() => setRecommendFor(s.baseUrl)} />
                                <ActBtn icon={<BrainCircuit className="w-3 h-3" />} label="复位记忆" color="oklch(0.7 0.16 40)" disabled={refreshKnowledgeMut.isPending} onClick={() => resetMemory(s.baseUrl)} />
                                <ActBtn icon={<RefreshCw className="w-3 h-3" />} label="刷新" color="oklch(0.64 0.16 250)" disabled={statusQuery.isFetching} onClick={() => statusQuery.refetch()} />
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span style={{ fontSize: 10, color: "oklch(0.7 0.18 25)" }}>{s.error ?? "离线"}</span>
                            {!panelCompact && (
                              <ActBtn icon={<RefreshCw className="w-3 h-3" />} label="重试" color="oklch(0.64 0.16 250)" disabled={statusQuery.isFetching} onClick={() => statusQuery.refetch()} />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add server. Admins choose global (DB, all users) vs local (this
                  browser only); non-admins can only add locally. */}
              {(() => {
                const scope: "global" | "local" = isAdmin ? addScope : "local";
                const submit = () => { const u = draft.trim(); if (u) { addServer(u, scope); setDraft(""); } };
                return (
                  <>
                    {isAdmin && (
                      <div className="flex items-center gap-1" style={{ marginTop: 10 }}>
                        {(["global", "local"] as const).map((sc) => {
                          const on = addScope === sc;
                          return (
                            <button
                              key={sc}
                              onClick={() => setAddScope(sc)}
                              className="flex items-center gap-1 rounded transition-all"
                              style={{
                                height: 22, padding: "0 8px", fontSize: 10, fontWeight: 700,
                                background: on ? "oklch(0.68 0.22 285 / 0.16)" : "var(--c-input)",
                                border: `1px solid ${on ? "oklch(0.68 0.22 285 / 0.5)" : "var(--c-bd2)"}`,
                                color: on ? "oklch(0.74 0.16 285)" : "var(--c-t3)", cursor: "pointer",
                              }}
                            >
                              {sc === "global" ? "全局" : "本机"}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div style={{ marginTop: isAdmin ? 5 : 10, marginBottom: 4, fontSize: 9.5, color: "var(--c-t4)" }}>
                      {scope === "global" ? "添加到全局列表（所有用户自动可见）" : "添加到本机列表（仅本浏览器）"}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                        placeholder="http://127.0.0.1:8188"
                        spellCheck={false}
                        style={{ flex: 1, padding: "6px 9px", borderRadius: 8, fontSize: 11, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none", fontFamily: "monospace" }}
                      />
                      <button
                        onClick={submit}
                        disabled={!draft.trim()}
                        className="flex items-center gap-1 px-2.5 rounded-lg text-xs font-medium"
                        style={{ height: 30, background: draft.trim() ? "oklch(0.72 0.13 175 / 0.15)" : "var(--c-surface)", border: `1px solid ${draft.trim() ? "oklch(0.72 0.13 175 / 0.45)" : "var(--c-bd2)"}`, color: draft.trim() ? "oklch(0.72 0.13 175)" : "var(--c-t4)", cursor: draft.trim() ? "pointer" : "not-allowed" }}
                      >
                        <Plus className="w-3 h-3" /> {isAdmin ? (scope === "global" ? "添加(全局)" : "添加(本机)") : "添加"}
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Resize handles — 四角均可拖拽缩放（右下角带视觉抓手，其余三角隐形热区） */}
            <div onMouseDown={startResize("se")} title="拖拽缩放" style={{ position: "absolute", right: 0, bottom: 0, width: 16, height: 16, cursor: "nwse-resize", zIndex: 3 }}>
              <div style={{ position: "absolute", right: 3, bottom: 3, width: 7, height: 7, borderRight: "2px solid var(--c-bd3)", borderBottom: "2px solid var(--c-bd3)" }} />
            </div>
            <div onMouseDown={startResize("sw")} title="拖拽缩放" style={{ position: "absolute", left: 0, bottom: 0, width: 16, height: 16, cursor: "nesw-resize", zIndex: 3 }} />
            <div onMouseDown={startResize("ne")} title="拖拽缩放" style={{ position: "absolute", right: 0, top: 0, width: 16, height: 16, cursor: "nesw-resize", zIndex: 3 }} />
            <div onMouseDown={startResize("nw")} title="拖拽缩放" style={{ position: "absolute", left: 0, top: 0, width: 16, height: 16, cursor: "nwse-resize", zIndex: 3 }} />
          </div>
        </>,
        document.body,
      )}

      {recommendFor && <WorkflowRecommenderDialog baseUrl={recommendFor} onClose={() => setRecommendFor(null)} />}
    </>
  );
}

/** Multi-GPU host → let the user pin which physical GPU this server uses. Each
 *  chip shows the GPU's live compute %, so the user can wiggle a job and SEE which
 *  index lights up, then click it. This is the only deterministic mapping: see the
 *  note in comfyMonitor.ts (Crystools reports all GPUs unindexed; ComfyUI masks the
 *  index under CUDA_VISIBLE_DEVICES). */
function GpuPicker({ gpus, selected, onSelect, isAdmin }: { gpus: Array<{ index: number; gpuUtilization?: number }>; selected: number; onSelect: (i: number) => void; isAdmin?: boolean }) {
  return (
    <div className="flex items-center gap-1" style={{ marginTop: 2, flexWrap: "wrap" }}>
      <span style={{ fontSize: 8.5, color: "var(--c-t4)", marginRight: 1 }} title={`此服务器实际使用的显卡（对应启动参数 --cuda-device）。Crystools 会上报主机上所有显卡，需指定本服务器用的那一张。${isAdmin ? "管理员选择会同步给所有用户。" : "你的选择仅本浏览器生效。"}`}>选卡{isAdmin ? "(全局)" : ""}</span>
      {gpus.map((g) => {
        const on = g.index === selected;
        const u = typeof g.gpuUtilization === "number" ? g.gpuUtilization : null;
        return (
          <button
            key={g.index}
            onClick={() => onSelect(g.index)}
            title={`GPU ${g.index}${u != null ? ` · ${u}%` : ""}`}
            className="flex items-center gap-0.5 rounded transition-all"
            style={{
              height: 16, padding: "0 4px", fontSize: 8.5, fontWeight: 700, lineHeight: 1,
              background: on ? "oklch(0.68 0.22 285 / 0.18)" : "var(--c-input)",
              border: `1px solid ${on ? "oklch(0.68 0.22 285 / 0.5)" : "var(--c-bd2)"}`,
              color: on ? "oklch(0.74 0.16 285)" : "var(--c-t3)", cursor: "pointer",
            }}
          >
            {g.index}
            {u != null && <span style={{ color: loadColor(u), fontWeight: 800 }}>{u}%</span>}
          </button>
        );
      })}
    </div>
  );
}

function ActBtn({ icon, label, onClick, disabled, color }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; color?: string }) {
  // Each action carries a semantic color (free=green, interrupt=red,
  // clearQueue=amber, refresh=blue). Resting = tinted border+text; hover fills
  // the tint. Disabled = neutral grey.
  const c = color ?? "var(--c-t2)";
  const tint = (a: number) => (color ? color.replace(/\)$/, ` / ${a})`) : `var(--c-input)`);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center gap-1 px-1.5 rounded text-[9.5px] font-medium transition-all"
      style={{
        height: 22,
        background: disabled ? "var(--c-input)" : tint(0.08),
        border: `1px solid ${disabled ? "var(--c-bd2)" : tint(0.4)}`,
        color: disabled ? "var(--c-t4)" : c,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = tint(0.2); } }}
      onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.background = tint(0.08); } }}
    >
      {icon}{label}
    </button>
  );
}
