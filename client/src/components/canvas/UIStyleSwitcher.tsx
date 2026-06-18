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
        background: "oklch(0.30 0.006 260 / 0.45)",
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
              fontWeight: 600,
              lineHeight: 1,
              padding: "5px 9px",
              borderRadius: 6,
              background: active ? "oklch(0.68 0.22 285 / 0.22)" : "transparent",
              color: active ? "oklch(0.78 0.16 285)" : "oklch(0.70 0.010 260)",
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
