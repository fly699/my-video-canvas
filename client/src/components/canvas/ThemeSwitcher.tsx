import { useTheme, THEMES } from "../../contexts/ThemeContext";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 26px)",
        gap: 4,
      }}
    >
      {THEMES.map((t) => {
        const isActive = theme === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            title={t.label}
            aria-label={t.label}
            aria-pressed={isActive}
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: isActive
                ? "2px solid oklch(0.68 0.22 285)"
                : "2px solid transparent",
              background: t.canvas,
              cursor: "pointer",
              padding: 0,
              position: "relative",
              boxShadow: isActive
                ? "0 0 0 1px oklch(0.68 0.22 285 / 0.35)"
                : "0 1px 3px oklch(0 0 0 / 0.30)",
              transition: "border-color 150ms ease, box-shadow 150ms ease, transform 120ms ease",
              transform: isActive ? "scale(1.08)" : "scale(1)",
              overflow: "hidden",
            }}
            onMouseEnter={(e) => {
              if (!isActive) (e.currentTarget as HTMLElement).style.transform = "scale(1.05)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = isActive ? "scale(1.08)" : "scale(1)";
            }}
          >
            {/* Inner surface dot — top-right corner */}
            <span
              style={{
                position: "absolute",
                bottom: 3,
                right: 3,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: t.surface,
                opacity: 0.9,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
