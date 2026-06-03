import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { X, Boxes, Workflow, Trash2, Download, Upload, FolderOpen, Cloud, Server } from "lucide-react";
import { getNodeConfig } from "../../lib/nodeConfig";
import {
  listComfyNodeTemplates, deleteComfyNodeTemplate, colorForTemplate,
  exportComfyNodeTemplatesJson, importComfyNodeTemplatesJson,
  type ComfyNodeTemplate, type ComfyNodeType,
} from "../../lib/comfyNodeTemplates";
import { summarizeComfyWorkflow } from "../../lib/comfyWorkflowSummary";

interface Props {
  onClose: () => void;
  /** Re-create a fully-configured node from a template (like duplicating). */
  onUse: (nodeType: ComfyNodeType, payload: Record<string, unknown>) => void;
}

function templateSummary(t: ComfyNodeTemplate): string {
  const p = t.payload as Record<string, unknown>;
  if (t.nodeType === "comfyui_workflow") {
    const s = summarizeComfyWorkflow(typeof p.workflowJson === "string" ? p.workflowJson : undefined);
    return s.ok ? s.brief : "未加载工作流";
  }
  const parts: string[] = [];
  const tpl = p.workflowTemplate;
  if (typeof tpl === "string" && tpl) parts.push(tpl);
  const ckpt = p.ckpt;
  if (typeof ckpt === "string" && ckpt) parts.push(ckpt.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ""));
  const prompt = p.prompt;
  if (typeof prompt === "string" && prompt.trim()) {
    const snippet = prompt.trim().slice(0, 40);
    parts.push(`"${snippet}${prompt.trim().length > 40 ? "…" : ""}"`);
  }
  return parts.length > 0 ? parts.join(" · ") : "无参数";
}

export function NodeTemplateLibrary({ onClose, onUse }: Props) {
  const [items, setItems] = useState<ComfyNodeTemplate[]>(() => listComfyNodeTemplates());
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => setItems(listComfyNodeTemplates()), []);

  const handleDelete = useCallback((id: string) => {
    deleteComfyNodeTemplate(id);
    refresh();
  }, [refresh]);

  const handleExport = useCallback(() => {
    const json = exportComfyNodeTemplatesJson();
    if (!json) { toast.info("模板库还是空的"); return; }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "comfy-node-templates.json";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = useCallback((file: File) => {
    file.text().then((txt) => {
      const { imported, skipped } = importComfyNodeTemplatesJson(txt);
      refresh();
      toast[imported > 0 ? "success" : "error"](
        imported > 0
          ? `已导入 ${imported} 个模板${skipped ? `（跳过 ${skipped}）` : ""}`
          : "未导入任何模板（格式不符）",
      );
    }).catch(() => toast.error("读取文件失败"));
  }, [refresh]);

  const grouped = useMemo(() => items, [items]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.60)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col rounded-2xl overflow-hidden animate-scale-in"
        style={{
          width: "min(820px, 95vw)",
          maxHeight: "88vh",
          background: "var(--c-base)",
          border: "1px solid var(--c-bd2)",
          boxShadow: "0 24px 80px oklch(0 0 0 / 0.65)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-bd1)" }}>
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "oklch(0.65 0.20 140 / 0.18)", border: "1px solid oklch(0.65 0.20 140 / 0.35)" }}
          >
            <Boxes className="w-4 h-4" style={{ color: "oklch(0.65 0.20 140)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "var(--c-t1)" }}>ComfyUI 节点模板库</p>
            <p className="text-[11px]" style={{ color: "var(--c-t4)" }}>
              点击模板快速创建带参数的节点（如复制节点），外框颜色区分节点类型
            </p>
          </div>

          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex-shrink-0"
            style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t3)" }}
            title="导出模板库为 .json"
          >
            <Download className="w-3.5 h-3.5" /> 导出
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex-shrink-0"
            style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t3)" }}
            title="从 .json 导入模板"
          >
            <Upload className="w-3.5 h-3.5" /> 导入
          </button>
          <input
            ref={fileRef} type="file" accept="application/json,.json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ""; }}
          />

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
            style={{ color: "var(--c-t4)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-bd1)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {grouped.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <FolderOpen style={{ width: 40, height: 40, color: "var(--c-t4)" }} />
              <p className="text-sm" style={{ color: "var(--c-t4)" }}>模板库还是空的</p>
              <p className="text-xs text-center" style={{ color: "var(--c-t4)", maxWidth: 360 }}>
                右键任意 ComfyUI 节点（图像 / 视频 / 自定义）→「存入模板库（含参数）」即可保存
              </p>
            </div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
              {grouped.map((t) => {
                const color = colorForTemplate(t.nodeType, t.useCloud);
                const config = getNodeConfig(t.nodeType);
                const isWorkflow = t.nodeType === "comfyui_workflow";
                const Icon = isWorkflow ? Workflow : Boxes;
                return (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { onUse(t.nodeType, t.payload); onClose(); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onUse(t.nodeType, t.payload); onClose(); } }}
                    className="group w-full text-left rounded-2xl overflow-hidden transition-all duration-150 flex flex-col relative cursor-pointer"
                    style={{ background: "var(--c-base)", border: `1.5px solid ${color}` }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = "var(--c-surface)";
                      el.style.transform = "translateY(-1px)";
                      el.style.boxShadow = `0 6px 24px ${color}40`;
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = "var(--c-base)";
                      el.style.transform = "translateY(0)";
                      el.style.boxShadow = "none";
                    }}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                      className="absolute top-2 right-2 z-10 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: "var(--c-bd2)", color: "oklch(0.55 0.15 25)" }}
                      title="删除模板"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>

                    <div className="px-3.5 pt-3.5 pb-3.5 flex flex-col gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: `${color}1a`, border: `1px solid ${color}40` }}
                        >
                          <Icon className="w-3.5 h-3.5" style={{ color }} />
                        </span>
                        <span className="text-sm font-semibold truncate" style={{ color: "var(--c-t1)" }}>
                          {t.label}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-1"
                          style={{ background: `${color}18`, border: `1px solid ${color}30`, color }}
                        >
                          {config.label}
                        </span>
                        {isWorkflow && (
                          <span
                            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-1"
                            style={{ background: `${color}12`, border: `1px solid ${color}28`, color }}
                          >
                            {t.useCloud ? <><Cloud className="w-2.5 h-2.5" /> 云端</> : <><Server className="w-2.5 h-2.5" /> 本地</>}
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: "var(--c-t3)" }}>
                        {templateSummary(t)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-3 flex-shrink-0 text-[10px]"
          style={{ borderTop: "1px solid var(--c-elevated)", color: "var(--c-t4)" }}
        >
          <span>{grouped.length} 个模板 · 点击即可在画布中心新建节点</span>
          <kbd
            className="px-1.5 py-0.5 rounded text-[9px] font-mono"
            style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t4)" }}
          >
            ESC 关闭
          </kbd>
        </div>
      </div>
    </div>
  );
}
