import { useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { usePersistentState } from "../../hooks/usePersistentState";
import { useFloatingBox, type Corner } from "../../hooks/useFloatingBox";
import { BookText, X, Plus, Trash2, Pin, PinOff, Pencil, Download, Upload, FolderOpen, Hash, Star, Check } from "lucide-react";
import { PROMPT_PRESETS } from "../../lib/promptLibraryPresets";

const DOCK_W = 380;

/**
 * 快捷提示词库面板：浏览内置预设、管理自定义提示词、设置 10 个「/」常用槽位、JSON 导入导出。
 * 浮动 / 可固定到右上角（与角色库一致的 useFloatingBox 壳）。数据走 trpc.promptLibrary。
 */
export function PromptLibraryPanel({ onClose }: { onClose: () => void }) {
  const { box, onHeaderMouseDown, onResizeMouseDown } = useFloatingBox(
    "ui:prompt-library:v1",
    { x: Math.max(16, (typeof window !== "undefined" ? window.innerWidth : 1200) - DOCK_W - 16), y: 56, w: DOCK_W, h: 640 },
    { minW: 260, minH: 300 },
  );
  const [pinned, setPinned] = usePersistentState<boolean>("ui:prompt-library:pinned:v1", false, { crossTab: false });
  const [tab, setTab] = useState<"mine" | "presets">("mine");
  const [showAdd, setShowAdd] = useState(false);

  const utils = trpc.useUtils();
  const { data: items } = trpc.promptLibrary.list.useQuery(undefined, { refetchOnWindowFocus: true });
  const refresh = () => utils.promptLibrary.list.invalidate();
  const createMut = trpc.promptLibrary.create.useMutation({ onSuccess: refresh, onError: (e) => toast.error("保存失败：" + e.message) });
  const updateMut = trpc.promptLibrary.update.useMutation({ onSuccess: refresh, onError: (e) => toast.error("更新失败：" + e.message) });
  const deleteMut = trpc.promptLibrary.delete.useMutation({ onSuccess: refresh, onError: (e) => toast.error("删除失败：" + e.message) });

  type PItem = NonNullable<typeof items>[number];
  const list: PItem[] = items ?? [];
  const byCategory = useMemo(() => {
    const m = new Map<string, PItem[]>();
    for (const it of list) { const a = m.get(it.category) ?? []; a.push(it); m.set(it.category, a); }
    return Array.from(m.entries());
  }, [list]);

  // 新增表单
  const [draft, setDraft] = useState<{ label: string; text: string; category: string }>({ label: "", text: "", category: "通用" });
  // 内联编辑中的条目（id → 编辑草稿）。null = 不在编辑。
  const [editing, setEditing] = useState<{ id: number; label: string; text: string; category: string } | null>(null);
  const saveEdit = () => {
    if (!editing) return;
    if (!editing.label.trim() || !editing.text.trim()) { toast.error("名称与内容不能为空"); return; }
    updateMut.mutate({ id: editing.id, label: editing.label.trim(), text: editing.text, category: editing.category.trim() || "通用" });
    setEditing(null);
  };
  const addPrompt = () => {
    if (!draft.label.trim() || !draft.text.trim()) { toast.error("请填写名称与内容"); return; }
    createMut.mutate({ label: draft.label.trim(), text: draft.text, category: draft.category.trim() || "通用" });
    setDraft({ label: "", text: "", category: draft.category });
  };

  // 设到第 n 个槽位（1-10 → slot 0-9）；先清掉占用该槽位的其它项，再设当前项。
  const assignSlot = (id: number, slot: number | null, kind: "prompt" | "category") => {
    if (slot != null) {
      const occupier = list.find((it) => it.slot === slot && it.id !== id);
      if (occupier) updateMut.mutate({ id: occupier.id, slot: null });
    }
    updateMut.mutate({ id, slot, slotKind: slot == null ? null : kind });
  };

  const favPrompt = (label: string, text: string, category: string) => {
    createMut.mutate({ label, text, category });
    toast.success(`已加入我的库「${label}」`);
  };

  // 导出：我的提示词 → JSON。
  const exportJson = () => {
    const data = list.map(({ label, text, category, slot, slotKind }) => ({ label, text, category, slot, slotKind }));
    const blob = new Blob([JSON.stringify({ version: 1, prompts: data }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `prompt-library-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast.success("已导出提示词库");
  };
  const importRef = useRef<HTMLInputElement>(null);
  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { prompts?: Array<{ label?: string; text?: string; category?: string; slot?: number | null; slotKind?: "prompt" | "category" | null }> };
      const arr = Array.isArray(parsed.prompts) ? parsed.prompts : [];
      let n = 0;
      for (const p of arr) {
        if (!p.label?.trim() || typeof p.text !== "string") continue;
        await createMut.mutateAsync({ label: p.label.trim(), text: p.text, category: (p.category || "通用").trim(), slot: p.slot ?? null, slotKind: p.slotKind ?? null });
        n++;
      }
      toast.success(`已导入 ${n} 条提示词`);
      refresh();
    } catch (e) { toast.error("导入失败：" + (e instanceof Error ? e.message : "格式不符")); }
  };

  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = pinned ? vw - DOCK_W - 16 : box.x;
  const top = pinned ? 56 : box.y;
  const width = pinned ? DOCK_W : box.w;
  const maxHeight = pinned ? Math.max(360, vh - 88) : Math.min(box.h, vh - top - 16);

  const cornerHandle = (corner: Corner, style: React.CSSProperties) => (
    <div onMouseDown={onResizeMouseDown(corner)} style={{ position: "absolute", width: 16, height: 16, zIndex: 3, cursor: corner === "tl" || corner === "br" ? "nwse-resize" : "nesw-resize", ...style }} />
  );

  const slotPicker = (id: number, kind: "prompt" | "category", currentSlot: number | null) => (
    <select
      value={currentSlot ?? ""}
      onChange={(e) => assignSlot(id, e.target.value === "" ? null : Number(e.target.value), kind)}
      title="设为「/」快捷槽位（1-10）"
      className="nodrag"
      style={{ fontSize: 10, padding: "1px 2px", borderRadius: 5, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: currentSlot != null ? "oklch(0.66 0.18 30)" : "var(--c-t4)" }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <option value="">槽位…</option>
      {Array.from({ length: 10 }).map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
    </select>
  );

  return (
    <div
      className="nodrag nowheel flex flex-col"
      style={{ position: "fixed", left, top, width, height: "auto", maxHeight, zIndex: 40, background: "var(--c-base)", border: "1px solid var(--c-bd1)", borderRadius: 12, boxShadow: "var(--c-node-shadow-hover)", overflow: "hidden" }}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3.5 py-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-elevated)", cursor: pinned ? "default" : "move", userSelect: "none" }} onMouseDown={pinned ? undefined : onHeaderMouseDown}>
        <div className="flex items-center gap-2">
          <BookText className="w-4 h-4" style={{ color: "oklch(0.66 0.18 30)" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--c-t1)" }}>提示词库</span>
          <span style={{ fontSize: 11, color: "var(--c-t4)" }}>{list.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={exportJson} className="nodrag" title="导出 JSON" style={{ color: "var(--c-t3)", cursor: "pointer", background: "none", border: "none", padding: 2 }}><Download className="w-3.5 h-3.5" /></button>
          <button onClick={() => importRef.current?.click()} className="nodrag" title="导入 JSON" style={{ color: "var(--c-t3)", cursor: "pointer", background: "none", border: "none", padding: 2 }}><Upload className="w-3.5 h-3.5" /></button>
          <button onClick={() => setPinned((p) => !p)} className="nodrag" title={pinned ? "取消固定" : "固定到右上角"} style={{ color: pinned ? "oklch(0.66 0.18 30)" : "var(--c-t3)", cursor: "pointer", background: "none", border: "none", padding: 2 }}>{pinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}</button>
          <button onClick={onClose} className="nodrag" style={{ color: "var(--c-t3)", cursor: "pointer", background: "none", border: "none" }}><X className="w-4 h-4" /></button>
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-1 px-2 pt-2 flex-shrink-0">
        {(["mine", "presets"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="nodrag" style={{ flex: 1, fontSize: 11, fontWeight: 600, padding: "5px 8px", borderRadius: 7, cursor: "pointer", border: "1px solid var(--c-bd2)", background: tab === t ? "oklch(0.66 0.18 30 / 0.14)" : "transparent", color: tab === t ? "oklch(0.66 0.18 30)" : "var(--c-t3)" }}>
            {t === "mine" ? "我的提示词" : "专业预设"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5 p-2.5 overflow-y-auto" style={{ flex: 1, minHeight: 0 }}>
        {tab === "mine" && (
          <>
            {/* 新增表单：默认收起为一个按钮，点开才展开，把高度还给列表 */}
            {!showAdd ? (
              <button onClick={() => setShowAdd(true)} className="nodrag flex items-center justify-center gap-1 flex-shrink-0" style={{ fontSize: 11.5, fontWeight: 600, padding: "7px", borderRadius: 8, cursor: "pointer", border: "1px dashed var(--c-bd2)", background: "transparent", color: "oklch(0.66 0.18 30)" }}><Plus className="w-3.5 h-3.5" /> 新增提示词</button>
            ) : (
              <div className="flex flex-col gap-1.5 p-2 flex-shrink-0" style={{ border: "1px dashed oklch(0.66 0.18 30 / 0.4)", borderRadius: 8 }}>
                <div className="flex gap-1.5">
                  <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} placeholder="名称" className="nodrag" style={{ flex: 1, fontSize: 11, padding: "4px 6px", borderRadius: 6, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }} />
                  <input value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} placeholder="类别" className="nodrag" style={{ width: 88, fontSize: 11, padding: "4px 6px", borderRadius: 6, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }} />
                </div>
                <textarea value={draft.text} onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))} placeholder="提示词内容" rows={2} className="nodrag" style={{ fontSize: 11, padding: "4px 6px", borderRadius: 6, background: "var(--c-input)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", resize: "vertical" }} />
                <div className="flex gap-1.5">
                  <button onClick={() => { addPrompt(); }} disabled={createMut.isPending} className="nodrag flex items-center justify-center gap-1" style={{ flex: 1, fontSize: 11, fontWeight: 600, padding: "5px", borderRadius: 6, cursor: "pointer", border: "none", background: "oklch(0.66 0.18 30 / 0.14)", color: "oklch(0.66 0.18 30)" }}><Plus className="w-3.5 h-3.5" /> 新增提示词</button>
                  <button onClick={() => setShowAdd(false)} className="nodrag" style={{ fontSize: 11, padding: "5px 10px", borderRadius: 6, cursor: "pointer", border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t3)" }}>收起</button>
                </div>
              </div>
            )}

            {list.length === 0 && <div style={{ fontSize: 11, color: "var(--c-t4)", textAlign: "center", padding: "16px 8px" }}>还没有自定义提示词。<br />在文本框输入「/」可快速调出。</div>}

            {byCategory.map(([cat, arr]) => (
              <div key={cat} className="flex flex-col gap-1">
                <div className="flex items-center gap-1" style={{ fontSize: 10, fontWeight: 700, color: "var(--c-t4)", textTransform: "uppercase", letterSpacing: "0.05em" }}><FolderOpen className="w-3 h-3" /> {cat}</div>
                {arr.map((it) => (
                  editing?.id === it.id ? (
                    // 内联编辑：名称 / 类别 / 正文 + 保存/取消。
                    <div key={it.id} className="flex flex-col gap-1.5 px-2 py-2 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid oklch(0.66 0.18 30 / 0.4)" }}>
                      <div className="flex gap-1.5">
                        <input value={editing.label} onChange={(e) => setEditing((s) => s && { ...s, label: e.target.value })} placeholder="名称" className="nodrag" style={{ flex: 1, fontSize: 11, padding: "4px 6px", borderRadius: 6, background: "var(--c-base)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }} />
                        <input value={editing.category} onChange={(e) => setEditing((s) => s && { ...s, category: e.target.value })} placeholder="类别" className="nodrag" style={{ width: 88, fontSize: 11, padding: "4px 6px", borderRadius: 6, background: "var(--c-base)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }} />
                      </div>
                      <textarea value={editing.text} onChange={(e) => setEditing((s) => s && { ...s, text: e.target.value })} placeholder="提示词内容" rows={2} className="nodrag" style={{ fontSize: 11, padding: "4px 6px", borderRadius: 6, background: "var(--c-base)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", resize: "vertical" }} />
                      <div className="flex gap-1.5">
                        <button onClick={saveEdit} disabled={updateMut.isPending} className="nodrag flex items-center justify-center gap-1" style={{ flex: 1, fontSize: 11, fontWeight: 600, padding: "4px", borderRadius: 6, cursor: "pointer", border: "none", background: "oklch(0.66 0.18 30 / 0.16)", color: "oklch(0.66 0.18 30)" }}><Check className="w-3 h-3" /> 保存</button>
                        <button onClick={() => setEditing(null)} className="nodrag" style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer", border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t3)" }}>取消</button>
                      </div>
                    </div>
                  ) : (
                    <div key={it.id} className="group flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd2)" }}>
                      {it.slot != null && <Star className="w-3 h-3 flex-shrink-0" style={{ color: "oklch(0.66 0.18 30)", fill: "oklch(0.66 0.18 30)" }} />}
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditing({ id: it.id, label: it.label, text: it.text, category: it.category })} title="点击编辑">
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</div>
                        <div title={it.text} style={{ fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.45, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.text}</div>
                      </div>
                      {slotPicker(it.id, "prompt", it.slot)}
                      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditing({ id: it.id, label: it.label, text: it.text, category: it.category })} className="nodrag" title="编辑（名称/类别/正文）" style={{ background: "none", border: "none", color: "var(--c-t3)", cursor: "pointer", padding: 3 }}><Pencil className="w-3 h-3" /></button>
                        <button onClick={() => { if (window.confirm(`删除「${it.label}」？`)) deleteMut.mutate({ id: it.id }); }} className="nodrag" title="删除" style={{ background: "none", border: "none", color: "var(--c-t3)", cursor: "pointer", padding: 3 }}><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  )
                ))}
              </div>
            ))}

            {/* 把某「类别」设为槽位（点击「/」时展开二级菜单） */}
            {byCategory.length > 0 && (
              <div className="flex flex-col gap-1 mt-1 pt-2" style={{ borderTop: "1px solid var(--c-bd2)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--c-t4)" }}>把类别设为槽位（展开二级菜单）</div>
                {byCategory.map(([cat, arr]) => {
                  // 用该类第一条作为「类别槽位」载体（slotKind=category）。
                  const carrier = arr.find((a) => a.slotKind === "category") ?? arr[0];
                  const catSlot = arr.find((a) => a.slotKind === "category")?.slot ?? null;
                  return (
                    <div key={"catslot:" + cat} className="flex items-center gap-1.5 px-2 py-1" style={{ fontSize: 11 }}>
                      <Hash className="w-3 h-3 flex-shrink-0" style={{ color: "oklch(0.62 0.16 240)" }} />
                      <span className="flex-1 min-w-0" style={{ color: "var(--c-t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat}</span>
                      {slotPicker(carrier.id, "category", catSlot)}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {tab === "presets" && (
          PROMPT_PRESETS.map((c) => (
            <div key={c.category} className="flex flex-col gap-1">
              <div className="flex items-center gap-1" style={{ fontSize: 10, fontWeight: 700, color: "var(--c-t4)", textTransform: "uppercase", letterSpacing: "0.05em" }}><FolderOpen className="w-3 h-3" /> {c.category}</div>
              {c.items.map((p) => (
                <div key={p.label} className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: "var(--c-input)", border: "1px solid var(--c-bd2)" }}>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</div>
                    <div title={p.text} style={{ fontSize: 10.5, color: "var(--c-t4)", lineHeight: 1.45, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.text}</div>
                  </div>
                  <button onClick={() => favPrompt(p.label, p.text, c.category)} className="nodrag flex-shrink-0 flex items-center gap-0.5" title="加入我的库" style={{ fontSize: 10, padding: "3px 7px", borderRadius: 6, border: "1px solid oklch(0.66 0.18 30 / 0.3)", background: "oklch(0.66 0.18 30 / 0.1)", color: "oklch(0.66 0.18 30)", cursor: "pointer" }}><Plus className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <input ref={importRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ""; }} />
      {!pinned && (<>
        {cornerHandle("tl", { left: -2, top: -2 })}
        {cornerHandle("tr", { right: -2, top: -2 })}
        {cornerHandle("bl", { left: -2, bottom: -2 })}
        {cornerHandle("br", { right: -2, bottom: -2 })}
      </>)}
    </div>
  );
}
