import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowLeft, Plus, Film, Trash2, Loader2, Clapperboard, Check, Download, Undo2, Redo2, SlidersHorizontal, Keyboard } from "lucide-react";
import { useEditorStore } from "@/components/editor/editorStore";
import { MediaBin } from "@/components/editor/MediaBin";
import { Timeline } from "@/components/editor/Timeline";
import { PreviewStage } from "@/components/editor/PreviewStage";
import { PropertiesPanel } from "@/components/editor/PropertiesPanel";
import { CanvasSettings } from "@/components/editor/CanvasSettings";
import { downloadMedia } from "@/lib/download";
import { estimateExportBytes, formatBytes } from "@shared/exportQuality";
import { usePersistentState } from "@/hooks/usePersistentState";

// Draggable divider between editor panels. Reports incremental pixel deltas; the
// parent applies them to the adjacent panel's size (persisted).
function Resizer({ axis, onResize }: { axis: "x" | "y"; onResize: (deltaPx: number) => void }) {
  const last = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  return (
    <div
      onPointerDown={(e) => { e.preventDefault(); last.current = axis === "x" ? e.clientX : e.clientY; setActive(true); try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* no pointer */ } }}
      onPointerMove={(e) => { if (last.current == null) return; const cur = axis === "x" ? e.clientX : e.clientY; onResize(cur - last.current); last.current = cur; }}
      onPointerUp={(e) => { last.current = null; setActive(false); try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ } }}
      title="拖动调整大小"
      style={{
        flexShrink: 0, alignSelf: "stretch",
        [axis === "x" ? "width" : "height"]: 6,
        cursor: axis === "x" ? "col-resize" : "row-resize",
        background: active ? "var(--c-accent, oklch(0.68 0.22 285))" : "transparent",
        transition: "background 120ms", touchAction: "none", zIndex: 5,
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "var(--c-bd2)"; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    />
  );
}
const clampSize = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v)));

const ACCENT = "oklch(0.65 0.19 310)"; // 剪辑器主色（品红紫）

// Go back to wherever the user came from (e.g. the canvas that linked here);
// fall back to an explicit route if there's no in-app history to return to.
function goBack(navigate: (to: string) => void, fallback: string) {
  if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
  else navigate(fallback);
}

function fmtDate(d: Date | string) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Gallery of the user's saved editor sessions + "new". */
function EditorGallery() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const listQuery = trpc.editor.list.useQuery();
  const createMut = trpc.editor.create.useMutation({
    onSuccess: ({ id }) => navigate(`/editor/${id}`),
    onError: (e) => toast.error("创建失败：" + e.message),
  });
  const deleteMut = trpc.editor.delete.useMutation({
    onSuccess: () => { utils.editor.list.invalidate(); toast.success("已删除"); },
    onError: (e) => toast.error("删除失败：" + e.message),
  });

  const sessions = listQuery.data ?? [];

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-canvas, #0c0c10)", color: "var(--c-t1)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--c-bd2)" }}>
        <button onClick={() => goBack(navigate, "/")} title="返回" style={iconBtn}><ArrowLeft size={18} /></button>
        <Clapperboard size={20} style={{ color: ACCENT }} />
        <h1 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>视频剪辑器</h1>
        <span style={{ fontSize: 12, color: "var(--c-t3)" }}>多片段时间轴 · 单遍导出 · 高素质成片</span>
        <div style={{ flex: 1 }} />
        <button
          disabled={createMut.isPending}
          onClick={() => createMut.mutate({})}
          style={{ ...primaryBtn, opacity: createMut.isPending ? 0.6 : 1 }}
        >
          {createMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} 新建剪辑
        </button>
      </header>

      <div style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
        {listQuery.isLoading && <div style={{ color: "var(--c-t3)", fontSize: 13 }}>加载中…</div>}
        {!listQuery.isLoading && sessions.length === 0 && (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "60px 0", color: "var(--c-t3)" }}>
            <Film size={40} style={{ opacity: 0.4, marginBottom: 12 }} />
            <div style={{ fontSize: 14 }}>还没有剪辑项目，点右上角「新建剪辑」开始。</div>
          </div>
        )}
        {sessions.map((s) => (
          <div key={s.id} style={card} onClick={() => navigate(`/editor/${s.id}`)}>
            <div style={{ height: 124, background: "var(--c-elevated, #1a1a20)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {s.thumbnailUrl
                ? <img src={s.thumbnailUrl} alt={s.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <Film size={28} style={{ color: "var(--c-t4)" }} />}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
              <button
                title="删除"
                onClick={(e) => { e.stopPropagation(); if (confirm(`删除剪辑「${s.name}」？`)) deleteMut.mutate({ id: s.id }); }}
                style={{ ...iconBtn, width: 26, height: 26 }}
              ><Trash2 size={14} /></button>
            </div>
            <div style={{ fontSize: 11, color: "var(--c-t3)", marginTop: 2 }}>更新于 {fmtDate(s.updatedAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The full editor workspace for one session: media bin · preview · properties · timeline. */
function EditorWorkspace({ id }: { id: number }) {
  const [, navigate] = useLocation();
  const sessionQuery = trpc.editor.get.useQuery({ id }, { refetchOnWindowFocus: false });
  const [name, setName] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveMut = trpc.editor.save.useMutation();

  const load = useEditorStore((s) => s.load);
  const doc = useEditorStore((s) => s.doc);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const loadedFor = useRef<number | null>(null);

  // Workspace keyboard shortcuts (all ignored while typing in a field):
  //   Ctrl/⌘+Z 撤销 · Ctrl/⌘+Shift+Z / Ctrl+Y 重做
  //   空格 播放/暂停 · Home/End 跳到开头/结尾 · ←/→ 逐帧步进（Shift 加大步长）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable='true'], select")) return;
      // ? 开关快捷键速查浮层（Shift+/ 产生 "?"）；Esc 关闭。与画布速查面板对齐。
      if (e.key === "?") { e.preventDefault(); setShowShortcuts((v) => !v); return; }
      if (e.key === "Escape") { setShowShortcuts(false); return; }
      const st = useEditorStore.getState();
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) { e.preventDefault(); st.undo(); }
        else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); st.redo(); }
        else if (k === "a") { e.preventDefault(); st.selectAll(); } // 全选片段
        return;
      }
      if (!st.doc) return;
      const fps = st.doc.fps || 30;
      const step = (e.shiftKey ? 10 : 1) / fps; // one frame, or 10 with Shift
      if (e.key === " ") { e.preventDefault(); st.setPlaying(!st.playing); }
      else if (e.key === "Home") { e.preventDefault(); st.setPlaying(false); st.setPlayhead(0); }
      else if (e.key === "End") { e.preventDefault(); st.setPlaying(false); st.setPlayhead(st.duration()); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); st.setPlaying(false); st.setPlayhead(Math.max(0, st.playhead - step)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); st.setPlaying(false); st.setPlayhead(Math.min(st.duration(), st.playhead + step)); }
      // , / . 逐帧微移选中片段（Shift = 5 帧）。用 e.code 而非 e.key——按住 Shift
      // 时 "." / "," 会变成 ">" / "<"，e.code 不受影响。无选中时不响应。
      else if ((e.code === "Comma" || e.code === "Period") && st.selectedClipIds.length > 0) {
        e.preventDefault();
        const frames = e.shiftKey ? 5 : 1;
        st.nudgeSelected((e.code === "Period" ? frames : -frames) / fps);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Export (single-pass render) ──
  const [jobId, setJobId] = useState<string | null>(null);
  const [exportPct, setExportPct] = useState(0);
  const [exportStage, setExportStage] = useState("");
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  // Export settings (format / quality / resolution).
  const [exportFormat, setExportFormat] = useState<"mp4" | "hevc" | "webm" | "mov">("mp4");
  const [exportQualityPct, setExportQualityPct] = useState<number>(85);
  const [exportRes, setExportRes] = useState<"source" | "2160" | "1080" | "720" | "480">("source");
  const [exportMenu, setExportMenu] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Resizable panel sizes (persisted across sessions).
  const numVal = (min: number, max: number) => (p: unknown) => (typeof p === "number" && isFinite(p) ? clampSize(p, min, max) : null);
  const inPoint = useEditorStore((s) => s.inPoint);
  const outPoint = useEditorStore((s) => s.outPoint);
  const fullDuration = useEditorStore((s) => s.duration());
  // 预估导出文件大小：目标分辨率(保持画布比例)、实际渲染时长(含 in/out 区间)、所选格式与质量。
  const estBytes = (() => {
    if (!doc) return 0;
    const dims = exportRes === "source"
      ? { w: doc.width, h: doc.height }
      : { w: Math.round((doc.width * parseInt(exportRes, 10)) / doc.height), h: parseInt(exportRes, 10) };
    const dur = (inPoint != null || outPoint != null)
      ? Math.max(0, (outPoint ?? fullDuration) - (inPoint ?? 0))
      : fullDuration;
    return estimateExportBytes({ width: dims.w, height: dims.h, fps: doc.fps, durationSec: dur, format: exportFormat, qualityPct: exportQualityPct });
  })();
  const [leftW, setLeftW] = usePersistentState<number>("ui:editor:leftW:v1", 252, { validate: numVal(180, 480) });
  const [rightW, setRightW] = usePersistentState<number>("ui:editor:rightW:v1", 250, { validate: numVal(180, 520) });
  const [bottomH, setBottomH] = usePersistentState<number>("ui:editor:bottomH:v1", 230, { validate: numVal(120, 560) });
  const exportMut = trpc.editor.export.useMutation({
    onSuccess: ({ jobId }) => { setJobId(jobId); setExportUrl(null); setExportPct(0); setExportStage("排队中"); },
    onError: (e) => toast.error("导出失败：" + e.message),
  });
  const statusQuery = trpc.editor.exportStatus.useQuery({ jobId: jobId! }, {
    enabled: !!jobId,
    refetchInterval: 1000,
  });
  useEffect(() => {
    const d = statusQuery.data;
    if (!d) return;
    setExportPct(d.progress); setExportStage(d.stage);
    if (d.status === "done") { setJobId(null); setExportUrl(d.url); toast.success("成片已生成"); }
    if (d.status === "error") { setJobId(null); toast.error("渲染失败：" + (d.error ?? "")); }
  }, [statusQuery.data]);
  const exporting = exportMut.isPending || !!jobId;

  // Kick off an export, translating the resolution preset into output dims that
  // preserve the document's aspect ratio.
  const startExport = () => {
    setExportMenu(false);
    const d = useEditorStore.getState().doc;
    let width: number | undefined;
    let height: number | undefined;
    if (exportRes !== "source" && d) {
      const targetH = parseInt(exportRes, 10);
      const even = (n: number) => Math.max(2, Math.round(n) - (Math.round(n) % 2));
      height = even(targetH);
      width = even((d.width * targetH) / d.height);
    }
    // export range (in/out points) — only render the selected span when set
    const { inPoint, outPoint } = useEditorStore.getState();
    const hasRange = inPoint != null || outPoint != null;
    exportMut.mutate({
      id, format: exportFormat, qualityPct: exportQualityPct, width, height,
      rangeStart: hasRange ? (inPoint ?? 0) : undefined,
      rangeEnd: hasRange ? (outPoint ?? undefined) : undefined,
    });
  };

  // Load the fetched doc into the editor store once.
  useEffect(() => {
    if (sessionQuery.data && loadedFor.current !== id) {
      load(sessionQuery.data.doc);
      loadedFor.current = id;
    }
  }, [sessionQuery.data, id, load]);

  // Debounced autosave whenever the doc becomes dirty.
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (state.doc === prev.doc) return;
      if (!state.dirty) return;
      setSaveState("saving");
      clearTimeout((autosaveTimer as { t?: ReturnType<typeof setTimeout> }).t);
      (autosaveTimer as { t?: ReturnType<typeof setTimeout> }).t = setTimeout(() => {
        const cur = useEditorStore.getState();
        if (!cur.doc) return;
        saveMut.mutate({ id, doc: cur.doc }, {
          onSuccess: () => { useEditorStore.getState().markClean(); setSaveState("saved"); setTimeout(() => setSaveState("idle"), 1500); },
          onError: (e) => { setSaveState("idle"); toast.error("保存失败：" + e.message); },
        });
      }, 800);
    });
    return () => unsub();
  }, [id, saveMut]);

  // Flush a pending (debounced) save when leaving the editor — navigation or tab
  // close — so an edit made within the 800ms debounce isn't lost (mirrors Canvas).
  useEffect(() => {
    const flush = () => {
      const cur = useEditorStore.getState();
      if (cur.dirty && cur.doc) saveMut.mutate({ id, doc: cur.doc });
    };
    window.addEventListener("beforeunload", flush);
    return () => { window.removeEventListener("beforeunload", flush); flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (sessionQuery.isLoading || (sessionQuery.data && !doc)) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-canvas, #0c0c10)", color: "var(--c-t3)" }}><Loader2 className="animate-spin" /></div>;
  }
  if (sessionQuery.error || !sessionQuery.data) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "var(--c-canvas, #0c0c10)", color: "var(--c-t2)" }}>
        <div>剪辑不存在或无权访问。</div>
        <button onClick={() => navigate("/editor")} style={primaryBtn}>返回列表</button>
      </div>
    );
  }
  const session = sessionQuery.data;
  const displayName = name ?? session.name;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--c-canvas, #0c0c10)", color: "var(--c-t1)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", borderBottom: "1px solid var(--c-bd2)", flexShrink: 0 }}>
        <button onClick={() => goBack(navigate, "/editor")} title="返回" style={iconBtn}><ArrowLeft size={18} /></button>
        <Clapperboard size={18} style={{ color: ACCENT }} />
        <input
          value={displayName}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { if (name !== null && name !== session.name) saveMut.mutate({ id, name }); }}
          style={{ fontSize: 14, fontWeight: 600, background: "transparent", border: "1px solid transparent", borderRadius: 6, padding: "4px 8px", color: "var(--c-t1)", outline: "none", width: 200 }}
        />
        <span style={{ fontSize: 11, color: "var(--c-t4)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          {saveState === "saving" ? <><Loader2 size={11} className="animate-spin" /> 保存中</> : saveState === "saved" ? <><Check size={11} /> 已保存</> : null}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => undo()}
          disabled={!canUndo}
          title="撤销 (Ctrl+Z)"
          style={{ ...iconBtn, opacity: canUndo ? 1 : 0.4, cursor: canUndo ? "pointer" : "default" }}
        ><Undo2 size={16} /></button>
        <button
          onClick={() => redo()}
          disabled={!canRedo}
          title="重做 (Ctrl+Shift+Z)"
          style={{ ...iconBtn, opacity: canRedo ? 1 : 0.4, cursor: canRedo ? "pointer" : "default" }}
        ><Redo2 size={16} /></button>
        <CanvasSettings />
        {/* 快捷键速查（? 开关 / Esc 关闭）——剪辑器自身的播放·定位·片段·撤销快捷键一处可查 */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowShortcuts((v) => !v)}
            title="快捷键速查 (?)"
            style={{ ...iconBtn, color: showShortcuts ? ACCENT : "var(--c-t2)", borderColor: showShortcuts ? ACCENT : "var(--c-bd2)" }}
          ><Keyboard size={16} /></button>
          {showShortcuts && (
            <div
              style={{
                position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 50, width: 280,
                borderRadius: 16, padding: 16,
                background: "color-mix(in oklch, var(--c-base) 97%, transparent)",
                backdropFilter: "blur(24px)", border: "1px solid var(--c-bd2)",
                boxShadow: "0 16px 48px oklch(0 0 0 / 0.55), 0 4px 12px oklch(0 0 0 / 0.35)",
              }}
            >
              <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12, color: "var(--c-t4)" }}>剪辑器快捷键</p>
              {[
                { group: "播放 / 定位", items: [
                  { key: "空格", desc: "播放 / 暂停" },
                  { key: "Home", desc: "跳到开头" },
                  { key: "End", desc: "跳到结尾" },
                  { key: "← / →", desc: "逐帧步进" },
                  { key: "Shift + ← / →", desc: "一次跳 10 帧" },
                ]},
                { group: "选择", items: [
                  { key: "点击", desc: "选中片段" },
                  { key: "Shift/Ctrl + 点击", desc: "加选 / 减选片段" },
                  { key: "空白处拖拽", desc: "框选多个片段" },
                  { key: "Cmd/Ctrl + A", desc: "全选所有片段" },
                  { key: ", / .", desc: "逐帧微移所选（Shift = 5 帧）" },
                ]},
                { group: "片段编辑", items: [
                  { key: "Del / Backspace", desc: "删除选中片段" },
                  { key: "Shift + Del", desc: "波纹删除（关闭缺口）" },
                  { key: "S", desc: "在播放头处分割" },
                  { key: "Shift + S", desc: "全轨分割（切所有轨道）" },
                  { key: "Cmd/Ctrl + D", desc: "原地复制片段" },
                  { key: "Cmd/Ctrl + C", desc: "拷贝选中片段" },
                  { key: "Cmd/Ctrl + V", desc: "粘贴到播放头" },
                ]},
                { group: "撤销 / 重做", items: [
                  { key: "Cmd/Ctrl + Z", desc: "撤销" },
                  { key: "Cmd/Ctrl + Shift + Z", desc: "重做" },
                  { key: "Ctrl + Y", desc: "重做（Windows）" },
                ]},
                { group: "其他", items: [
                  { key: "?", desc: "开关本速查面板" },
                  { key: "Esc", desc: "关闭本面板" },
                ]},
              ].map(({ group, items }) => (
                <div key={group} style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6, color: "var(--c-t4)" }}>{group}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {items.map(({ key, desc }) => (
                      <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 11, color: "var(--c-t2)" }}>{desc}</span>
                        <span style={{ fontFamily: "monospace", fontSize: 10, padding: "1px 6px", borderRadius: 6, background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "oklch(0.72 0.12 285)", whiteSpace: "nowrap", flexShrink: 0 }}>{key}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {exportUrl && (
          <button onClick={() => downloadMedia(exportUrl, `${displayName}.${exportFormat === "hevc" ? "mp4" : exportFormat}`)} style={{ ...primaryBtn, background: "transparent", color: ACCENT, border: `1px solid ${ACCENT}` }}>
            <Download size={15} /> 下载成片
          </button>
        )}
        {(inPoint != null || outPoint != null) && (
          <span title="已设导出区段，仅导出选定范围（在时间轴用「入点/出点」设置）" style={{ fontSize: 11, color: ACCENT, border: `1px solid ${ACCENT}`, borderRadius: 6, padding: "3px 7px", whiteSpace: "nowrap" }}>
            仅导出选区
          </span>
        )}
        {/* Export settings (format / quality / resolution) */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setExportMenu((v) => !v)}
            title="导出设置"
            disabled={exporting}
            style={{ ...iconBtn, opacity: exporting ? 0.5 : 1, cursor: exporting ? "default" : "pointer", color: exportMenu ? ACCENT : "var(--c-t2)", borderColor: exportMenu ? ACCENT : "var(--c-bd2)" }}
          ><SlidersHorizontal size={16} /></button>
          {exportMenu && (
            <>
              <div onClick={() => setExportMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <div style={{ position: "absolute", top: 40, right: 0, zIndex: 41, width: 230, padding: 12, borderRadius: 12, background: "var(--c-base)", border: "1px solid var(--c-bd2)", boxShadow: "0 16px 48px oklch(0 0 0 / 0.5)", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-t1)" }}>导出设置</div>
                {([
                  { label: "格式", value: exportFormat, set: (v: string) => setExportFormat(v as typeof exportFormat), opts: [["mp4", "MP4 (H.264)"], ["hevc", "MP4 (H.265/HEVC)"], ["webm", "WebM (VP9)"], ["mov", "MOV (H.264)"]] },
                  { label: "分辨率", value: exportRes, set: (v: string) => setExportRes(v as typeof exportRes), opts: [["source", "原始（画布尺寸）"], ["2160", "2160p (4K)"], ["1080", "1080p"], ["720", "720p"], ["480", "480p"]] },
                ] as const).map((row) => (
                  <label key={row.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--c-t3)" }}>{row.label}</span>
                    <select
                      value={row.value}
                      onChange={(e) => row.set(e.target.value)}
                      style={{ padding: "6px 8px", borderRadius: 8, fontSize: 12, background: "var(--c-elevated)", border: "1px solid var(--c-bd3)", color: "var(--c-t1)", outline: "none" }}
                    >
                      {row.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                ))}
                {/* 质量：百分比精细调节（100%=最清晰文件最大；越低文件越小） */}
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--c-t3)" }}>
                    <span>质量</span>
                    <span style={{ color: "var(--c-t1)", fontWeight: 600 }}>{exportQualityPct}%{exportQualityPct >= 90 ? "（接近无损）" : exportQualityPct >= 70 ? "（高清）" : exportQualityPct >= 45 ? "（标准）" : "（省空间）"}</span>
                  </span>
                  <input type="range" min={20} max={100} step={1} value={exportQualityPct}
                    onChange={(e) => setExportQualityPct(Number(e.target.value))}
                    style={{ width: "100%", accentColor: ACCENT, cursor: "pointer" }} />
                </label>
                {/* 预估文件大小（内容相关，仅供参考） */}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--c-t3)", padding: "2px 1px" }}>
                  <span>预估大小</span>
                  <span style={{ color: "var(--c-t2)" }}>~{formatBytes(estBytes)}</span>
                </div>
                <button onClick={startExport} disabled={exporting} style={{ ...primaryBtn, justifyContent: "center", marginTop: 2 }}>开始导出</button>
              </div>
            </>
          )}
        </div>
        <button
          disabled={exporting}
          onClick={startExport}
          style={{ ...primaryBtn, minWidth: 120, justifyContent: "center", opacity: exporting ? 0.85 : 1, cursor: exporting ? "default" : "pointer" }}
        >
          {exporting ? <><Loader2 size={15} className="animate-spin" /> {exportStage || "导出中"} {exportPct > 0 ? `${exportPct}%` : ""}</> : "导出成片"}
        </button>
      </header>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <MediaBin width={leftW} />
        <Resizer axis="x" onResize={(d) => setLeftW((w) => clampSize(w + d, 180, 480))} />
        <PreviewStage />
        <Resizer axis="x" onResize={(d) => setRightW((w) => clampSize(w - d, 180, 520))} />
        <PropertiesPanel width={rightW} />
      </div>
      <Resizer axis="y" onResize={(d) => setBottomH((h) => clampSize(h - d, 120, 560))} />
      <div style={{ height: bottomH, borderTop: "1px solid var(--c-bd2)", flexShrink: 0, minHeight: 0 }}>
        <Timeline />
      </div>
    </div>
  );
}

// Module-scoped autosave debounce handle (one workspace mounted at a time).
const autosaveTimer: { t?: ReturnType<typeof setTimeout> } = {};

export default function Editor() {
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : null;
  if (id != null && Number.isFinite(id)) return <EditorWorkspace id={id} />;
  return <EditorGallery />;
}

const iconBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32,
  borderRadius: 8, border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t2)", cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8,
  border: "none", background: ACCENT, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const card: React.CSSProperties = {
  background: "var(--c-surface, #14141a)", border: "1px solid var(--c-bd2)", borderRadius: 12, padding: 10, cursor: "pointer",
};
