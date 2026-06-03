import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowLeft, Plus, Film, Trash2, Loader2, Clapperboard, Check, Download } from "lucide-react";
import { useEditorStore } from "@/components/editor/editorStore";
import { MediaBin } from "@/components/editor/MediaBin";
import { Timeline } from "@/components/editor/Timeline";
import { PreviewStage } from "@/components/editor/PreviewStage";
import { PropertiesPanel } from "@/components/editor/PropertiesPanel";
import { CanvasSettings } from "@/components/editor/CanvasSettings";
import { downloadMedia } from "@/lib/download";

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
    <div style={{ minHeight: "100vh", background: "var(--c-bg, #0c0c10)", color: "var(--c-t1)" }}>
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
  const loadedFor = useRef<number | null>(null);

  // ── Export (single-pass render) ──
  const [jobId, setJobId] = useState<string | null>(null);
  const [exportPct, setExportPct] = useState(0);
  const [exportStage, setExportStage] = useState("");
  const [exportUrl, setExportUrl] = useState<string | null>(null);
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

  if (sessionQuery.isLoading || (sessionQuery.data && !doc)) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-bg, #0c0c10)", color: "var(--c-t3)" }}><Loader2 className="animate-spin" /></div>;
  }
  if (sessionQuery.error || !sessionQuery.data) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "var(--c-bg, #0c0c10)", color: "var(--c-t2)" }}>
        <div>剪辑不存在或无权访问。</div>
        <button onClick={() => navigate("/editor")} style={primaryBtn}>返回列表</button>
      </div>
    );
  }
  const session = sessionQuery.data;
  const displayName = name ?? session.name;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--c-bg, #0c0c10)", color: "var(--c-t1)" }}>
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
        <CanvasSettings />
        {exportUrl && (
          <button onClick={() => downloadMedia(exportUrl, `${displayName}.mp4`)} style={{ ...primaryBtn, background: "transparent", color: ACCENT, border: `1px solid ${ACCENT}` }}>
            <Download size={15} /> 下载成片
          </button>
        )}
        <button
          disabled={exporting}
          onClick={() => exportMut.mutate({ id })}
          style={{ ...primaryBtn, minWidth: 120, justifyContent: "center", opacity: exporting ? 0.85 : 1, cursor: exporting ? "default" : "pointer" }}
        >
          {exporting ? <><Loader2 size={15} className="animate-spin" /> {exportStage || "导出中"} {exportPct > 0 ? `${exportPct}%` : ""}</> : "导出成片"}
        </button>
      </header>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <MediaBin />
        <PreviewStage />
        <PropertiesPanel />
      </div>
      <div style={{ height: 230, borderTop: "1px solid var(--c-bd2)", flexShrink: 0 }}>
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
