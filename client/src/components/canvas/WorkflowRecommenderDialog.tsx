import { useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Sparkles, Plus, Search, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { recommendWorkflows, workflowSearchLinks, type RecModelList, type BuiltinRec } from "@/lib/workflowRecommender";

/**
 * "按我的模型推荐工作流" — reads the chosen ComfyUI server's model list and shows
 * matched built-in templates (one-click create on the canvas, pinned to that
 * server) plus a curated external-workflow catalog with browser search links.
 * Web search is client-side (opens the workflow sites in a new tab) since server
 * egress to those sites may be blocked.
 */
export function WorkflowRecommenderDialog({ baseUrl, onClose }: { baseUrl: string; onClose: () => void }) {
  const addNode = useCanvasStore((s) => s.addNode);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const placedRef = useRef(0);

  // Re-read the server's models periodically so recommendations track changes
  // (the user adding checkpoints/LoRAs on the server updates the list live).
  const modelsQuery = trpc.comfyui.fetchModels.useQuery(
    { customBaseUrl: baseUrl },
    { staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true, retry: false },
  );

  const recs = useMemo(() => {
    const m = modelsQuery.data as RecModelList | undefined;
    return m ? recommendWorkflows(m) : [];
  }, [modelsQuery.data]);

  const totalModels = useMemo(() => {
    const m = modelsQuery.data as Record<string, unknown> | undefined;
    if (!m) return 0;
    return Object.values(m).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  }, [modelsQuery.data]);

  const createBuiltin = (b: BuiltinRec) => {
    const i = placedRef.current++;
    const node = addNode(b.nodeType, { x: 160 + (i % 4) * 360, y: 160 + Math.floor(i / 4) * 320 });
    updateNodeData(node.id, { workflowTemplate: b.workflowTemplate, customBaseUrl: baseUrl } as Parameters<typeof updateNodeData>[1]);
    toast.success(`已在画布创建「${b.title}」，已绑定该服务器`);
  };

  const openSearch = (q: string) => {
    for (const l of workflowSearchLinks(q)) window.open(l.url, "_blank", "noopener");
  };

  const host = (() => { try { return new URL(baseUrl).host; } catch { return baseUrl; } })();

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 100000, display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0 0 0 / 0.6)", backdropFilter: "blur(6px)" }} onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 620, maxWidth: "94vw", maxHeight: "86vh", display: "flex", flexDirection: "column", background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 14, boxShadow: "0 16px 50px oklch(0 0 0 / 0.5)", color: "var(--c-t1)", overflow: "hidden" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: "12px 14px", borderBottom: "1px solid var(--c-bd1)" }}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: "oklch(0.72 0.18 285)" }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>按我的模型推荐工作流</span>
            <span style={{ fontSize: 11, color: "var(--c-t3)", fontFamily: "monospace" }}>{host}</span>
          </div>
          <div className="flex items-center gap-1">
            <button title="刷新模型" className="topbar-btn" style={{ width: 24, height: 24 }} onClick={() => modelsQuery.refetch()}>
              <RefreshCw className={`w-3.5 h-3.5 ${modelsQuery.isFetching ? "animate-spin" : ""}`} />
            </button>
            <button title="关闭" className="topbar-btn" style={{ width: 24, height: 24 }} onClick={onClose}><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>

        {/* Free search */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--c-bd1)" }}>
          <form
            onSubmit={(e) => { e.preventDefault(); const q = (new FormData(e.currentTarget).get("q") as string || "").trim(); if (q) openSearch(q); }}
            className="flex items-center gap-2"
          >
            <Search className="w-3.5 h-3.5" style={{ color: "var(--c-t3)", flexShrink: 0 }} />
            <input name="q" placeholder="搜索工作流（如 Flux ControlNet、换脸…）→ 在浏览器打开 ComfyWorkflows/Civitai…" spellCheck={false}
              style={{ flex: 1, padding: "6px 9px", borderRadius: 8, fontSize: 12, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }} />
            <button type="submit" className="flex items-center gap-1 px-2.5 rounded-lg text-xs font-medium" style={{ height: 30, background: "oklch(0.68 0.22 285 / 0.15)", border: "1px solid oklch(0.68 0.22 285 / 0.4)", color: "oklch(0.74 0.16 285)" }}>
              <Search className="w-3 h-3" /> 搜索
            </button>
          </form>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14 }}>
          {modelsQuery.isLoading ? (
            <div className="flex items-center gap-2" style={{ fontSize: 12, color: "var(--c-t3)" }}><Loader2 className="w-4 h-4 animate-spin" /> 正在读取服务器模型…</div>
          ) : modelsQuery.isError ? (
            <div style={{ fontSize: 12, color: "oklch(0.7 0.18 25)" }}>无法读取该服务器模型（请确认在线、地址正确）。</div>
          ) : recs.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--c-t4)" }}>没识别到可推荐的模型家族（共 {totalModels} 个模型）。可用上方搜索手动找工作流。</div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: "var(--c-t4)", marginBottom: 10 }}>从 {totalModels} 个模型识别到 {recs.length} 类，推荐如下：</div>
              <div className="flex flex-col gap-2.5">
                {recs.map((r) => (
                  <div key={r.family} style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)", borderRadius: 10, padding: "10px 12px" }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                      <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{r.label}</span>
                        {r.matched[0] && <span title={r.matched.join("\n")} style={{ fontSize: 10, color: "var(--c-t4)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}>{r.matched[0]}{r.matched.length > 1 ? ` +${r.matched.length - 1}` : ""}</span>}
                      </div>
                      <button onClick={() => openSearch(r.query)} className="flex items-center gap-1 px-1.5 rounded text-[10px] font-medium" style={{ height: 20, color: "oklch(0.74 0.16 285)", background: "oklch(0.68 0.22 285 / 0.1)", border: "1px solid oklch(0.68 0.22 285 / 0.3)", flexShrink: 0 }}>
                        <Search className="w-2.5 h-2.5" /> 搜更多
                      </button>
                    </div>
                    {/* Built-in templates → one-click create */}
                    {r.builtins.length > 0 && (
                      <div className="flex flex-wrap gap-1.5" style={{ marginBottom: r.externals.length ? 8 : 0 }}>
                        {r.builtins.map((b) => (
                          <button key={b.workflowTemplate + b.title} onClick={() => createBuiltin(b)} title={b.desc}
                            className="flex items-center gap-1 px-2 rounded-md text-[11px] font-medium"
                            style={{ height: 26, color: "oklch(0.72 0.18 155)", background: "oklch(0.72 0.18 155 / 0.12)", border: "1px solid oklch(0.72 0.18 155 / 0.4)", cursor: "pointer" }}>
                            <Plus className="w-3 h-3" /> {b.title}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Curated external workflows */}
                    {r.externals.map((ex) => (
                      <div key={ex.title} className="flex items-start justify-between gap-2" style={{ padding: "4px 0", borderTop: "1px dashed var(--c-bd1)" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11.5, color: "var(--c-t1)" }}>{ex.title}</div>
                          <div style={{ fontSize: 10, color: "var(--c-t3)" }}>{ex.desc}</div>
                          <div style={{ fontSize: 9.5, color: "var(--c-t4)" }}>需要：{ex.needs}</div>
                        </div>
                        <button onClick={() => openSearch(`${r.query} ${ex.title}`)} className="flex items-center gap-1 px-1.5 rounded text-[10px]" style={{ height: 22, flexShrink: 0, color: "var(--c-t2)", background: "var(--c-input)", border: "1px solid var(--c-bd2)" }}>
                          <ExternalLink className="w-2.5 h-2.5" /> 找
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 9.5, color: "var(--c-t4)", marginTop: 10, lineHeight: 1.5 }}>
                内置模板可一键创建并已绑定本服务器；外部工作流点「找/搜更多」在浏览器打开搜索，下载 JSON 后用「ComfyUI 工作流」节点粘贴导入。模型权重需自行下载到 ComfyUI 的 models 目录。
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
