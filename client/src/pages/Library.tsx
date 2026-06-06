import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { uploadAssetFile } from "@/lib/assetUpload";
import { downloadMedia } from "@/lib/download";
import { WatermarkedVideo } from "@/components/WatermarkedVideo";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  ArrowLeft,
  Upload,
  Link2,
  Search,
  FileImage,
  FileVideo,
  FileAudio,
  File as FileIcon,
  Trash2,
  Download,
  Loader2,
  X,
  Boxes,
  Play,
  Check,
  CheckSquare,
  Square,
  Clapperboard,
} from "lucide-react";

type TypeFilter = "" | "image" | "video" | "audio" | "other";
type SourceFilter = "" | "upload" | "generated" | "external";

type Asset = {
  id: number;
  name: string;
  type: string;
  url: string;
  source: string | null;
  provider: string | null;
  model: string | null;
  size: number | null;
  projectId: number | null;
  createdAt: Date | string;
};

const ACCENT = "oklch(0.65 0.18 60)"; // 素材库主色（琥珀金）

function iconFor(type: string) {
  if (type === "video") return FileVideo;
  if (type === "audio") return FileAudio;
  if (type === "image") return FileImage;
  return FileIcon;
}
function accentFor(type: string) {
  if (type === "video") return "oklch(0.62 0.20 25)";
  if (type === "audio") return "oklch(0.68 0.22 285)";
  if (type === "image") return "oklch(0.65 0.18 60)";
  return "var(--c-t3)";
}
function fmtSize(n?: number | null) {
  if (!n) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function sourceLabel(a: Asset) {
  if (a.source === "generated") return `生成${a.provider ? "·" + a.provider : ""}`;
  if (a.source === "external") return "外部";
  return "上传";
}

// ── Lightbox preview ────────────────────────────────────────────────────────
function Lightbox({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-fade-in"
      style={{ background: "oklch(0 0 0 / 0.8)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl w-full max-h-[88vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: "var(--c-elevated)", border: "1px solid var(--c-bd2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--c-bd1)" }}>
          <span className="text-sm font-medium truncate" style={{ color: "var(--c-t1)" }}>{asset.name}</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void downloadMedia(asset.url, asset.name, asset.type === "video" ? "video" : "image", asset.id)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs"
              style={{ color: "var(--c-t2)", border: "1px solid var(--c-bd2)", background: "transparent", cursor: "pointer" }}
            >
              <Download className="w-3.5 h-3.5" /> 下载
            </button>
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: "var(--c-t3)" }}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center overflow-auto p-4" style={{ background: "var(--c-base)" }} onContextMenu={(e) => e.preventDefault()}>
          {asset.type === "image" ? (
            <img src={asset.url} alt={asset.name} className="max-w-full max-h-[72vh] object-contain" />
          ) : asset.type === "video" ? (
            <WatermarkedVideo src={asset.url} controls autoPlay controlsList="nodownload" className="max-w-full max-h-[72vh]" />
          ) : asset.type === "audio" ? (
            <audio src={asset.url} controls autoPlay controlsList="nodownload" className="w-full" />
          ) : (
            <div className="text-sm" style={{ color: "var(--c-t3)" }}>该文件类型无法预览，请下载查看</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Asset grid card ─────────────────────────────────────────────────────────
function AssetCard({
  asset, onPreview, onDelete, selected, selecting, onToggleSelect,
}: {
  asset: Asset; onPreview: () => void; onDelete: () => void;
  selected: boolean; selecting: boolean; onToggleSelect: (e: React.MouseEvent) => void;
}) {
  const Icon = iconFor(asset.type);
  const accent = accentFor(asset.type);
  // While selecting, a click anywhere on the card toggles selection instead of
  // opening the preview (matches the canvas asset-strip multi-select behavior).
  const handlePreviewClick = (e: React.MouseEvent) => {
    if (selecting) { onToggleSelect(e); return; }
    onPreview();
  };
  return (
    <div
      className="group relative flex flex-col rounded-xl overflow-hidden transition-all duration-200"
      style={{ background: "var(--c-surface)", border: `1px solid ${selected ? accent : "var(--c-bd1)"}`, boxShadow: selected ? `0 0 0 1px ${accent}` : "none" }}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.borderColor = `${accent}55`; }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd1)"; }}
    >
      {/* Selection checkbox — always visible while selecting or when checked */}
      <button
        onClick={onToggleSelect}
        title={selected ? "取消选择" : "选择"}
        className="absolute top-2 left-2 z-10 w-5 h-5 rounded-md flex items-center justify-center transition-opacity"
        style={{
          background: selected ? accent : "oklch(0 0 0 / 0.55)",
          color: "white",
          opacity: selecting || selected ? 1 : 0,
          border: selected ? "none" : "1px solid oklch(1 0 0 / 0.5)",
        }}
        onMouseEnter={(e) => { if (!selecting && !selected) (e.currentTarget as HTMLElement).style.opacity = "1"; }}
      >
        {selected && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
      </button>

      {/* Preview */}
      <div
        className="relative h-32 flex items-center justify-center cursor-pointer overflow-hidden"
        style={{ background: `${accent}0c` }}
        onClick={handlePreviewClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {asset.type === "image" ? (
          <img
            src={asset.url} alt={asset.name} loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
          />
        ) : asset.type === "video" ? (
          <>
            <video src={asset.url} muted preload="metadata" className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "oklch(0 0 0 / 0.5)" }}>
                <Play className="w-4 h-4 text-white" fill="white" />
              </div>
            </div>
          </>
        ) : (
          <Icon className="w-8 h-8" style={{ color: accent }} />
        )}
        {/* Type badge — bottom-left to leave the top-left corner for the checkbox */}
        <span
          className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-semibold"
          style={{ background: "oklch(0 0 0 / 0.5)", color: "white" }}
        >
          {asset.type}
        </span>
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1 p-2.5">
        <p className="text-xs font-medium truncate" style={{ color: "var(--c-t2)" }} title={asset.name}>{asset.name}</p>
        <p className="text-[10px] truncate" style={{ color: "var(--c-t4)" }}>
          {sourceLabel(asset)}{asset.model ? ` · ${asset.model}` : ""} · {fmtSize(asset.size)}
        </p>
      </div>

      {/* Actions */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          title="下载"
          onClick={(e) => { e.stopPropagation(); void downloadMedia(asset.url, asset.name, asset.type === "video" ? "video" : "image", asset.id); }}
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: "oklch(0 0 0 / 0.55)", color: "white", border: "none", cursor: "pointer" }}
        >
          <Download className="w-3.5 h-3.5" />
        </button>
        <button
          title="删除" onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: "oklch(0 0 0 / 0.55)", color: "oklch(0.72 0.16 25)" }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function Library() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("");
  const [projectFilter, setProjectFilter] = useState<number | "all">("all");
  const [searchRaw, setSearchRaw] = useState("");
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<Asset | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce search input → server query.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw.trim()), 300);
    return () => clearTimeout(t);
  }, [searchRaw]);

  const { data: projects } = trpc.projects.list.useQuery(undefined, { enabled: isAuthenticated });
  const projectName = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of projects?.owned ?? []) m.set(p.id, p.name);
    for (const p of projects?.shared ?? []) m.set(p.id, p.name);
    return m;
  }, [projects]);

  const { data: assets, refetch, isFetching } = trpc.assets.list.useQuery(
    {
      allProjects: projectFilter === "all",
      projectId: projectFilter === "all" ? undefined : projectFilter,
      type: typeFilter || undefined,
      source: sourceFilter || undefined,
      q: search || undefined,
    },
    { enabled: isAuthenticated },
  );

  const list = (assets ?? []) as Asset[];

  // Count by type for the header stats (reflects current filter scope only when
  // unfiltered — we count the returned set, which is the simplest honest number).
  const counts = useMemo(() => {
    const c = { image: 0, video: 0, audio: 0, other: 0 };
    for (const a of list) {
      if (a.type === "image" || a.type === "video" || a.type === "audio") c[a.type]++;
      else c.other++;
    }
    return c;
  }, [list]);

  const utils = trpc.useUtils();
  const deleteMutation = trpc.assets.delete.useMutation({
    onSuccess: () => { toast.success("素材已删除"); refetch(); },
    onError: (err) => toast.error("删除失败：" + err.message),
  });
  const deleteManyMutation = trpc.assets.deleteMany.useMutation({
    onSuccess: (r) => { toast.success(`已删除 ${r.count} 个素材`); setSelected(new Set()); refetch(); },
    onError: (err) => toast.error("批量删除失败：" + err.message),
  });
  const importMutation = trpc.assets.importFromUrl.useMutation({
    onSuccess: () => { toast.success("已从链接导入"); refetch(); },
    onError: (err) => toast.error("导入失败：" + err.message),
  });

  // 多文件上传（多选 / 拖拽 / 粘贴）。用户仓库上传不绑定具体项目（projectId 省略），
  // 归入个人专有仓库；走流式/预签名直传，支持大文件、无 base64 限制；逐个上传避免并发风暴。
  const processFiles = useCallback((files: File[]) => {
    const list = files.filter((f) => /^(image|video|audio)\//.test(f.type));
    if (list.length === 0) { if (files.length) toast.error("仅支持图片 / 视频 / 音频"); return; }
    setUploading(true);
    (async () => {
      let ok = 0;
      for (const f of list) {
        try { if (await uploadAssetFile(utils.client, f)) ok++; } catch { /* per-file, keep going */ }
      }
      if (ok > 0) { toast.success(list.length === 1 ? "素材上传成功" : `成功上传 ${ok} / ${list.length} 个素材`); refetch(); }
      else toast.error("上传失败");
    })().finally(() => setUploading(false));
  }, [utils, refetch]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) processFiles(files);
    e.target.value = "";
  }, [processFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) processFiles(files);
  }, [processFiles]);

  // 粘贴上传：在仓库页 Ctrl/⌘-V 把剪贴板中的图片/视频/音频文件批量上传（输入框内不触发）。
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) { e.preventDefault(); processFiles(files); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [processFiles]);

  const handleImportUrl = () => {
    const url = window.prompt("粘贴文件链接（http/https）导入到用户仓库")?.trim();
    if (url) importMutation.mutate({ url });
  };

  // ── Multi-select ──
  const selecting = selected.size > 0;
  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const allVisibleSelected = list.length > 0 && list.every((a) => selected.has(a.id));
  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (list.every((a) => prev.has(a.id))) {
        // deselect the currently-visible ones, keep any off-screen selections
        const next = new Set(prev);
        for (const a of list) next.delete(a.id);
        return next;
      }
      const next = new Set(prev);
      for (const a of list) next.add(a.id);
      return next;
    });
  };
  const handleBulkDelete = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`确认删除选中的 ${ids.length} 个素材？`)) return;
    deleteManyMutation.mutate({ ids });
  };
  const handleBulkDownload = () => {
    const byId = new Map(list.map((a) => [a.id, a]));
    for (const id of Array.from(selected)) {
      const a = byId.get(id);
      if (!a) continue;
      void downloadMedia(a.url, a.name, a.type === "video" ? "video" : "image", a.id);
    }
  };

  // ── Auth gate ── (redirect as an effect, not during render, to keep render pure)
  useEffect(() => {
    if (!loading && !isAuthenticated) window.location.href = getLoginUrl();
  }, [loading, isAuthenticated]);
  if (!loading && !isAuthenticated) return null;

  const chip = (active: boolean): React.CSSProperties => ({
    fontSize: 11, padding: "4px 11px", borderRadius: 999, cursor: "pointer", transition: "all .15s",
    border: `1px solid ${active ? ACCENT : "var(--c-bd2)"}`,
    background: active ? `${ACCENT.replace(")", " / 0.14)")}` : "transparent",
    color: active ? "oklch(0.78 0.15 60)" : "var(--c-t3)",
  });

  return (
    <div className="relative h-screen flex flex-col overflow-hidden" style={{ background: "var(--c-canvas, var(--c-base))" }}>
      {/* Nav */}
      <nav
        className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 border-b"
        style={{ background: "color-mix(in oklch, var(--c-base) 92%, transparent)", backdropFilter: "blur(20px)", borderColor: "var(--c-bd1)" }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ color: "var(--c-t2)", border: "1px solid var(--c-bd2)" }}
            onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--c-t1)"; el.style.background = "var(--c-overlay)"; }}
            onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--c-t2)"; el.style.background = "transparent"; }}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> 返回项目
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${ACCENT.replace(")", " / 0.15)")}`, border: `1px solid ${ACCENT.replace(")", " / 0.3)")}` }}>
              <Boxes className="w-4 h-4" style={{ color: ACCENT }} />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight" style={{ color: "var(--c-t1)" }}>素材库</h1>
              <p className="text-[10px]" style={{ color: "var(--c-t4)" }}>个人专有仓库 · 跨项目素材</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/editor")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ color: "oklch(0.65 0.19 310)", border: "1px solid oklch(0.65 0.19 310 / 0.4)" }}
            title="进入视频剪辑器，把素材拖到时间轴剪辑"
          >
            <Clapperboard className="w-3.5 h-3.5" /> 视频剪辑器
          </button>
          <button
            onClick={handleImportUrl}
            disabled={importMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ color: "var(--c-t2)", border: "1px solid var(--c-bd2)" }}
          >
            <Link2 className="w-3.5 h-3.5" /> {importMutation.isPending ? "导入中…" : "从链接导入"}
          </button>
          <button
            onClick={() => !uploading && fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, oklch(0.6 0.18 40))`, opacity: uploading ? 0.6 : 1 }}
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {uploading ? "上传中…" : "上传素材"}
          </button>
        </div>
      </nav>

      <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" multiple onChange={handleFileSelect} className="hidden" />

      {/* Body */}
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-6xl mx-auto flex flex-col gap-5">
          {/* Stats + drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className="rounded-xl p-4 flex items-center justify-between flex-wrap gap-3 transition-all"
            style={{
              border: `1.5px dashed ${dragOver ? ACCENT : "var(--c-bd1)"}`,
              background: dragOver ? `${ACCENT.replace(")", " / 0.06)")}` : "var(--c-surface)",
            }}
          >
            <div className="flex items-center gap-5 flex-wrap">
              {([["全部", list.length], ["图片", counts.image], ["视频", counts.video], ["音频", counts.audio], ["其他", counts.other]] as [string, number][]).map(([l, n]) => (
                <div key={l} className="flex flex-col">
                  <span className="text-lg font-bold leading-none" style={{ color: "oklch(0.78 0.15 60)" }}>{n}</span>
                  <span className="text-[10px] mt-1" style={{ color: "var(--c-t4)" }}>{l}</span>
                </div>
              ))}
            </div>
            <p className="text-xs" style={{ color: "var(--c-t4)" }}>
              <Upload className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
              多选 / 拖拽 / 粘贴（Ctrl·⌘V）批量上传（图片 / 视频 / 音频 · 最大 500MB）
            </p>
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-2.5">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "var(--c-t4)" }} />
              <input
                value={searchRaw}
                onChange={(e) => setSearchRaw(e.target.value)}
                placeholder="按名称搜索（项目名_模型）"
                className="w-full rounded-lg pl-9 pr-3 py-2 text-xs outline-none"
                style={{ background: "var(--c-input, var(--c-surface))", border: "1px solid var(--c-bd2)", color: "var(--c-t1)" }}
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {([["", "全部类型"], ["image", "图片"], ["video", "视频"], ["audio", "音频"], ["other", "其他"]] as [TypeFilter, string][]).map(([v, l]) => (
                <button key={v} style={chip(typeFilter === v)} onClick={() => setTypeFilter(v)}>{l}</button>
              ))}
              <span className="w-px h-4 mx-1" style={{ background: "var(--c-bd2)" }} />
              {([["", "全部来源"], ["upload", "上传"], ["generated", "生成"], ["external", "外部"]] as [SourceFilter, string][]).map(([v, l]) => (
                <button key={v} style={chip(sourceFilter === v)} onClick={() => setSourceFilter(v)}>{l}</button>
              ))}
              {(projects?.owned?.length || projects?.shared?.length) ? (
                <>
                  <span className="w-px h-4 mx-1" style={{ background: "var(--c-bd2)" }} />
                  <select
                    value={projectFilter === "all" ? "all" : String(projectFilter)}
                    onChange={(e) => setProjectFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                    className="text-[11px] rounded-full px-2.5 py-[5px] outline-none cursor-pointer"
                    style={{ background: "transparent", border: "1px solid var(--c-bd2)", color: "var(--c-t3)" }}
                  >
                    <option value="all">全部项目</option>
                    {[...(projects?.owned ?? []), ...(projects?.shared ?? [])].map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </>
              ) : null}
            </div>
          </div>

          {/* Selection toolbar */}
          {list.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <button
                onClick={toggleSelectAll}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ color: "var(--c-t2)", border: "1px solid var(--c-bd2)" }}
              >
                {allVisibleSelected ? <CheckSquare className="w-3.5 h-3.5" style={{ color: ACCENT }} /> : <Square className="w-3.5 h-3.5" />}
                {allVisibleSelected ? "取消全选" : "全选"}
                {selecting && <span style={{ color: "oklch(0.78 0.15 60)" }}>· 已选 {selected.size}</span>}
              </button>
              {selecting && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleBulkDownload}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{ color: "var(--c-t2)", border: "1px solid var(--c-bd2)" }}
                  >
                    <Download className="w-3.5 h-3.5" /> 下载
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    disabled={deleteManyMutation.isPending}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{ color: "oklch(0.78 0.16 25)", border: "1px solid oklch(0.6 0.16 25 / 0.4)" }}
                  >
                    {deleteManyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} 删除
                  </button>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{ color: "var(--c-t3)", border: "1px solid var(--c-bd2)" }}
                  >
                    <X className="w-3.5 h-3.5" /> 取消
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Grid */}
          {isFetching && list.length === 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="rounded-xl h-[180px] animate-pulse" style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)" }} />
              ))}
            </div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: `${ACCENT.replace(")", " / 0.1)")}`, border: `1px solid ${ACCENT.replace(")", " / 0.25)")}` }}>
                <Boxes className="w-7 h-7" style={{ color: ACCENT }} />
              </div>
              <h3 className="text-base font-semibold mb-1.5" style={{ color: "var(--c-t2)" }}>
                {search || typeFilter || sourceFilter || projectFilter !== "all" ? "没有符合条件的素材" : "仓库还是空的"}
              </h3>
              <p className="text-sm mb-6" style={{ color: "var(--c-t4)" }}>
                {search || typeFilter || sourceFilter || projectFilter !== "all" ? "换个筛选条件试试" : "上传文件或从链接导入，开始建立你的素材仓库"}
              </p>
              {!(search || typeFilter || sourceFilter || projectFilter !== "all") && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white"
                  style={{ background: `linear-gradient(135deg, ${ACCENT}, oklch(0.6 0.18 40))` }}
                >
                  <Upload className="w-4 h-4" /> 上传第一个素材
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pb-10">
              {list.map((a) => (
                <div key={a.id} className="flex flex-col gap-1">
                  <AssetCard
                    asset={a}
                    onPreview={() => setPreview(a)}
                    onDelete={() => { if (confirm("确认删除此素材？")) deleteMutation.mutate({ id: a.id }); }}
                    selected={selected.has(a.id)}
                    selecting={selecting}
                    onToggleSelect={(e) => { e.stopPropagation(); toggleSelect(a.id); }}
                  />
                  {a.projectId != null && projectName.has(a.projectId) && (
                    <span className="text-[9.5px] px-1 truncate" style={{ color: "var(--c-t4)" }} title={projectName.get(a.projectId)}>
                      {projectName.get(a.projectId)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {preview && <Lightbox asset={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
