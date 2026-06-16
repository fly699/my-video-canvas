import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Server, CheckSquare, Square, Loader2, WifiOff, PackageX, Plus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const accent = "oklch(0.66 0.18 30)";

/**
 * 「扫描并清理模板服务器列表」对话框。打开即调 scanServerLists 只读扫描，按模板列出
 * 其 serverUrls 里已失效（离线 / 缺所需模型）的服务器（默认勾选），由用户确认删除；
 * 同时只读展示「将自动补入」的新可用服务器。应用时 applyServerChanges 一次性提交。
 */
export function ServerCleanupDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const scanMut = trpc.comfyTemplates.scanServerLists.useMutation();
  const applyMut = trpc.comfyTemplates.applyServerChanges.useMutation({
    onSuccess: (r) => {
      toast.success(`已清理 ${r.removed} 台失效、补入 ${r.added} 台（共更新 ${r.updated} 个模板）`);
      utils.comfyTemplates.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error("应用失败：" + e.message),
  });

  // 打开即扫描一次（仅一次）。
  const scanRef = useRef(scanMut.mutate);
  scanRef.current = scanMut.mutate;
  useEffect(() => { scanRef.current(); }, []);

  const data = scanMut.data;
  const templates = useMemo(() => data?.templates ?? [], [data]);

  // 默认勾选：每个模板的全部失效服务器（key = `${id}|${url}`）。
  const allFailedKeys = useMemo(
    () => templates.flatMap((t) => t.failed.map((f) => `${t.id}|${f.url}`)),
    [templates],
  );
  const [checked, setChecked] = useState<Set<string> | null>(null);
  // 首次拿到扫描结果时初始化为「全选失效项」。
  if (checked === null && data) setChecked(new Set(allFailedKeys));
  const sel = checked ?? new Set<string>();

  const allChecked = allFailedKeys.length > 0 && sel.size === allFailedKeys.length;
  const toggle = (key: string) => setChecked((s) => { const n = new Set(s ?? []); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(allFailedKeys));

  const apply = () => {
    const items = templates.map((t) => ({
      templateId: t.id,
      remove: t.failed.filter((f) => sel.has(`${t.id}|${f.url}`)).map((f) => f.url),
      add: t.additions,
    })).filter((i) => i.remove.length || i.add.length);
    if (items.length === 0) { onClose(); return; }
    applyMut.mutate({ items });
  };

  const totalAdditions = templates.reduce((n, t) => n + t.additions.length, 0);

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 100060, background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center", padding: 20 }}
    >
      <div
        className="nodrag nowheel"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 520, maxWidth: "100%", maxHeight: "82vh", display: "flex", flexDirection: "column", background: "var(--c-base)", border: "1px solid var(--c-bd1)", borderRadius: 14, boxShadow: "0 24px 70px oklch(0 0 0 / 0.5)", overflow: "hidden" }}
      >
        {/* 头部 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 18px", borderBottom: "1px solid var(--c-bd2)" }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: `${accent}22`, color: accent, flexShrink: 0 }}><Server style={{ width: 16, height: 16 }} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--c-t1)" }}>清理模板服务器列表</div>
            <div style={{ fontSize: 11.5, color: "var(--c-t3)" }}>
              {scanMut.isPending ? "正在扫描所有服务器…" : data ? `在线 ${data.onlineServers.length} · 离线 ${data.offlineServers.length}` : "勾选失效服务器以删除，可用服务器将自动补入"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--c-t3)", cursor: "pointer", padding: 2 }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        {scanMut.isPending || (!data && !scanMut.isError) ? (
          <div style={{ padding: "44px 20px", textAlign: "center", color: "var(--c-t3)" }}>
            <Loader2 style={{ width: 26, height: 26, margin: "0 auto 12px", animation: "spin 1s linear infinite" }} className="animate-spin" />
            <div style={{ fontSize: 12.5 }}>正在检测各服务器在线状态与已装模型…</div>
          </div>
        ) : scanMut.isError ? (
          <div style={{ padding: "34px 20px", textAlign: "center", fontSize: 12.5, color: "var(--c-danger, #e5484d)" }}>
            扫描失败：{scanMut.error?.message}
          </div>
        ) : templates.length === 0 ? (
          <div style={{ padding: "34px 20px", textAlign: "center", fontSize: 12.5, color: "var(--c-t3)" }}>
            没有失效服务器，也没有可补入的服务器，所有模板的服务器列表都是最新的。
          </div>
        ) : (
          <>
            {/* 全选条 */}
            {allFailedKeys.length > 0 && (
              <button onClick={toggleAll} className="nodrag" style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 18px", background: "var(--c-elevated)", border: "none", borderBottom: "1px solid var(--c-bd2)", cursor: "pointer", color: "var(--c-t2)", fontSize: 12.5, fontWeight: 700, width: "100%", textAlign: "left" }}>
                {allChecked ? <CheckSquare style={{ width: 16, height: 16, color: accent }} /> : <Square style={{ width: 16, height: 16 }} />}
                全选失效服务器（共 {allFailedKeys.length} 项 · 已选 {sel.size}）
              </button>
            )}
            {/* 列表 */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
              {templates.map((t) => (
                <div key={t.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px 6px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</div>
                    {t.failed.length > 0 && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: "#e5484d", background: "#e5484d1c", border: "1px solid #e5484d40", padding: "1px 7px", borderRadius: 20 }}>失效 {t.failed.length} / 共 {t.serverCount}</span>}
                  </div>
                  {t.failed.map((f) => {
                    const key = `${t.id}|${f.url}`;
                    const on = sel.has(key);
                    return (
                      <button
                        key={key}
                        onClick={() => toggle(key)}
                        className="nodrag"
                        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "8px 11px", borderRadius: 9, border: "1px solid transparent", background: on ? `${accent}14` : "transparent", cursor: "pointer", marginBottom: 2 }}
                        onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--c-elevated)"; }}
                        onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
                      >
                        {on ? <CheckSquare style={{ width: 16, height: 16, color: accent, flexShrink: 0 }} /> : <Square style={{ width: 16, height: 16, color: "var(--c-t4)", flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--c-t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.url}</div>
                        <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, color: "#e5848d", background: "#e5484d14", padding: "2px 7px", borderRadius: 20 }}>
                          {f.reason === "offline" ? <><WifiOff style={{ width: 10, height: 10 }} />离线</> : <><PackageX style={{ width: 10, height: 10 }} />缺模型</>}
                        </span>
                      </button>
                    );
                  })}
                  {t.additions.length > 0 && (
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "5px 11px", fontSize: 11, color: "var(--c-t3)" }}>
                      <Plus style={{ width: 12, height: 12, color: accent, flexShrink: 0, marginTop: 1 }} />
                      <span style={{ minWidth: 0 }}>将自动补入 {t.additions.length} 台：{t.additions.join("、")}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* 底部 */}
            <div style={{ display: "flex", gap: 10, padding: "13px 18px", borderTop: "1px solid var(--c-bd2)", alignItems: "center" }}>
              <div style={{ flex: 1, fontSize: 11, color: "var(--c-t3)" }}>
                将删除 {sel.size} 台失效{totalAdditions ? ` · 补入 ${totalAdditions} 台` : ""}
              </div>
              <button onClick={onClose} style={{ flex: "0 0 auto", padding: "8px 16px", borderRadius: 8, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t2)", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>取消</button>
              <button onClick={apply} disabled={applyMut.isPending || (sel.size === 0 && totalAdditions === 0)} style={{ flex: "0 0 auto", padding: "8px 16px", borderRadius: 8, border: "none", background: (sel.size || totalAdditions) ? accent : "var(--c-bd2)", color: (sel.size || totalAdditions) ? "#fff" : "var(--c-t4)", cursor: applyMut.isPending ? "wait" : (sel.size || totalAdditions) ? "pointer" : "not-allowed", fontSize: 12.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                {applyMut.isPending ? <Loader2 style={{ width: 15, height: 15 }} className="animate-spin" /> : <Check style={{ width: 15, height: 15 }} />}应用
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
