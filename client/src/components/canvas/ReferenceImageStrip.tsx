import { useRef, useState } from "react";
import { X, ZoomIn } from "lucide-react";
import type { ReferenceImage } from "../../../../shared/types";
import { MediaImage } from "./MediaImage";

interface Props {
  images: ReferenceImage[];
  open: boolean;
  onClose: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, toIndex: number) => void;
  onInsertUrls: (urls: string[], index: number) => void;
  /** Files dropped onto the strip — the node uploads them then inserts. */
  onDropFiles: (files: File[], index: number) => void;
  onZoom: (index: number) => void;
  accent?: string;
  /**
   * 只读汇总模式（ComfyUI 自定义工作流用）：每张图绑定到某个具体的工作流图像参数，
   * 排序/插入都没有意义，故禁用拖拽重排、拖入新图与底部「拖拽添加」提示；仅保留
   * 预览、点击放大与删除（删除＝清空对应参数）。
   */
  readOnly?: boolean;
  /** 顶部标题文案（默认「参考图」）。 */
  title?: string;
}

/** Pull image URLs out of a drag payload (asset-list JSON, then uri/text). */
function urlsFromDrag(dt: DataTransfer): string[] {
  const assetRaw = dt.getData("application/x-asset-list");
  if (assetRaw) {
    try {
      const list = JSON.parse(assetRaw) as Array<{ url?: string; type?: string }>;
      return list.filter((a) => a.url && (!a.type || a.type === "image")).map((a) => a.url!);
    } catch { /* fall through */ }
  }
  const uri = dt.getData("text/uri-list") || dt.getData("text/plain");
  if (uri) {
    return uri.split(/[\r\n]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
  }
  return [];
}

/**
 * Left-docked, vertical strip of a node's reference images. Numbered top→bottom
 * (1-based, auto-renumbered on change). Click a thumbnail to zoom, the × to
 * delete. Accepts drag-in (files / asset-library items / pasted URLs) and
 * intra-strip reorder; the insertion point is chosen by the cursor's vertical
 * position (smart-sort). Rendered inside the node DOM, docked to its left edge.
 */
export function ReferenceImageStrip({
  images, open, onClose, onRemove, onMove, onInsertUrls, onDropFiles, onZoom, accent = "oklch(0.72 0.20 330)",
  readOnly = false, title = "参考图",
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  if (!open) return null;

  // Compute the insertion index from the cursor Y vs. each thumbnail's midpoint.
  const computeIndex = (clientY: number): number => {
    const el = listRef.current;
    if (!el) return images.length;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-ref-item]"));
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return items.length;
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDropIndex(computeIndex(e.clientY));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const index = computeIndex(e.clientY);
    setDropIndex(null);
    // 1) intra-strip reorder
    const reorderId = e.dataTransfer.getData("application/x-ref-reorder");
    if (reorderId) { onMove(reorderId, index); return; }
    // 2) files
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) { onDropFiles(files, index); return; }
    // 3) URLs (asset-library items, pasted links)
    const urls = urlsFromDrag(e.dataTransfer);
    if (urls.length) onInsertUrls(urls, index);
  };

  return (
    <div
      className="nodrag nowheel"
      style={{
        position: "absolute", right: "calc(100% + 8px)", top: 0, width: 92, maxHeight: "100%",
        display: "flex", flexDirection: "column", gap: 6, padding: 8,
        borderRadius: 12,
        // 拖拽中整框高亮，提示「拖到框内任意处即可添加」（无需独立拖拽区）
        border: `1px ${!readOnly && dropIndex !== null ? "dashed" : "solid"} ${!readOnly && dropIndex !== null ? accent : "var(--c-bd2)"}`,
        background: "color-mix(in oklch, var(--c-base) 94%, transparent)",
        backdropFilter: "blur(16px)", boxShadow: "0 12px 36px oklch(0 0 0 / 0.4)",
        zIndex: 30,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onDragOver={readOnly ? undefined : onDragOver}
      onDragLeave={readOnly ? undefined : () => setDropIndex(null)}
      onDrop={readOnly ? undefined : onDrop}
    >
      <div className="flex items-center justify-between" style={{ paddingInline: 2 }}>
        <span style={{ fontSize: 10, color: "var(--c-t3)", fontWeight: 600 }}>{title} {images.length}</span>
        <button onClick={onClose} className="nodrag" style={{ color: "var(--c-t4)", lineHeight: 0 }} title="收起">
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>

      <div ref={listRef} className="nowheel" style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
        {images.map((img, i) => (
          <div key={img.id}>
            {!readOnly && dropIndex === i && <div style={{ height: 2, background: accent, borderRadius: 2, margin: "1px 0" }} />}
            <div
              data-ref-item
              draggable={!readOnly}
              onDragStart={readOnly ? undefined : (e) => { e.dataTransfer.setData("application/x-ref-reorder", img.id); e.dataTransfer.effectAllowed = "move"; }}
              title={img.label}
              className="relative group rounded-lg overflow-hidden"
              style={{ height: 72, border: `1px solid var(--c-bd2)`, background: "var(--c-canvas)", cursor: readOnly ? "default" : "grab" }}
            >
              <MediaImage
                src={img.url}
                alt={img.label ?? `ref-${i + 1}`}
                className="w-full h-full object-cover"
                draggable={false}
                style={{ cursor: "zoom-in" }}
                onClick={() => onZoom(i)}
              />
              {/* number badge */}
              <span
                style={{
                  position: "absolute", left: 3, top: 3, minWidth: 15, height: 15, paddingInline: 3,
                  borderRadius: 8, fontSize: 9, fontWeight: 700, lineHeight: "15px", textAlign: "center",
                  background: accent, color: "white",
                }}
              >
                {i + 1}
              </span>
              {/* zoom + delete on hover */}
              <button
                onClick={(e) => { e.stopPropagation(); onZoom(i); }}
                className="nodrag absolute opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ right: 3, bottom: 3, padding: 2, borderRadius: 6, background: "oklch(0 0 0 / 0.6)", color: "white", lineHeight: 0 }}
                title="放大"
              >
                <ZoomIn style={{ width: 11, height: 11 }} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(img.id); }}
                className="nodrag absolute opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ right: 3, top: 3, padding: 2, borderRadius: "50%", background: "oklch(0 0 0 / 0.7)", color: "white", lineHeight: 0 }}
                title="删除"
              >
                <X style={{ width: 11, height: 11 }} />
              </button>
            </div>
          </div>
        ))}
        {/* 末尾插入指示线（拖到框内任意处即可添加，独立拖拽区已移除，节省空间） */}
        {!readOnly && dropIndex === images.length && <div style={{ height: 2, background: accent, borderRadius: 2, margin: "1px 0" }} />}
        {readOnly && (
          <div style={{ marginTop: 2, padding: "6px 4px", textAlign: "center", fontSize: 9, color: "var(--c-t4)", lineHeight: 1.3 }}>
            工作流图像参数<br />删除＝清空该参数
          </div>
        )}
      </div>
    </div>
  );
}
