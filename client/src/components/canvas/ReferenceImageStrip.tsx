import { useMemo, useRef, useState } from "react";
import { X, ZoomIn, Play, Pause } from "lucide-react";
import type { ReferenceImage } from "../../../../shared/types";
import { MediaImage } from "./MediaImage";
import { mediaFetchUrl } from "@/lib/download";
import { audioWaveBars } from "../../lib/audioWaveform";

/**
 * 吸附窗里的一项：默认是图片（角色/场景/参考图/分析图/工作流图），可带类型标签与可删标记。
 * `kind:"audio"` 时表示音频项，用波形缩略图展示（点击播放/暂停）；`kind:"video"` 时表示
 * 视频项，用 <video>（首帧/可点击播放）展示。`name` 为显示名（@音频名 / @视频名 提及用）。
 */
export type StripItem = ReferenceImage & { label?: string; removable?: boolean; kind?: "image" | "audio" | "video"; name?: string };

/** 音频项的波形缩略图磁贴：伪波形 + 居中播放/暂停按钮，点击就地播放。 */
function AudioWaveTile({ url, name, accent }: { url: string; name?: string; accent: string }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bars = useMemo(() => audioWaveBars(url), [url]);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {}); else a.pause();
  };
  return (
    <div
      onClick={toggle}
      title={name ? `音频 · ${name}（点击播放）` : "音频（点击播放）"}
      style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 1.5, padding: "0 6px", position: "relative", cursor: "pointer" }}
    >
      <audio
        ref={audioRef}
        src={mediaFetchUrl(url)}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      {bars.map((b, i) => (
        <div key={i} style={{ width: 2.5, height: `${Math.round(b * 64)}%`, background: accent, opacity: playing ? 0.92 : 0.5, borderRadius: 2, transition: "opacity 150ms ease" }} />
      ))}
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "oklch(0 0 0 / 0.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
          {playing ? <Pause style={{ width: 11, height: 11 }} /> : <Play style={{ width: 11, height: 11 }} />}
        </div>
      </div>
    </div>
  );
}

/** 视频项磁贴：<video> 显示首帧，点击就地播放/暂停，右下角播放角标。 */
function VideoThumbTile({ url, name }: { url: string; name?: string }) {
  const [playing, setPlaying] = useState(false);
  const vidRef = useRef<HTMLVideoElement | null>(null);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = vidRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {}); else v.pause();
  };
  return (
    <div
      onClick={toggle}
      title={name ? `视频 · ${name}（点击播放）` : "视频（点击播放）"}
      style={{ width: "100%", height: "100%", position: "relative", cursor: "pointer", background: "oklch(0 0 0 / 0.25)" }}
    >
      <video
        ref={vidRef}
        src={mediaFetchUrl(url)}
        preload="metadata"
        muted
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "oklch(0 0 0 / 0.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
          {playing ? <Pause style={{ width: 11, height: 11 }} /> : <Play style={{ width: 11, height: 11 }} />}
        </div>
      </div>
    </div>
  );
}

interface Props {
  images: StripItem[];
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
  /** 鼠标进/出本吸附窗（用于「悬停临时展开」期间保持展开，便于点击钉住）。 */
  onHoverChange?: (hovering: boolean) => void;
  /** 点击吸附窗（非关闭按钮）→ 钉住持久展开。 */
  onPin?: () => void;
  /** 只读模式底部的说明文字（仅 readOnly 时显示）。如工作流的「删除＝清空该参数」。 */
  readOnlyHint?: React.ReactNode;
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
  readOnly = false, title = "参考图", onHoverChange, onPin, readOnlyHint,
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
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onClick={() => onPin?.()}
      onDragOver={readOnly ? undefined : onDragOver}
      onDragLeave={readOnly ? undefined : () => setDropIndex(null)}
      onDrop={readOnly ? undefined : onDrop}
    >
      <div className="flex items-center justify-between" style={{ paddingInline: 2 }}>
        <span style={{ fontSize: 10, color: "var(--c-t3)", fontWeight: 600 }}>{title} {images.length}</span>
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="nodrag" style={{ color: "var(--c-t4)", lineHeight: 0 }} title="收起">
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>

      <div ref={listRef} className="nowheel" style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
        {images.map((img, i) => {
          const canRemove = img.removable !== false;     // 角色/场景为派生只读，不可删
          const canDrag = !readOnly && canRemove;         // 仅可删的「自有」图能拖动排序
          // 同标签出现多张时，给出 1/2/3… 序号（单张则只显示标签文字）
          const sameLabelTotal = img.label ? images.filter((x) => x.label === img.label).length : 0;
          const sameLabelIdx = img.label ? images.slice(0, i + 1).filter((x) => x.label === img.label).length : 0;
          const caption = img.label ? (sameLabelTotal > 1 ? `${img.label} ${sameLabelIdx}` : img.label) : "";
          return (
            <div key={img.id}>
              {!readOnly && dropIndex === i && <div style={{ height: 2, background: accent, borderRadius: 2, margin: "1px 0" }} />}
              <div
                data-ref-item
                draggable={canDrag}
                onDragStart={canDrag ? (e) => { e.dataTransfer.setData("application/x-ref-reorder", img.id); e.dataTransfer.effectAllowed = "move"; } : undefined}
                title={(img.kind === "audio" || img.kind === "video") ? (img.name ? `${img.label ?? (img.kind === "video" ? "视频" : "音频")} · ${img.name}` : (img.label ?? (img.kind === "video" ? "视频" : "音频"))) : img.label}
                className="relative group rounded-lg overflow-hidden"
                style={{ height: 72, border: `1px solid var(--c-bd2)`, background: "var(--c-canvas)", cursor: canDrag ? "grab" : "default" }}
              >
                {img.kind === "audio" ? (
                  <AudioWaveTile url={img.url} name={img.name} accent={accent} />
                ) : img.kind === "video" ? (
                  <VideoThumbTile url={img.url} name={img.name} />
                ) : (
                  <>
                    <MediaImage
                      src={img.url}
                      alt={img.label ?? `ref-${i + 1}`}
                      className="w-full h-full object-cover"
                      draggable={false}
                      style={{ cursor: "zoom-in" }}
                      onClick={() => onZoom(i)}
                    />
                    {/* zoom on hover (images only) */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onZoom(i); }}
                      className="nodrag absolute opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ right: 3, bottom: 14, padding: 2, borderRadius: 6, background: "oklch(0 0 0 / 0.6)", color: "white", lineHeight: 0 }}
                      title="放大"
                    >
                      <ZoomIn style={{ width: 11, height: 11 }} />
                    </button>
                  </>
                )}
                {/* 类型标签（角色/场景/参考图/分析图/工作流图/音频），常驻底部小条 */}
                {caption && (
                  <span
                    style={{
                      position: "absolute", left: 0, right: 0, bottom: 0, padding: "1px 4px",
                      fontSize: 8.5, fontWeight: 700, lineHeight: 1.3, color: "white",
                      background: "oklch(0 0 0 / 0.62)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                  >
                    {caption}
                  </span>
                )}
                {/* delete on hover (both image & audio) */}
                {canRemove && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(img.id); }}
                    className="nodrag absolute opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ right: 3, top: 3, padding: 2, borderRadius: "50%", background: "oklch(0 0 0 / 0.7)", color: "white", lineHeight: 0 }}
                    title="删除"
                  >
                    <X style={{ width: 11, height: 11 }} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {/* 末尾插入指示线（拖到框内任意处即可添加，独立拖拽区已移除，节省空间） */}
        {!readOnly && dropIndex === images.length && <div style={{ height: 2, background: accent, borderRadius: 2, margin: "1px 0" }} />}
        {readOnly && readOnlyHint && (
          <div style={{ marginTop: 2, padding: "6px 4px", textAlign: "center", fontSize: 9, color: "var(--c-t4)", lineHeight: 1.3 }}>
            {readOnlyHint}
          </div>
        )}
      </div>
    </div>
  );
}
