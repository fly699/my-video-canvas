import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Sparkles } from "lucide-react";
import { MediaImage } from "./MediaImage";

/**
 * LibTV 三段式就地输入条的共享部件：
 * - ToolChip：顶部工具行的浅灰胶囊（＋参考 / 标记 / 风格 / 聚焦 / 运镜 / 特效…）
 * - RefThumbRow：参考图缩略行（编号角标 + hover 删除），与 LibTV 图 1-5 一致
 */
export function ToolChip({ icon, label, onClick, active, title, disabled }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="nodrag"
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      title={title ?? label}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, height: 30, padding: "0 12px",
        borderRadius: 999, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
        background: active ? "color-mix(in oklab, var(--ui-accent, var(--c-accent)) 16%, var(--c-surface))" : "var(--c-surface)",
        border: `1px solid ${active ? "var(--ui-accent, var(--c-accent))" : "var(--c-bd1)"}`,
        color: active ? "var(--c-t1)" : "var(--c-t2)",
        transition: "background 120ms ease, border-color 120ms ease",
      }}
      onMouseEnter={(e) => { if (!disabled && !active) (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
      onMouseLeave={(e) => { if (!disabled && !active) (e.currentTarget as HTMLElement).style.background = "var(--c-surface)"; }}
    >
      {icon}{label}
    </button>
  );
}

export function RefThumbRow({ images, onRemove, onClick }: {
  images: { id: string; url: string }[];
  onRemove?: (id: string) => void;
  /** 点缩略图（如插入「主体N」token / 放大查看）。 */
  onClick?: (index: number) => void;
}) {
  // 悬停自动放大预览（LibTV）：hover 缩略图在其上方浮出大图。
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (images.length === 0) return null;
  return (
    <div className="nodrag" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {images.map((img, i) => (
        <div key={img.id} style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}
          onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx((v) => (v === i ? null : v))}>
          {hoverIdx === i && (
            <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 60, width: 220, borderRadius: 12, overflow: "hidden", border: "1px solid var(--c-bd2)", background: "var(--c-base)", boxShadow: "0 14px 44px oklch(0 0 0 / 0.55)", pointerEvents: "none" }}>
              <MediaImage src={img.url} alt={`参考 ${i + 1} 预览`} style={{ display: "block", width: "100%", maxHeight: 260, objectFit: "contain", background: "var(--c-canvas)" }} />
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClick?.(i); }}
            title={onClick ? `图片 ${i + 1}（点击插入引用）` : `图片 ${i + 1}`}
            style={{ width: "100%", height: "100%", padding: 0, border: "1px solid var(--c-bd2)", borderRadius: 10, overflow: "hidden", cursor: onClick ? "pointer" : "default", background: "var(--c-input)" }}
          >
            <MediaImage src={img.url} alt={`参考 ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </button>
          {/* 编号角标（与 LibTV 一致的左上角圆标） */}
          <span style={{ position: "absolute", top: -4, left: -4, width: 16, height: 16, borderRadius: "50%", background: "oklch(0.25 0.01 260)", border: "1px solid var(--c-bd3)", color: "#fff", fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>{i + 1}</span>
          {onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(img.id); }}
              title="移除该参考图"
              style={{ position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: "oklch(0.3 0.02 260)", border: "1px solid var(--c-bd3)", color: "var(--c-t2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
            >
              <X size={9} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** LibTV「标记」元素选择浮层：AI 分析选中图片的可引用元素，点选后回调插入引用。 */
export function MarkElementPicker({ imageUrl, elements, loading, error, onSelect, onClose }: {
  imageUrl: string;
  elements: { name: string; desc?: string }[];
  loading: boolean;
  error?: string | null;
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(420px, 90vw)", background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 14, boxShadow: "0 24px 60px oklch(0 0 0 / 0.55)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid var(--c-bd1)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 700, color: "var(--c-t1)" }}>
            <Sparkles size={14} /> 选择要标记的元素
          </span>
          <button onClick={onClose} title="关闭"
            style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t3)", cursor: "pointer" }}>
            <X size={13} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 12, padding: 14 }}>
          <div style={{ width: 120, flexShrink: 0, borderRadius: 10, overflow: "hidden", border: "1px solid var(--c-bd2)", background: "var(--c-canvas)", alignSelf: "flex-start" }}>
            <MediaImage src={imageUrl} alt="标记源图" style={{ display: "block", width: "100%", objectFit: "cover" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--c-t3)", padding: "12px 0" }}>
                <Loader2 size={14} className="animate-spin" /> AI 正在分析图中元素…
              </div>
            )}
            {!loading && error && <div style={{ fontSize: 12, color: "oklch(0.62 0.20 25)", padding: "8px 0" }}>{error}</div>}
            {!loading && !error && elements.map((el) => (
              <button key={el.name} onClick={() => onSelect(el.name)}
                style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "8px 11px", borderRadius: 10, background: "var(--c-surface)", border: "1px solid var(--c-bd2)", color: "var(--c-t1)", cursor: "pointer", textAlign: "left" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--ui-accent, var(--c-accent))"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd2)"; }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{el.name}</span>
                {el.desc && <span style={{ fontSize: 10.5, color: "var(--c-t3)" }}>{el.desc}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
