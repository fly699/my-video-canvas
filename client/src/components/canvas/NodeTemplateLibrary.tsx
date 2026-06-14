import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { X, Boxes, Workflow, Trash2, Download, Upload, FolderOpen, Cloud, Server, Search, Pencil, Check, Loader2, User, Clock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePersistentState } from "../../hooks/usePersistentState";
import { getNodeConfig } from "../../lib/nodeConfig";
import {
  colorForTemplate, describeComfyTemplate, isComfyNodeType,
  type ComfyNodeTemplate, type ComfyNodeType,
} from "../../lib/comfyNodeTemplates";

interface Props {
  onClose: () => void;
  /** Re-create a fully-configured node from a template (like duplicating).
   *  `label` becomes the new node's corner annotation. */
  onUse: (nodeType: ComfyNodeType, payload: Record<string, unknown>, label: string) => void;
}

type CategoryId = "all" | ComfyNodeType;
const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "comfyui_image", label: "图像" },
  { id: "comfyui_video", label: "视频" },
  { id: "comfyui_workflow", label: "自定义" },
];

export function NodeTemplateLibrary({ onClose, onUse }: Props) {
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery(undefined, { staleTime: 60_000 });
  const listQuery = trpc.comfyTemplates.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const items = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  const me = meQuery.data;
  const canManage = useCallback(
    (t: ComfyNodeTemplate) => !!me && (t.userId === me.id || me.role === "admin"),
    [me],
  );
  const isMine = useCallback(
    (t: ComfyNodeTemplate) => !!me && t.userId === me.id,
    [me],
  );

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId>("all");
  const [mineOnly, setMineOnly] = useState(false);
  // Recently-used template ids (most-recent first), persisted locally.
  const [recentIds, setRecentIds] = usePersistentState<number[]>(
    "ui:nodetpl:recent:v1", [],
    { validate: (v) => (Array.isArray(v) && v.every((x) => typeof x === "number") ? (v as number[]) : null), crossTab: false },
  );
  const useTemplate = useCallback((t: ComfyNodeTemplate) => {
    const next = [t.id, ...recentIds.filter((id) => id !== t.id)].slice(0, 6);
    setRecentIds(next);
    // Persist synchronously: onClose() unmounts this panel before the
    // usePersistentState write-through effect can commit, so write now.
    try { window.localStorage.setItem("ui:nodetpl:recent:v1", JSON.stringify(next)); } catch { /* ignore */ }
    onUse(t.nodeType, t.payload, t.label);
    onClose();
  }, [recentIds, onUse, onClose, setRecentIds]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editNote, setEditNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const deleteMut = trpc.comfyTemplates.delete.useMutation({
    onSuccess: () => utils.comfyTemplates.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.comfyTemplates.update.useMutation({
    onSuccess: () => { utils.comfyTemplates.list.invalidate(); setEditingId(null); },
    onError: (e) => toast.error(e.message),
  });
  const createMut = trpc.comfyTemplates.create.useMutation();

  const startEdit = useCallback((t: ComfyNodeTemplate) => {
    setEditingId(t.id);
    setEditLabel(t.label);
    setEditNote(t.note ?? "");
  }, []);

  const saveEdit = useCallback(() => {
    if (editingId == null) return;
    if (!editLabel.trim()) { toast.error("名称不能为空"); return; }
    updateMut.mutate({ id: editingId, label: editLabel.trim(), note: editNote });
  }, [editingId, editLabel, editNote, updateMut]);

  const mineCount = useMemo(() => items.filter(isMine).length, [items, isMine]);

  const counts = useMemo(() => {
    const base = mineOnly ? items.filter(isMine) : items;
    const c: Record<string, number> = { all: base.length };
    for (const t of base) c[t.nodeType] = (c[t.nodeType] ?? 0) + 1;
    return c;
  }, [items, mineOnly, isMine]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((t) => {
      if (mineOnly && !isMine(t)) return false;
      if (category !== "all" && t.nodeType !== category) return false;
      if (!q) return true;
      const hay = [t.label, t.note ?? "", t.creatorName ?? "", getNodeConfig(t.nodeType).label, describeComfyTemplate(t.nodeType, t.payload)]
        .join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [items, category, query, mineOnly, isMine]);

  // Export honors the current view (search / category / 只看我的).
  const exportList = filtered;

  // Recently-used templates that still exist, in recency order — only surfaced
  // in the clean default view (no search / category / 只看我的 filter).
  const recentTemplates = useMemo(() => {
    if (query.trim() || category !== "all" || mineOnly) return [];
    const byId = new Map(items.map((t) => [t.id, t]));
    return recentIds.map((id) => byId.get(id)).filter((t): t is ComfyNodeTemplate => !!t).slice(0, 6);
  }, [items, recentIds, query, category, mineOnly]);

  const handleExport = useCallback(() => {
    if (exportList.length === 0) { toast.info("当前筛选下没有可导出的模板"); return; }
    const templates = exportList.map((t) => ({
      label: t.label, nodeType: t.nodeType, payload: t.payload, note: t.note, useCloud: t.useCloud,
    }));
    const json = JSON.stringify({ version: 1, kind: "comfyNodeTemplates", exportedAt: new Date().toISOString(), templates }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "comfy-node-templates.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${exportList.length} 个模板`);
  }, [exportList]);

  const handleImport = useCallback(async (file: File) => {
    let parsed: unknown;
    try { parsed = JSON.parse(await file.text()); } catch { toast.error("读取文件失败"); return; }
    const arr: unknown[] = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === "object" && Array.isArray((parsed as { templates?: unknown }).templates))
        ? (parsed as { templates: unknown[] }).templates
        : [];
    if (arr.length === 0) { toast.error("未找到可导入的模板"); return; }
    let imported = 0, skipped = 0;
    for (const raw of arr) {
      const r = raw as Record<string, unknown>;
      const label = typeof r?.label === "string" ? r.label.trim() : "";
      const nodeType = typeof r?.nodeType === "string" ? r.nodeType : "";
      const payload = r?.payload && typeof r.payload === "object" ? (r.payload as Record<string, unknown>) : null;
      if (!label || !payload || !isComfyNodeType(nodeType)) { skipped++; continue; }
      try {
        await createMut.mutateAsync({
          label, nodeType, payload,
          note: typeof r.note === "string" ? r.note : undefined,
          useCloud: typeof r.useCloud === "boolean" ? r.useCloud : undefined,
        });
        imported++;
      } catch { skipped++; }
    }
    utils.comfyTemplates.list.invalidate();
    toast[imported > 0 ? "success" : "error"](
      imported > 0 ? `已导入 ${imported} 个模板${skipped ? `（跳过 ${skipped}）` : ""}` : "未导入任何模板（格式不符）",
    );
  }, [createMut, utils]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.60)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col rounded-2xl overflow-hidden animate-scale-in"
        style={{
          width: "min(860px, 95vw)",
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
            <p className="text-sm font-semibold" style={{ color: "var(--c-t1)" }}>ComfyUI 节点模板库（共享）</p>
            <p className="text-[11px]" style={{ color: "var(--c-t4)" }}>
              全员共享 · 点击模板快速创建带参数的节点，外框颜色区分节点类型
            </p>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl" style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd2)", width: 200 }}>
            <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--c-t4)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索名称 / 注释 / 模型"
              className="flex-1 min-w-0 bg-transparent outline-none text-xs"
              style={{ color: "var(--c-t1)" }}
            />
            {query && <button onClick={() => setQuery("")} style={{ color: "var(--c-t4)" }}><X className="w-3 h-3" /></button>}
          </div>

          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex-shrink-0"
            style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t3)" }}
            title={
              exportList.length < items.length
                ? `导出当前筛选结果（${exportList.length} 个）为 .json，不含缩略图`
                : "导出模板库为 .json（不含缩略图）"
            }
          >
            <Download className="w-3.5 h-3.5" /> 导出
            {exportList.length < items.length && (
              <span className="text-[9px] px-1 py-0.5 rounded-full font-semibold" style={{ background: "var(--c-bd1)", color: "var(--c-t4)" }}>
                {exportList.length}
              </span>
            )}
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
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImport(f); e.target.value = ""; }}
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

        {/* Category tabs */}
        <div className="flex items-center gap-1 px-5 py-3 flex-shrink-0 overflow-x-auto" style={{ borderBottom: "1px solid var(--c-elevated)" }}>
          {CATEGORIES.map((cat) => {
            const active = category === cat.id;
            const accent = cat.id === "all" ? "oklch(0.65 0.20 140)" : colorForTemplate(cat.id, false);
            return (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap"
                style={{
                  background: active ? `${accent}18` : "transparent",
                  border: active ? `1px solid ${accent}35` : "1px solid transparent",
                  color: active ? accent : "var(--c-t3)",
                }}
              >
                {cat.label}
                <span className="text-[9px] px-1 py-0.5 rounded-full font-semibold" style={{ background: active ? `${accent}25` : "var(--c-bd1)", color: active ? accent : "var(--c-t4)" }}>
                  {counts[cat.id] ?? 0}
                </span>
              </button>
            );
          })}

          {/* Mine-only filter */}
          {mineCount > 0 && (
            <button
              onClick={() => setMineOnly((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap ml-auto flex-shrink-0"
              style={{
                background: mineOnly ? "oklch(0.62 0.18 265 / 0.18)" : "transparent",
                border: mineOnly ? "1px solid oklch(0.62 0.18 265 / 0.40)" : "1px solid var(--c-bd2)",
                color: mineOnly ? "oklch(0.62 0.18 265)" : "var(--c-t3)",
              }}
              title="只显示我创建的模板"
            >
              <User className="w-3.5 h-3.5" /> 只看我的
              <span className="text-[9px] px-1 py-0.5 rounded-full font-semibold" style={{ background: mineOnly ? "oklch(0.62 0.18 265 / 0.25)" : "var(--c-bd1)", color: mineOnly ? "oklch(0.62 0.18 265)" : "var(--c-t4)" }}>
                {mineCount}
              </span>
            </button>
          )}
        </div>

        {/* Grid (scrollable) */}
        <div className="flex-1 overflow-y-auto p-5">
          {listQuery.isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--c-t4)" }} />
              <p className="text-sm" style={{ color: "var(--c-t4)" }}>加载中…</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <FolderOpen style={{ width: 40, height: 40, color: "var(--c-t4)" }} />
              <p className="text-sm" style={{ color: "var(--c-t4)" }}>模板库还是空的</p>
              <p className="text-xs text-center" style={{ color: "var(--c-t4)", maxWidth: 360 }}>
                右键任意 ComfyUI 节点（图像 / 视频 / 自定义）→「存入模板库（含参数）」即可保存，所有人可见
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Search style={{ width: 40, height: 40, color: "var(--c-t4)" }} />
              <p className="text-sm" style={{ color: "var(--c-t4)" }}>没有匹配的模板</p>
            </div>
          ) : (
            <>
              {recentTemplates.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: "var(--c-t4)" }}>
                    <Clock className="w-3 h-3" /> 最近使用
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {recentTemplates.map((t) => {
                      const color = colorForTemplate(t.nodeType, t.useCloud);
                      const Icon = t.nodeType === "comfyui_workflow" ? Workflow : Boxes;
                      return (
                        <button
                          key={`recent-${t.id}`}
                          onClick={() => useTemplate(t)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all"
                          style={{ background: `${color}12`, border: `1px solid ${color}35`, color: "var(--c-t1)" }}
                          title={`快速创建：${t.label}`}
                        >
                          <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
                          <span className="truncate" style={{ maxWidth: 140 }}>{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
              {filtered.map((t) => {
                const color = colorForTemplate(t.nodeType, t.useCloud);
                const config = getNodeConfig(t.nodeType);
                const isWorkflow = t.nodeType === "comfyui_workflow";
                const Icon = isWorkflow ? Workflow : Boxes;
                const mine = canManage(t);
                const isEditing = editingId === t.id;

                if (isEditing) {
                  return (
                    <div key={t.id} className="rounded-2xl flex flex-col gap-2 px-3.5 py-3.5" style={{ background: "var(--c-surface)", border: `1.5px solid ${color}` }}>
                      <input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                        className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-none"
                        style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t1)" }}
                        autoFocus
                        maxLength={64}
                        placeholder="名称"
                      />
                      <textarea
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
                        style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t1)", minHeight: 48, resize: "vertical" }}
                        maxLength={300}
                        placeholder="注释（可选）"
                      />
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t3)" }}>取消</button>
                        <button onClick={saveEdit} disabled={updateMut.isPending} className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1" style={{ background: color, color: "#fff" }}>
                          {updateMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} 保存
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => useTemplate(t)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); useTemplate(t); } }}
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
                    {/* Edit + delete actions — only for own templates (or admin) */}
                    {mine && (
                      <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); startEdit(t); }}
                          className="w-6 h-6 rounded-lg flex items-center justify-center"
                          style={{ background: "var(--c-bd2)", color: "var(--c-t2)" }}
                          title="重命名 / 编辑注释"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); if (confirm(`删除模板「${t.label}」？`)) deleteMut.mutate({ id: t.id }); }}
                          className="w-6 h-6 rounded-lg flex items-center justify-center"
                          style={{ background: "var(--c-bd2)", color: "oklch(0.55 0.15 25)" }}
                          title="删除模板"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    <div className="px-3.5 pt-3.5 pb-3.5 flex flex-col gap-2">
                      <div className="flex items-center gap-2 min-w-0 pr-12">
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

                      {/* Note (if any) */}
                      {t.note && (
                        <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: "var(--c-t2)" }} title={t.note}>
                          {t.note}
                        </p>
                      )}

                      {/* Model / param info */}
                      <p className="text-[10.5px] leading-relaxed line-clamp-2" style={{ color: "var(--c-t4)" }}>
                        {describeComfyTemplate(t.nodeType, t.payload)}
                      </p>

                      {/* Creator */}
                      {t.creatorName && (
                        <p className="text-[10px] flex items-center gap-1 mt-0.5" style={{ color: "var(--c-t4)" }}>
                          <User className="w-2.5 h-2.5" /> {t.creatorName}{mine ? "（我）" : ""}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-3 flex-shrink-0 text-[10px]"
          style={{ borderTop: "1px solid var(--c-elevated)", color: "var(--c-t4)" }}
        >
          <span>{filtered.length}/{items.length} 个模板 · 点击即可在画布中心新建节点</span>
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
