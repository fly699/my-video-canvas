import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Sparkles, Plus, Search, ExternalLink, Loader2, RefreshCw, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { recommendWorkflows, workflowSearchLinks, OFFICIAL_EXAMPLES_URL, type RecModelList, type BuiltinRec } from "@/lib/workflowRecommender";

const chip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 3, height: 19, padding: "0 6px", borderRadius: 5,
  fontSize: 10, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap",
  color: "var(--c-t2)", background: "var(--c-input)", border: "1px solid var(--c-bd2)",
};

/** A row of clickable source links that open the query on each site in the user's
 *  browser (one tab per click — no popup-blocker issues, no auto-spamming tabs). */
function SourceChips({ query }: { query: string }) {
  return (
    <div className="flex flex-wrap gap-1" style={{ marginTop: 5 }}>
      <span style={{ fontSize: 9.5, color: "var(--c-t4)", alignSelf: "center" }}>搜索：</span>
      {workflowSearchLinks(query).map((l) => (
        <a key={l.label} href={l.url} target="_blank" rel="noreferrer" style={chip} title={`在 ${l.label} 搜索「${query}」`}>{l.label}</a>
      ))}
      <a href={OFFICIAL_EXAMPLES_URL} target="_blank" rel="noreferrer"
        style={{ ...chip, color: "oklch(0.72 0.18 155)", borderColor: "oklch(0.72 0.18 155 / 0.4)", background: "oklch(0.72 0.18 155 / 0.1)" }}
        title="ComfyUI 官方示例工作流（按模型分类，可直接下载，最可靠）">
        <BookOpen style={{ width: 10, height: 10 }} /> 官方示例
      </a>
    </div>
  );
}

/**
 * "按我的模型推荐工作流" — reads the chosen ComfyUI server's model list and shows
 * matched built-in templates (one-click create on the canvas, pinned to that
 * server) plus a curated external-workflow catalog. Search is client-side: each
 * source is a link the user clicks (their browser reaches the sites even when our
 * server's egress is blocked).
 */
export function WorkflowRecommenderDialog({ baseUrl, onClose }: { baseUrl: string; onClose: () => void }) {
  const addNode = useCanvasStore((s) => s.addNode);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const placedRef = useRef(0);
  const [q, setQ] = useState("");

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

  const host = (() => { try { return new URL(baseUrl).host; } catch { return baseUrl; } })();

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 100000, display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0 0 0 / 0.6)", backdropFilter: "blur(6px)" }} onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 640, maxWidth: "94vw", maxHeight: "86vh", display: "flex", flexDirection: "column", background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 14, boxShadow: "0 16px 50px oklch(0 0 0 / 0.5)", color: "var(--c-t1)", overflow: "hidden" }}
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
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5" style={{ color: "var(--c-t3)", flexShrink: 0 }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入关键词（如 Flux ControlNet、换脸、IPAdapter…），下方点来源站搜索" spellCheck={false}
              style={{ flex: 1, padding: "6px 9px", borderRadius: 8, fontSize: 12, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", outline: "none" }} />
          </div>
          <SourceChips query={(q.trim() || "ComfyUI workflow")} />
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14 }}>
          {modelsQuery.isLoading ? (
            <div className="flex items-center gap-2" style={{ fontSize: 12, color: "var(--c-t3)" }}><Loader2 className="w-4 h-4 animate-spin" /> 正在读取服务器模型…</div>
          ) : modelsQuery.isError ? (
            <div style={{ fontSize: 12, color: "oklch(0.7 0.18 25)" }}>无法读取该服务器模型（请确认在线、地址正确）。仍可用上方搜索手动找工作流。</div>
          ) : recs.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--c-t4)" }}>没识别到可推荐的模型家族（共 {totalModels} 个模型）。可用上方搜索手动找工作流。</div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: "var(--c-t4)", marginBottom: 10 }}>从 {totalModels} 个模型识别到 {recs.length} 类，推荐如下：</div>
              <div className="flex flex-col gap-2.5">
                {recs.map((r) => (
                  <div key={r.family} style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)", borderRadius: 10, padding: "10px 12px" }}>
                    <div className="flex items-center gap-2" style={{ marginBottom: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{r.label}</span>
                      {r.matched[0] && <span title={r.matched.join("\n")} style={{ fontSize: 10, color: "var(--c-t4)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>{r.matched[0]}{r.matched.length > 1 ? ` +${r.matched.length - 1}` : ""}</span>}
                    </div>
                    {/* Built-in templates → one-click create */}
                    {r.builtins.length > 0 && (
                      <div className="flex flex-wrap gap-1.5" style={{ marginBottom: 8 }}>
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
                        <a href={workflowSearchLinks(`${r.query} ${ex.title}`)[0].url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 px-1.5 rounded text-[10px]" style={{ height: 22, flexShrink: 0, color: "var(--c-t2)", background: "var(--c-input)", border: "1px solid var(--c-bd2)", textDecoration: "none" }}>
                          <ExternalLink className="w-2.5 h-2.5" /> 找
                        </a>
                      </div>
                    ))}
                    {/* All search sources for this family */}
                    <SourceChips query={r.query} />
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 9.5, color: "var(--c-t4)", marginTop: 10, lineHeight: 1.5 }}>
                内置模板可一键创建并绑定本服务器；外部工作流点来源站在浏览器搜索，下载 JSON / PNG 后用「ComfyUI 自定义工作流」节点的导入区拖入。模型权重需自行下载到 ComfyUI 的 models 目录。
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
