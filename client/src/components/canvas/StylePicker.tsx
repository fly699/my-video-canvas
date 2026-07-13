import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Star, Search } from "lucide-react";
import { STYLE_PRESETS, STYLE_CATEGORIES, type StylePreset, type StyleCategory } from "../../lib/stylePresets";
import { StyleSwatchPreview } from "./CameraMotionPreview";

interface Props {
  onSelect: (preset: StylePreset) => void;
  onClose: () => void;
}

// LibTV「风格库」：风格广场 / 我的收藏 / 我的风格 三 tab + 搜索 + 收藏（localStorage）。
type StyleTab = "plaza" | "fav" | "mine";
const FAV_KEY = "avc:style:favorites:v1";
function loadFavs(): string[] {
  try { const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; }
  catch { return []; }
}

/**
 * 风格库弹窗（对齐 LibTV 风格库）：三 tab + 搜索 + 收藏；选中风格 onSelect 后由调用方把风格片段
 * 注入提示词。风格广场按分类侧栏浏览，搜索时跨分类匹配。
 */
export function StylePicker({ onSelect, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<StyleCategory>("影视质感");
  // Esc 关闭（capture 抢在画布 Esc 取消选中之前）。
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);
  const [tab, setTab] = useState<StyleTab>("plaza");
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState<string[]>(loadFavs);

  const toggleFav = (id: string) => setFavs((prev) => {
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* quota */ }
    return next;
  });

  const q = query.trim().toLowerCase();
  const matchQ = (t: StylePreset) =>
    !q || t.label.toLowerCase().includes(q) || t.englishLabel.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);

  const showSidebar = tab === "plaza" && !q;
  const filtered = tab === "fav"
    ? STYLE_PRESETS.filter((t) => favs.includes(t.id) && matchQ(t))
    : tab === "mine"
      ? []
      : STYLE_PRESETS.filter((t) => (q ? true : t.category === activeCategory) && matchQ(t));

  const counts: Record<string, number> = {};
  for (const t of STYLE_PRESETS) counts[t.category] = (counts[t.category] ?? 0) + 1;

  const TABS: { id: StyleTab; label: string }[] = [
    { id: "plaza", label: "风格广场" },
    { id: "fav", label: "我的收藏" },
    { id: "mine", label: "我的风格" },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col"
        style={{ width: "min(920px, 92vw)", height: "min(640px, 86vh)", background: "var(--c-base)", border: "1px solid var(--c-bd2)", borderRadius: 14, boxShadow: "0 24px 60px oklch(0 0 0 / 0.55)", overflow: "hidden" }}
      >
        {/* Header — tabs + search + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--c-bd1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{ padding: "6px 12px", fontSize: 13, fontWeight: active ? 700 : 500, background: active ? "var(--c-elevated)" : "transparent", border: "none", borderRadius: 8, color: active ? "var(--c-t1)" : "var(--c-t3)", cursor: "pointer" }}
                  onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; }}
                  onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--c-t3)"; }}
                >{t.label}</button>
              );
            })}
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 10px", borderRadius: 9, background: "var(--c-elevated)", border: "1px solid var(--c-bd2)", maxWidth: 320 }}>
            <Search size={14} style={{ color: "var(--c-t4)", flexShrink: 0 }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索风格名称"
              style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--c-t1)", fontSize: 12.5 }} />
            {query && <button onClick={() => setQuery("")} style={{ background: "none", border: "none", color: "var(--c-t4)", cursor: "pointer", lineHeight: 0, padding: 0 }}><X size={13} /></button>}
          </div>
          <button
            onClick={onClose}
            title="关闭"
            style={{ width: 26, height: 26, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid var(--c-bd2)", borderRadius: 6, color: "var(--c-t3)", cursor: "pointer" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          ><X style={{ width: 14, height: 14 }} /></button>
        </div>

        {/* Body */}
        <div className="flex" style={{ flex: 1, minHeight: 0 }}>
          {showSidebar && (
            <div style={{ width: 130, flexShrink: 0, borderRight: "1px solid var(--c-bd1)", padding: "8px 4px", overflowY: "auto" }}>
              {STYLE_CATEGORIES.map((cat) => {
                const isActive = cat === activeCategory;
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    style={{ width: "100%", padding: "8px 12px", fontSize: 12, background: isActive ? "oklch(0.68 0.22 285 / 0.12)" : "transparent", border: "none", borderLeft: `2px solid ${isActive ? "oklch(0.68 0.22 285)" : "transparent"}`, color: isActive ? "oklch(0.78 0.18 285)" : "var(--c-t2)", cursor: "pointer", textAlign: "left", fontWeight: isActive ? 600 : 400, display: "flex", alignItems: "center", justifyContent: "space-between", transition: "background 120ms ease, color 120ms ease" }}
                    onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
                    onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <span>{cat}</span>
                    <span style={{ fontSize: 10, color: "var(--c-t4)" }}>{counts[cat] ?? 0}</span>
                  </button>
                );
              })}
            </div>
          )}

          {tab === "mine" ? (
            <div className="flex flex-col items-center justify-center" style={{ flex: 1, gap: 8, color: "var(--c-t4)" }}>
              <span style={{ fontSize: 30 }}>🎨</span>
              <p style={{ fontSize: 13, color: "var(--c-t3)", margin: 0 }}>暂无自定义风格</p>
              <p style={{ fontSize: 11, margin: 0 }}>自定义风格功能即将上线</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center" style={{ flex: 1, gap: 8, color: "var(--c-t4)" }}>
              <span style={{ fontSize: 30 }}>{tab === "fav" ? "⭐" : "🔍"}</span>
              <p style={{ fontSize: 12.5, color: "var(--c-t3)", margin: 0 }}>{tab === "fav" ? "还没有收藏的风格（点卡片右上角星标收藏）" : "没有匹配的风格"}</p>
            </div>
          ) : (
            <div className="nowheel" style={{ flex: 1, overflowY: "auto", padding: "14px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, alignContent: "start" }}>
              {filtered.map((t) => {
                const isFav = favs.includes(t.id);
                return (
                  <div
                    key={t.id}
                    onClick={() => { onSelect(t); onClose(); }}
                    style={{ position: "relative", textAlign: "left", padding: "12px", background: "var(--c-surface)", border: "1px solid var(--c-bd2)", borderRadius: 10, cursor: "pointer", transition: "transform 150ms ease, border-color 150ms ease", display: "flex", flexDirection: "column", gap: 5 }}
                    onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.transform = "translateY(-1px)"; el.style.borderColor = "var(--c-t4)"; }}
                    onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.transform = "translateY(0)"; el.style.borderColor = "var(--c-bd2)"; }}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFav(t.id); }}
                      title={isFav ? "取消收藏" : "收藏"}
                      style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none", cursor: "pointer", lineHeight: 0, padding: 2 }}
                    >
                      <Star size={14} style={{ color: isFav ? "oklch(0.80 0.16 85)" : "var(--c-t4)", fill: isFav ? "oklch(0.80 0.16 85)" : "none" }} />
                    </button>
                    {/* #135 风格色彩演示：迷你场景 + 风格滤镜（纯 CSS，带轻微呼吸感） */}
                    <StyleSwatchPreview styleId={t.id} />
                    <div style={{ display: "flex", alignItems: "center", gap: 7, paddingRight: 18 }}>
                      <span style={{ fontSize: 20, lineHeight: 1 }}>{t.emoji}</span>
                    <div style={{ paddingRight: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-t1)" }}>{t.label}</div>
                      <div style={{ fontSize: 10, color: "var(--c-t4)" }}>{t.englishLabel}</div>
                    </div>
                    </div>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--c-t3)", lineHeight: 1.45 }}>{t.description}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
