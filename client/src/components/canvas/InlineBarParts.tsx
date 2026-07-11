import { X } from "lucide-react";
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
  if (images.length === 0) return null;
  return (
    <div className="nodrag" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {images.map((img, i) => (
        <div key={img.id} style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
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
