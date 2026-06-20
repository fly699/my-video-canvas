import { useUIStyle, type UIStyle } from "../../contexts/UIStyleContext";

// Compact segmented control for the UI style skin. Lives beside ThemeSwitcher.
// Only "pro" and "studio" are offered until the "simple" skin ships, so a user
// can never select a style that has no skin yet.
const OPTIONS: { id: UIStyle; label: string; title: string }[] = [
  { id: "pro", label: "专业", title: "专业版（现有界面）" },
  { id: "studio", label: "工作室", title: "工作室版（影院·媒体优先）" },
];

export function UIStyleSwitcher() {
  const { uiStyle, setUIStyle } = useUIStyle();

  return (
    <div
      data-ui-switch
      title="界面风格"
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
        const active = uiStyle === o.id;
        return (
          <button
            key={o.id}
            onClick={() => setUIStyle(o.id)}
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
              // Theme-aware so it stays legible on light skins too: active = solid
              // accent pill + white text (high contrast on any backdrop); inactive =
              // the theme's secondary text token.
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
