import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { Upload, X, FileImage, FileVideo, FileAudio, File, Trash2, Plus, Loader2, Download, Check, Play, Filter, ChevronDown, ChevronUp } from "lucide-react";
import { ImageLightbox } from "./ImageLightbox";
import { uploadAssetFile } from "@/lib/assetUpload";
import { downloadMedia } from "@/lib/download";

interface Props {
  projectId: number;
  onClose: () => void;
  /** When provided, the header acts as a drag handle for a floating container. */
  onHeaderMouseDown?: (e: React.MouseEvent) => void;
}

type TypeFilter = "" | "image" | "video" | "audio" | "other";
type SourceFilter = "" | "upload" | "generated" | "external";

export function AssetPanel({ projectId, onClose, onHeaderMouseDown }: Props) {
  const { addNode, updateNodeData } = useCanvasStore();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [scope, setScope] = useState<"project" | "all">("project");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  // Multi-select: set of asset ids. Click an item's body to toggle. Selected
  // items can be batch-added to the canvas, dragged together, or deleted.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: assets, refetch } = trpc.assets.list.useQuery({
    projectId: scope === "all" ? undefined : projectId,
    allProjects: scope === "all",
    type: typeFilter || undefined,
    source: sourceFilter || undefined,
  }, {
    // Auto-pick up newly generated/uploaded assets while the panel is open
    // (generation completes asynchronously elsewhere on the canvas).
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  });

  // Image URLs (in list order) for the click-to-zoom lightbox.
  const imageUrls = (assets ?? []).filter((a) => a.type === "image").map((a) => a.url);

  const utils = trpc.useUtils();
  const deleteMutation = trpc.assets.delete.useMutation({
    onSuccess: () => { toast.success("素材已删除"); refetch(); },
  });

  const importMutation = trpc.assets.importFromUrl.useMutation({
    onSuccess: () => { toast.success("已从链接导入"); refetch(); },
    onError: (err) => toast.error("导入失败：" + err.message),
  });
  const handleImportUrl = () => {
    const url = window.prompt("粘贴文件链接（http/https）导入到素材库")?.trim();
    if (url) importMutation.mutate({ url, projectId });
  };

  const processFile = useCallback(
    (file: File) => {
      setUploading(true);
      // 流式/预签名直传，支持大文件（最大 500MB），无 base64 ~15MB 限制。
      uploadAssetFile(utils.client, file, projectId)
        .then((ok) => { if (ok) { toast.success("素材上传成功"); refetch(); } })
        .finally(() => setUploading(false));
    },
    [projectId, utils, refetch]
  );

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  type Asset = NonNullable<typeof assets>[0];

  // Create a populated `asset` node per item, staggered so a batch fans out.
  const addAssetsToCanvas = (list: Asset[]) => {
    if (list.length === 0) return;
    try {
      list.forEach((asset, i) => {
        const node = addNode("asset", { x: 200 + i * 28, y: 200 + i * 28 });
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
          <p className="text-[10px] mt-0.5" style={{ color: "var(--c-t4)" }}>
            {assets?.length ?? 0} 个素材
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

      {/* ── Upload zone ── */}
      <div className="px-3 py-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-elevated)" }}>
        <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" onChange={handleFileSelect} className="hidden" />
        <div
          onClick={() => !uploading && fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className="flex flex-col items-center justify-center gap-2 rounded-xl py-5 cursor-pointer transition-all"
          style={{
            border: `1.5px dashed ${dragOver ? "oklch(0.65 0.18 60 / 0.6)" : "var(--c-bd2)"}`,
            background: dragOver ? "oklch(0.65 0.18 60 / 0.06)" : "var(--c-input)",
          }}
        >
          {uploading ? (
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "oklch(0.65 0.18 60)" }} />
          ) : (
            <Upload className="w-5 h-5" style={{ color: dragOver ? "oklch(0.65 0.18 60)" : "var(--c-t4)" }} />
          )}
          <div className="text-center">
            <p className="text-xs font-medium" style={{ color: uploading ? "oklch(0.65 0.18 60)" : "var(--c-t3)" }}>
              {uploading ? "上传中..." : "点击或拖拽上传"}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--c-t4)" }}>
              图片 · 视频 · 音频 · 最大 500MB
            </p>
          </div>
        </div>
        <button
          onClick={handleImportUrl}
          disabled={importMutation.isPending}
          className="mt-2 w-full text-[11px] py-1.5 rounded-lg transition-all"
          style={{ border: "1px dashed var(--c-bd2)", background: "transparent", color: "var(--c-t3)", cursor: "pointer" }}
        >
          {importMutation.isPending ? "导入中…" : "＋ 从链接导入"}
        </button>
      </div>

      {/* ── Filters (collapsible — collapsed by default to save space) ── */}
      <div className="px-3 py-1.5 flex flex-col gap-1.5 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-elevated)" }}>
        {(() => {
          const chip = (active: boolean): React.CSSProperties => ({
            fontSize: 10, padding: "2px 8px", borderRadius: 999, cursor: "pointer",
            border: `1px solid ${active ? "var(--c-accent, oklch(0.65 0.18 285))" : "var(--c-bd2)"}`,
            background: active ? "oklch(0.65 0.18 285 / 0.12)" : "transparent",
            color: active ? "oklch(0.72 0.16 285)" : "var(--c-t3)",
          });
          const typeLabel = ({ "": "全部", image: "图片", video: "视频", audio: "音频", other: "其他" } as Record<string, string>)[typeFilter];
          const srcLabel = ({ "": "全来源", upload: "上传", generated: "生成", external: "外部" } as Record<string, string>)[sourceFilter];
          const summary = `${scope === "all" ? "全部项目" : "本项目"} · ${typeLabel} · ${srcLabel}`;
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
                    {([["", "全部"], ["image", "图片"], ["video", "视频"], ["audio", "音频"], ["other", "其他"]] as [TypeFilter, string][]).map(([v, l]) => (
                      <button key={v} style={chip(typeFilter === v)} onClick={() => setTypeFilter(v)}>{l}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {([["", "全来源"], ["upload", "上传"], ["generated", "生成"], ["external", "外部"]] as [SourceFilter, string][]).map(([v, l]) => (
                      <button key={v} style={chip(sourceFilter === v)} onClick={() => setSourceFilter(v)}>{l}</button>
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
        {!assets || assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: "var(--c-surface)", border: "1px solid var(--c-bd1)" }}
            >
              <FileImage className="w-6 h-6" style={{ color: "var(--c-bd3)" }} />
            </div>
            <p className="text-xs text-center" style={{ color: "var(--c-t4)" }}>
              暂无素材<br />
              <span style={{ color: "var(--c-bd3)", fontSize: 10 }}>上传后将在此显示</span>
            </p>
          </div>
        ) : (
          // Auto multi-column thumbnail grid — adapts to panel width; file names
          // are hidden (shown on hover + as title) to stay compact.
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 6 }}>
            {assets.map((asset) => {
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
            onClick={() => {
              if (confirm(`确认删除选中的 ${selected.size} 个素材？`)) {
                selectedAssets.forEach((a) => deleteMutation.mutate({ id: a.id }));
                setSelected(new Set());
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

      {/* Video preview overlay */}
      {videoPreview && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-6"
          style={{ background: "oklch(0 0 0 / 0.8)", backdropFilter: "blur(8px)" }}
          onClick={() => setVideoPreview(null)}
        >
          <div className="relative" style={{ maxWidth: "90vw", maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
            <video src={videoPreview} controls autoPlay style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: 10, background: "#000" }} />
            <button
              onClick={() => setVideoPreview(null)}
              className="absolute flex items-center justify-center"
              style={{ top: -10, right: -10, width: 30, height: 30, borderRadius: "50%", background: "var(--c-elevated, #1a1a20)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", cursor: "pointer" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
