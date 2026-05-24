import { useState } from "react";
import { useTheme, THEMES } from "../../contexts/ThemeContext";

// The 3 "pinned" themes always visible; rest show on expand
const PINNED_IDS = ["dark", "dim", "light"];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [expanded, setExpanded] = useState(false);

  // Always show: current theme + pinned (dedup), capped at 3
  const visibleIds = Array.from(
    new Set([theme, ...PINNED_IDS])
  ).slice(0, 3);

  const visibleThemes = visibleIds
    .map((id) => THEMES.find((t) => t.id === id)!)
    .filter(Boolean);

  const hiddenThemes = THEMES.filter((t) => !visibleIds.includes(t.id));

  return (
    <div data-theme-swatches style={{ position: "relative", display: "flex", alignItems: "center", gap: 3 }}>
      {/* Always-visible 3 swatches */}
      {visibleThemes.map((t) => (
        <Swatch
          key={t.id}
          meta={t}
          active={theme === t.id}
          onClick={() => setTheme(t.id)}
        />
      ))}

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "收起" : "更多主题"}
        style={{
          width: 20,
          height: 20,
          borderRadius: 5,
          border: "none",
          background: "oklch(0.30 0.006 260 / 0.55)",
          color: "oklch(0.75 0.010 260)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          lineHeight: 1,
          padding: 0,
          transition: "background 120ms ease",
          flexShrink: 0,
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLElement).style.background =
            "oklch(0.38 0.008 260 / 0.70)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLElement).style.background =
            "oklch(0.30 0.006 260 / 0.55)")
        }
      >
        {expanded ? "‹" : "›"}
      </button>

      {/* Expanded drawer — floats above */}
      {expanded && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            right: 0,
            display: "grid",
            gridTemplateColumns: "repeat(5, 26px)",
            gap: 4,
            background: "oklch(0.14 0.008 260 / 0.95)",
            backdropFilter: "blur(8px)",
            border: "1px solid oklch(0.30 0.008 260 / 0.50)",
            borderRadius: 10,
            padding: 8,
            boxShadow: "0 6px 24px oklch(0 0 0 / 0.45)",
            zIndex: 9999,
          }}
        >
          {hiddenThemes.map((t) => (
            <Swatch
              key={t.id}
              meta={t}
              active={theme === t.id}
              onClick={() => {
                setTheme(t.id);
                setExpanded(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Swatch({
  meta,
  active,
  onClick,
}: {
  meta: (typeof THEMES)[number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={meta.label}
      aria-label={meta.label}
      aria-pressed={active}
      style={{
        width: 26,
        height: 26,
        borderRadius: 7,
        border: active
          ? "2px solid oklch(0.68 0.22 285)"
          : "2px solid transparent",
        background: meta.canvas,
        cursor: "pointer",
        padding: 0,
        position: "relative",
        boxShadow: active
          ? "0 0 0 1px oklch(0.68 0.22 285 / 0.35)"
          : "0 1px 3px oklch(0 0 0 / 0.30)",
        transition:
          "border-color 150ms ease, box-shadow 150ms ease, transform 120ms ease",
        transform: active ? "scale(1.08)" : "scale(1)",
        overflow: "hidden",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        if (!active)
          (e.currentTarget as HTMLElement).style.transform = "scale(1.05)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = active
          ? "scale(1.08)"
          : "scale(1)";
      }}
    >
      <span
        style={{
          position: "absolute",
          bottom: 3,
          right: 3,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: meta.surface,
          opacity: 0.9,
        }}
      />
    </button>
  );
}
