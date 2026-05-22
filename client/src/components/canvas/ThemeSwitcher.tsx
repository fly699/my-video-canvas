import { useTheme, THEMES } from "../../contexts/ThemeContext";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div style={{ display: "flex", gap: 2 }}>
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => setTheme(t.id)}
          title={t.label}
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            border: theme === t.id
              ? "1.5px solid var(--c-bd3)"
              : "1.5px solid transparent",
            background: theme === t.id ? "var(--c-surface)" : "transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            transition: "all 150ms ease",
          }}
        >
          {t.icon}
        </button>
      ))}
    </div>
  );
}
