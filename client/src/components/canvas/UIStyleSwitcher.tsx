import { useUIStyle } from "../../contexts/UIStyleContext";
import { useCanvasMode } from "../../contexts/CanvasModeContext";

// Unified "界面模式" control. Folds the two previously-separate toggles (canvas mode
// 专业/创意 + UI skin 专业/工作室, which both showed a confusing "专业") into ONE
// segmented control with three coherent looks, each driving both axes:
//   专业   → pro skin   + professional canvas (standard)
//   创意   → pro skin   + creative canvas    (white, media-first / LibTV)
//   工作室 → studio skin + professional canvas (cinema dark, command bars)
type Mode = "pro" | "creative" | "studio";
const OPTIONS: { id: Mode; label: string; title: string }[] = [
  { id: "pro", label: "专业", title: "专业版（标准界面）" },
  { id: "creative", label: "创意", title: "创意模式（白色画布 · 媒体优先 · LibTV 风）" },
  { id: "studio", label: "工作室", title: "工作室（影院深色 · 命令栏 · 媒体优先）" },
];

export function UIStyleSwitcher() {
  const { uiStyle, setUIStyle } = useUIStyle();
  const { mode, setMode } = useCanvasMode();

  const current: Mode = uiStyle === "studio" ? "studio" : mode === "creative" ? "creative" : "pro";

  const pick = (id: Mode) => {
    if (id === "studio") { setUIStyle("studio"); setMode("professional"); }
    else if (id === "creative") { setUIStyle("pro"); setMode("creative"); }
    else { setUIStyle("pro"); setMode("professional"); }
  };

  return (
    <div
      data-ui-switch
      title="界面模式"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        background: "var(--c-input)",
        border: "1px solid var(--c-bd2)",
        borderRadius: 8,
        padding: 2,
        flexShrink: 0,
      }}
    >
      {OPTIONS.map((o) => {
        const active = current === o.id;
        return (
          <button
            key={o.id}
            onClick={() => pick(o.id)}
            title={o.title}
            aria-pressed={active}
            style={{
              border: "none",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1,
              padding: "5px 9px",
              borderRadius: 6,
              // Active = solid accent pill + white text (high contrast on any theme);
              // inactive = the theme's secondary text token.
              background: active ? "oklch(0.62 0.22 285)" : "transparent",
              color: active ? "#fff" : "var(--c-t2)",
              transition: "background 120ms ease, color 120ms ease",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
