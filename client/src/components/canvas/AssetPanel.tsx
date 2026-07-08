import { useState, useRef, useCallback, useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import { createPortal } from "react-dom";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { Upload, X, FileImage, FileVideo, FileAudio, File, Trash2, Plus, Loader2, Download, Check, Play, Filter, ChevronDown, ChevronUp, Search } from "lucide-react";
import { ImageLightbox } from "./ImageLightbox";
import { uploadAssetFile, MAX_MB } from "@/lib/assetUpload";
import { confirmDialog } from "@/components/ui/dialogService";
import { downloadMedia } from "@/lib/download";
import { WatermarkedVideo } from "@/components/WatermarkedVideo";

interface Props {
  projectId: number;
  onClose: () => void;
  /** When provided, the header acts as a drag handle for a floating container. */
  onHeaderMouseDown?: (e: React.MouseEvent) => void;
}

type TypeFilter = "image" | "video" | "audio" | "other";
type SourceFilter = "upload" | "generated" | "external";
type SortKey = "new" | "old" | "name" | "size";

export function AssetPanel({ projectId, onClose, onHeaderMouseDown }: Props) {
  const { addNode, updateNodeData } = useCanvasStore();
  const reactFlow = useReactFlow();
  const [uploading, setUploading] = useState(false);
  const [uploadProg, setUploadProg] = useState<{ idx: number; total: number; pct: number } | null>(null); // #R6-4 上传进度
  const [dragOver, setDragOver] = useState(false);
  const [scope, setScope] = useState<"project" | "all">("project");
  // 复选：空集合 = 全部。按类型 / 来源各自多选。
  const [typeFilter, setTypeFilter] = useState<Set<TypeFilter>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<Set<SourceFilter>>(new Set());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("new");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  // Multi-select: set of asset ids. Click an item's body to toggle. Selected
  // items can be batch-added to the canvas, dragged together, or deleted.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 类型/来源为客户端复选过滤，故服务端只按 scope 取数（不传 type/source）。
  const { data: assets, refetch } = trpc.assets.list.useQuery({
    projectId: scope === "all" ? undefined : projectId,
    allProjects: scope === "all",
  }, {
    // Auto-pick up newly generated/uploaded assets while the panel is open
    // (generation completes asynchronously elsewhere on the canvas).
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  });

  // 应用复选过滤（空集合 = 全部）+ 名称搜索（按素材名，忽略大小写）。
  const nameQ = query.trim().toLowerCase();
  const filteredAssets = (assets ?? []).filter((a) =>
    (typeFilter.size === 0 || typeFilter.has(a.type as TypeFilter)) &&
    (sourceFilter.size === 0 || sourceFilter.has((a.source ?? "") as SourceFilter)) &&
    (!nameQ || (a.name ?? "").toLowerCase().includes(nameQ))
  ).sort((a, b) => {
    // 服务端默认按 createdAt 倒序返回；此处客户端排序覆盖之。
    switch (sort) {
      case "old": return (a.createdAt ? +new Date(a.createdAt) : 0) - (b.createdAt ? +new Date(b.createdAt) : 0);
      case "name": return (a.name ?? "").localeCompare(b.name ?? "", "zh");
      case "size": return (b.size ?? 0) - (a.size ?? 0);
      case "new":
      default: return (b.createdAt ? +new Date(b.createdAt) : 0) - (a.createdAt ? +new Date(a.createdAt) : 0);
    }
  });

  // Image URLs (in list order) for the click-to-zoom lightbox.
  const imageUrls = filteredAssets.filter((a) => a.type === "image").map((a) => a.url);

  const utils = trpc.useUtils();
  const deleteMutation = trpc.assets.delete.useMutation({
    onSuccess: () => { toast.success("素材已删除"); refetch(); },
  });
  // #R6-3 批量删除走一次 deleteMany：一条 toast、一次刷新（此前 forEach 单删 → N 条 toast+N 次刷新）。
  const deleteManyMutation = trpc.assets.deleteMany.useMutation({
    onSuccess: (r) => { toast.success(`已删除 ${(r as { count?: number })?.count ?? selected.size} 个素材`); setSelected(new Set()); refetch(); },
    onError: (e) => toast.error("删除失败：" + e.message),
  });

  const importMutation = trpc.assets.importFromUrl.useMutation({
    onSuccess: () => { toast.success("已从链接导入"); refetch(); },
    onError: (err) => toast.error("导入失败：" + err.message),
  });
  const handleImportUrl = () => {
    const url = window.prompt("粘贴文件链接（http/https）导入到素材库")?.trim();
    if (url) importMutation.mutate({ url, projectId });
  };

  // Upload one or many files (multi-select / drag / paste). Each goes through the
  // streamed/presigned direct upload (≤5000MB, no base64 cap). Uploaded
  // sequentially so a big batch doesn't fire dozens of parallel requests.
  const processFiles = useCallback(
    (files: File[]) => {
      const list = files.filter((f) => /^(image|video|audio)\//.test(f.type));
      if (list.length === 0) { if (files.length) toast.error("仅支持图片 / 视频 / 音频"); return; }
      setUploading(true);
      (async () => {
        let ok = 0;
        for (let i = 0; i < list.length; i++) {
          setUploadProg({ idx: i + 1, total: list.length, pct: 0 });
          try { if (await uploadAssetFile(utils.client, list[i], projectId, (pct) => setUploadProg({ idx: i + 1, total: list.length, pct }))) ok++; } catch { /* per-file, keep going */ }
        }
        if (ok > 0) { toast.success(list.length === 1 ? "素材上传成功" : `成功上传 ${ok} / ${list.length} 个素材`); refetch(); }
        else toast.error("上传失败");
      })().finally(() => { setUploading(false); setUploadProg(null); });
    },
    [projectId, utils, refetch]
  );

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

  // Paste-to-upload: while the panel is open, Ctrl/⌘-V pastes clipboard
  // image/video/audio files into the library (skipped when typing in a field).
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

  type Asset = NonNullable<typeof assets>[0];

  // Create a populated `asset` node per item, staggered so a batch fans out.
  const addAssetsToCanvas = (list: Asset[]) => {
    if (list.length === 0) return;
    try {
      // 放在当前视口中心（而非固定世界坐标），批量时斜向错开。
      const c = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      list.forEach((asset, i) => {
        const node = addNode("asset", { x: c.x + i * 28, y: c.y + i * 28 });
        const t = asset.type === "video" || asset.type === "audio" || asset.type === "image" ? asset.type : "other";
        updateNodeData(node.id, {
          url: asset.url, name: asset.name, type: t,
          mimeType: asset.mimeType ?? undefined, size: asset.size ?? undefined,
          storageKey: asset.storageKey ?? undefined,
        }, true);
      });
      toast.success(`已添加 ${list.length} 个素材到画布`);
    } catch (err) {
      toast.error("无法添加节点：" + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleAddToCanvas = (asset: Asset) => addAssetsToCanvas([asset]);

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Build the drag payload. Dragging a selected item carries the whole
  // selection; dragging an unselected item carries just that one.
  const dragPayload = (asset: Asset): string => {
    const pool = selected.has(asset.id) && selected.size > 0
      ? (assets ?? []).filter((a) => selected.has(a.id))
      : [asset];
    return JSON.stringify(pool.map((a) => ({
      url: a.url, name: a.name, type: a.type,
      mimeType: a.mimeType ?? undefined, size: a.size ?? undefined, storageKey: a.storageKey ?? undefined,
    })));
  };

  const selectedAssets = (assets ?? []).filter((a) => selected.has(a.id));

  // 全选/取消全选：作用于当前过滤后的可见素材。
  const allFilteredSelected = filteredAssets.length > 0 && filteredAssets.every((a) => selected.has(a.id));
  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredAssets.forEach((a) => next.delete(a.id));
      else filteredAssets.forEach((a) => next.add(a.id));
      return next;
    });
  };

  // 批量下载：逐个触发下载（间隔以免浏览器拦截连续下载）。
  const [batchDownloading, setBatchDownloading] = useState(false);
  const downloadSelected = async () => {
    if (batchDownloading) return;
    setBatchDownloading(true);
    try {
      for (const a of selectedAssets) {
        await downloadMedia(a.url, a.name, a.type === "video" ? "video" : "image", a.id);
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      setBatchDownloading(false);
    }
  };

  const getIcon = (type: string) => {
    if (type === "video") return FileVideo;
    if (type === "audio") return FileAudio;
    if (type === "image") return FileImage;
    return File;
  };

  const getAccent = (type: string) => {
    if (type === "video") return "oklch(0.62 0.20 25)";
    if (type === "audio") return "oklch(0.68 0.22 285)";
    if (type === "image") return "oklch(0.65 0.18 60)";
    return "var(--c-t3)";
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "var(--c-base)", borderLeft: "1px solid var(--c-bd1)" }}
    >
      {/* ── Header (drag handle when floating) ── */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--c-elevated)", cursor: onHeaderMouseDown ? "move" : undefined, userSelect: "none" }}
        onMouseDown={onHeaderMouseDown}
      >
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--c-t1)" }}>素材库</h3>
          <p className="text-[10px] mt-0.5 flex items-center gap-2" style={{ color: "var(--c-t4)" }}>
            <span>{filteredAssets.length} 个素材{(typeFilter.size || sourceFilter.size || nameQ) ? ` / 共 ${assets?.length ?? 0}` : ""}</span>
            {filteredAssets.length > 0 && (
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={toggleSelectAll}
                style={{ fontSize: 10, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--c-accent, oklch(0.68 0.18 285))" }}
              >
                {allFilteredSelected ? "取消全选" : "全选"}
              </button>
            )}
          </p>
        </div>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
          style={{ color: "var(--c-t4)", background: "transparent" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; (e.currentTarget as HTMLElement).style.color = "var(--c-t2)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Upload zone (compact single row) ── */}
      <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-elevated)" }}>
        <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" multiple onChange={handleFileSelect} className="hidden" />
        <div className="flex items-center gap-1.5">
          <div
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            title={`点击、拖拽或粘贴上传（可多选）· 图片 / 视频 / 音频 · 最大 ${MAX_MB}MB`}
            className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 px-2 cursor-pointer transition-all flex-1 min-w-0"
            style={{
              border: `1.5px dashed ${dragOver ? "oklch(0.65 0.18 60 / 0.6)" : "var(--c-bd2)"}`,
              background: dragOver ? "oklch(0.65 0.18 60 / 0.06)" : "var(--c-input)",
            }}
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" style={{ color: "oklch(0.65 0.18 60)" }} />
            ) : (
              <Upload className="w-3.5 h-3.5 flex-shrink-0" style={{ color: dragOver ? "oklch(0.65 0.18 60)" : "var(--c-t4)" }} />
            )}
            <span className="text-[11px] font-medium truncate" style={{ color: uploading ? "oklch(0.65 0.18 60)" : "var(--c-t3)" }}>
              {uploading
                ? (uploadProg ? `上传中 ${uploadProg.total > 1 ? `${uploadProg.idx}/${uploadProg.total} · ` : ""}${uploadProg.pct}%` : "上传中...")
                : "点击 / 拖拽 / 粘贴上传"}
            </span>
            {uploading && uploadProg && (
              <span className="flex-shrink-0" style={{ width: 44, height: 4, borderRadius: 2, background: "var(--c-bd1)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${uploadProg.pct}%`, background: "oklch(0.65 0.18 60)", borderRadius: 2, transition: "width 120ms" }} />
              </span>
            )}
          </div>
          <button
            onClick={handleImportUrl}
            disabled={importMutation.isPending}
            title="从链接导入"
            className="text-[11px] py-1.5 px-2.5 rounded-lg transition-all flex-shrink-0 whitespace-nowrap"
            style={{ border: "1px dashed var(--c-bd2)", background: "transparent", color: "var(--c-t3)", cursor: "pointer" }}
          >
            {importMutation.isPending ? "导入中…" : "＋ 链接"}
          </button>
        </div>
      </div>

      {/* ── Filters (collapsible — collapsed by default to save space) ── */}
      <div className="px-3 py-1.5 flex flex-col gap-1.5 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-elevated)" }}>
        {/* Name search (always visible) */}
        <div className="flex items-center gap-1.5" style={{ padding: "3px 8px", borderRadius: 7, background: "var(--c-input)", border: "1px solid var(--c-bd2)" }}>
          <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--c-t4)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="搜索素材名称"
            className="flex-1 min-w-0"
            style={{ fontSize: 11, background: "transparent", border: "none", color: "var(--c-t1)", outline: "none" }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{ background: "none", border: "none", color: "var(--c-t4)", cursor: "pointer", padding: 0, flexShrink: 0, display: "flex" }} title="清除">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {(() => {
          const chip = (active: boolean): React.CSSProperties => ({
            fontSize: 10, padding: "2px 8px", borderRadius: 999, cursor: "pointer",
            border: `1px solid ${active ? "var(--c-accent, oklch(0.65 0.18 285))" : "var(--c-bd2)"}`,
            background: active ? "oklch(0.65 0.18 285 / 0.12)" : "transparent",
            color: active ? "oklch(0.72 0.16 285)" : "var(--c-t3)",
          });
          const TYPE_LABEL: Record<TypeFilter, string> = { image: "图片", video: "视频", audio: "音频", other: "其他" };
          const SRC_LABEL: Record<SourceFilter, string> = { upload: "上传", generated: "生成", external: "外部" };
          const typeLabel = typeFilter.size === 0 ? "全部" : Array.from(typeFilter).map((v) => TYPE_LABEL[v]).join("/");
          const srcLabel = sourceFilter.size === 0 ? "全来源" : Array.from(sourceFilter).map((v) => SRC_LABEL[v]).join("/");
          const SORT_LABEL: Record<SortKey, string> = { new: "最新", old: "最早", name: "名称", size: "大小" };
          const summary = `${scope === "all" ? "全部项目" : "本项目"} · ${typeLabel} · ${srcLabel} · ${SORT_LABEL[sort]}`;
          const toggle = <T,>(set: Set<T>, setter: (s: Set<T>) => void, v: T) => {
            const n = new Set(set);
            n.has(v) ? n.delete(v) : n.add(v);
            setter(n);
          };
          return (
            <>
              <button
                onClick={() => setFiltersOpen((v) => !v)}
                className="flex items-center justify-between w-full"
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-t3)", fontSize: 11, padding: "1px 0" }}
              >
                <span className="truncate" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Filter className="w-3 h-3" style={{ flexShrink: 0 }} />
                  <span className="truncate">{summary}</span>
                </span>
                {filtersOpen ? <ChevronUp className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />}
              </button>
              {filtersOpen && (
                <div className="flex flex-col gap-1.5 pt-0.5">
                  <div className="flex items-center gap-1">
                    <button style={chip(scope === "project")} onClick={() => setScope("project")}>本项目</button>
                    <button style={chip(scope === "all")} onClick={() => setScope("all")}>全部项目</button>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <button style={chip(typeFilter.size === 0)} onClick={() => setTypeFilter(new Set())}>全部</button>
                    {([["image", "图片"], ["video", "视频"], ["audio", "音频"], ["other", "其他"]] as [TypeFilter, string][]).map(([v, l]) => (
                      <button key={v} style={chip(typeFilter.has(v))} onClick={() => toggle(typeFilter, setTypeFilter, v)}>{l}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <button style={chip(sourceFilter.size === 0)} onClick={() => setSourceFilter(new Set())}>全来源</button>
                    {([["upload", "上传"], ["generated", "生成"], ["external", "外部"]] as [SourceFilter, string][]).map(([v, l]) => (
                      <button key={v} style={chip(sourceFilter.has(v))} onClick={() => toggle(sourceFilter, setSourceFilter, v)}>{l}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span style={{ fontSize: 10, color: "var(--c-t4)", marginRight: 2 }}>排序</span>
                    {([["new", "最新"], ["old", "最早"], ["name", "名称"], ["size", "大小"]] as [SortKey, string][]).map(([v, l]) => (
                      <button key={v} style={chip(sort === v)} onClick={() => setSort(v)}>{l}</button>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* ── Asset list ── */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)" }}
            >
              <FileImage className="w-6 h-6" style={{ color: "var(--c-bd3)" }} />
            </div>
            <p className="text-xs text-center" style={{ color: "var(--c-t4)" }}>
              {(typeFilter.size || sourceFilter.size || nameQ) ? "没有符合条件的素材" : "暂无素材"}<br />
              <span style={{ color: "var(--c-bd3)", fontSize: 10 }}>{nameQ ? `无名称含「${query.trim()}」的素材` : (typeFilter.size || sourceFilter.size) ? "试试调整筛选条件" : "上传后将在此显示"}</span>
            </p>
          </div>
        ) : (
          // Auto multi-column thumbnail grid — adapts to panel width; file names
          // are hidden (shown on hover + as title) to stay compact.
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 6 }}>
            {filteredAssets.map((asset) => {
              const Icon = getIcon(asset.type);
              const accent = getAccent(asset.type);
              const isSel = selected.has(asset.id);
              return (
                <div
                  key={asset.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-asset-list", dragPayload(asset));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  className="group relative rounded-lg overflow-hidden transition-all"
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    aspectRatio: "1 / 1",
                    background: `${accent}10`,
                    border: isSel ? "1.5px solid oklch(0.65 0.18 285)" : "1px solid var(--c-bd1)",
                    cursor: (asset.type === "image" || asset.type === "video") ? "zoom-in" : "grab",
                  }}
                  title={asset.name}
                  onClick={() => {
                    if (selected.size > 0) { toggleSelect(asset.id); return; } // selecting mode → toggle
                    if (asset.type === "image") { const i = imageUrls.indexOf(asset.url); if (i >= 0) setLightboxIdx(i); }
                    else if (asset.type === "video") setVideoPreview(asset.url);
                  }}
                >
                  {/* Thumbnail fill */}
                  {asset.type === "image" ? (
                    <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" draggable={false} />
                  ) : asset.type === "video" ? (
                    <>
                      <video src={asset.url} muted preload="metadata" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <Play className="w-4 h-4 text-white" fill="white" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))" }} />
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Icon className="w-6 h-6" style={{ color: accent }} /></div>
                  )}

                  {/* Selection checkbox (top-left; visible on hover / when selecting) */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSelect(asset.id); }}
                    title={isSel ? "取消选择" : "选择"}
                    className={`absolute top-1 left-1 z-10 w-4 h-4 rounded flex items-center justify-center transition-opacity ${isSel || selected.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                    style={{ border: `1.5px solid ${isSel ? "oklch(0.65 0.18 285)" : "oklch(1 0 0 / 0.6)"}`, background: isSel ? "oklch(0.65 0.18 285)" : "oklch(0 0 0 / 0.55)" }}
                  >
                    {isSel && <Check className="w-3 h-3" style={{ color: "white" }} />}
                  </button>

                  {/* Hover overlay: name (bottom) + actions (top-right) */}
                  <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    style={{ background: "linear-gradient(to top, oklch(0 0 0 / 0.75), transparent)" }}>
                    <p className="text-[9.5px] leading-tight truncate text-white">{asset.name}</p>
                  </div>
                  <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button title="下载" className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "oklch(0 0 0 / 0.55)", color: "white" }}
                      onClick={(e) => { e.stopPropagation(); void downloadMedia(asset.url, asset.name, asset.type === "video" ? "video" : "image", asset.id); }}>
                      <Download className="w-3 h-3" />
                    </button>
                    <button title="添加到画布" className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "oklch(0 0 0 / 0.55)", color: "white" }}
                      onClick={(e) => { e.stopPropagation(); handleAddToCanvas(asset); }}>
                      <Plus className="w-3 h-3" />
                    </button>
                    <button title="删除" className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "oklch(0 0 0 / 0.55)", color: "oklch(0.78 0.16 25)" }}
                      onClick={(e) => { e.stopPropagation(); if (confirm("确认删除此素材？")) deleteMutation.mutate({ id: asset.id }); }}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Selection action bar ── */}
      {selected.size > 0 && (
        <div
          className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
          style={{ borderTop: "1px solid var(--c-elevated)", background: "var(--c-base)" }}
        >
          <span className="text-[11px] flex-1" style={{ color: "var(--c-t3)" }}>已选 {selected.size} 项</span>
          <button
            onClick={() => { addAssetsToCanvas(selectedAssets); }}
            className="text-[11px] px-2 py-1 rounded-md transition-all"
            style={{ border: "1px solid oklch(0.72 0.18 155 / 0.4)", background: "oklch(0.72 0.18 155 / 0.12)", color: "oklch(0.72 0.18 155)", cursor: "pointer" }}
          >
            添加到画布
          </button>
          <button
            onClick={() => { void downloadSelected(); }}
            disabled={batchDownloading}
            title="逐个下载选中素材"
            className="text-[11px] px-2 py-1 rounded-md transition-all flex items-center gap-1"
            style={{ border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t3)", cursor: batchDownloading ? "default" : "pointer" }}
          >
            {batchDownloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            下载
          </button>
          <button
            disabled={deleteManyMutation.isPending}
            onClick={async () => {
              if (await confirmDialog({ title: `删除选中的 ${selected.size} 个素材？`, message: "删除后将从素材库移除。", danger: true })) {
                deleteManyMutation.mutate({ ids: selectedAssets.map((a) => a.id) });
              }
            }}
            className="text-[11px] px-2 py-1 rounded-md transition-all"
            style={{ border: "1px solid oklch(0.62 0.20 25 / 0.4)", background: "oklch(0.62 0.20 25 / 0.12)", color: "oklch(0.62 0.20 25)", cursor: "pointer" }}
          >
            删除
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-[11px] px-2 py-1 rounded-md transition-all"
            style={{ border: "1px solid var(--c-bd2)", background: "transparent", color: "var(--c-t3)", cursor: "pointer" }}
          >
            取消
          </button>
        </div>
      )}

      {/* Click-to-zoom preview (plain viewer — no select action) */}
      {lightboxIdx !== null && imageUrls[lightboxIdx] && (
        <ImageLightbox
          images={imageUrls}
          currentIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onNavigate={setLightboxIdx}
        />
      )}

      {/* Video preview overlay — portalled to <body> so it escapes the floating
          panel's backdrop-filter containing block (which would otherwise clip a
          plain fixed overlay to the panel box and play it "inside" the library,
          exactly like ImageLightbox does for images). */}
      {videoPreview && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
          style={{ background: "oklch(0 0 0 / 0.8)", backdropFilter: "blur(8px)" }}
          onClick={() => setVideoPreview(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="relative" style={{ maxWidth: "90vw", maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
            <WatermarkedVideo src={videoPreview} controls autoPlay controlsList="nodownload" style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: 10, background: "#000" }} />
            <button
              onClick={() => setVideoPreview(null)}
              className="absolute flex items-center justify-center"
              style={{ top: -10, right: -10, width: 30, height: 30, borderRadius: "50%", background: "var(--c-elevated, #1a1a20)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", cursor: "pointer" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
