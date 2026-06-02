import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useCanvasStore } from "../../hooks/useCanvasStore";
import { Upload, X, FileImage, FileVideo, FileAudio, File, Trash2, Plus, Loader2, Download, Check } from "lucide-react";
import { ImageLightbox } from "./ImageLightbox";
import { uploadAssetFile } from "@/lib/assetUpload";

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
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  // Multi-select: set of asset ids. Click an item's body to toggle. Selected
  // items can be batch-added to the canvas, dragged together, or deleted.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: assets, refetch } = trpc.assets.list.useQuery({
    projectId: scope === "all" ? undefined : projectId,
    allProjects: scope === "all",
    type: typeFilter || undefined,
    source: sourceFilter || undefined,
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

      {/* ── Filters ── */}
      <div className="px-3 py-2 flex flex-col gap-1.5 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-elevated)" }}>
        {(() => {
          const chip = (active: boolean): React.CSSProperties => ({
            fontSize: 10, padding: "2px 8px", borderRadius: 999, cursor: "pointer",
            border: `1px solid ${active ? "var(--c-accent, oklch(0.65 0.18 285))" : "var(--c-bd2)"}`,
            background: active ? "oklch(0.65 0.18 285 / 0.12)" : "transparent",
            color: active ? "oklch(0.72 0.16 285)" : "var(--c-t3)",
          });
          return (
            <>
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
          <div className="space-y-1">
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
                  className="group flex items-center gap-2.5 p-2 rounded-lg transition-all"
                  style={{
                    background: isSel ? "oklch(0.65 0.18 285 / 0.12)" : "transparent",
                    border: isSel ? "1px solid oklch(0.65 0.18 285 / 0.35)" : "1px solid transparent",
                    cursor: "grab",
                  }}
                  title="拖拽到画布添加为节点"
                  onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
                  onMouseLeave={(e) => { if (!isSel) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  {/* Selection checkbox */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSelect(asset.id); }}
                    title={isSel ? "取消选择" : "选择"}
                    className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                      border: `1.5px solid ${isSel ? "oklch(0.65 0.18 285)" : "var(--c-bd3)"}`,
                      background: isSel ? "oklch(0.65 0.18 285)" : "transparent",
                    }}
                  >
                    {isSel && <Check className="w-3 h-3" style={{ color: "white" }} />}
                  </button>

                  {/* Thumbnail (click an image to zoom in the lightbox) */}
                  <div
                    className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
                    style={{ background: `${accent}12`, border: `1px solid ${accent}25`, cursor: asset.type === "image" ? "zoom-in" : "default" }}
                    onClick={asset.type === "image" ? () => { const i = imageUrls.indexOf(asset.url); if (i >= 0) setLightboxIdx(i); } : undefined}
                    title={asset.type === "image" ? "点击放大" : undefined}
                  >
                    {asset.type === "image" ? (
                      <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
                    ) : (
                      <Icon className="w-5 h-5" style={{ color: accent }} />
                    )}
                  </div>

                  {/* Info (click to toggle selection) */}
                  <div className="flex-1 min-w-0" style={{ cursor: "pointer" }} onClick={() => toggleSelect(asset.id)}>
                    <p className="text-xs font-medium truncate" style={{ color: "var(--c-t2)" }}>
                      {asset.name}
                    </p>
                    <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--c-t4)" }}>
                      {asset.source === "generated" ? `生成${asset.provider ? "·" + asset.provider : ""}` : asset.source === "external" ? "外部" : "上传"}
                      {asset.model ? ` · ${asset.model}` : ""}
                      {" · "}{asset.size ? `${(asset.size / 1024).toFixed(0)} KB` : "—"}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a
                      href={asset.url}
                      download={asset.name}
                      target="_blank"
                      rel="noreferrer"
                      title="下载"
                      className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
                      style={{ color: "var(--c-t3)" }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.68 0.18 240 / 0.15)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.70 0.16 240)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                    <button
                      onClick={() => handleAddToCanvas(asset)}
                      title="添加到画布"
                      className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
                      style={{ color: "var(--c-t3)" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.72 0.18 155 / 0.15)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.72 0.18 155)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => { if (confirm("确认删除此素材？")) deleteMutation.mutate({ id: asset.id }); }}
                      title="删除"
                      className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
                      style={{ color: "var(--c-t3)" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "oklch(0.62 0.20 25 / 0.15)"; (e.currentTarget as HTMLElement).style.color = "oklch(0.62 0.20 25)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
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
    </div>
  );
}
