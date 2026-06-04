import { useEffect, useRef, useState } from "react";
import { Wallpaper, X } from "lucide-react";

export type BgPattern = "dots" | "lines" | "cross" | "none";

export interface CanvasBg {
  pattern: BgPattern;
  bgColor: string;
  patternColor: string;
  gap: number;
  size: number;
  /** When true, the canvas bottom color follows the active theme's --c-canvas
   *  (switching theme updates it). A preset/custom pick sets this false. */
  followTheme: boolean;
}

export const DEFAULT_CANVAS_BG: CanvasBg = {
  pattern: "dots",
  bgColor: "oklch(0.07 0.005 260)",
  patternColor: "oklch(0.26 0.008 260 / 0.7)",
  gap: 24,
  size: 1.5,
  followTheme: true,
};

const STORAGE_KEY = "avc:canvas-bg";

export function loadCanvasBg(): CanvasBg {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CanvasBg>;
      // Legacy rows (saved before followTheme existed): only the historical
      // default dark bg should follow the theme; an explicitly customized color
      // stays custom so we don't silently discard the user's choice.
      const followTheme = typeof parsed.followTheme === "boolean"
        ? parsed.followTheme
        : parsed.bgColor == null || parsed.bgColor === DEFAULT_CANVAS_BG.bgColor;
      return { ...DEFAULT_CANVAS_BG, ...parsed, followTheme };
    }
  } catch {}
  return DEFAULT_CANVAS_BG;
}

function saveCanvasBg(bg: CanvasBg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bg));
}

// ── Preset palettes ────────────────────────────────────────────────────────
// Grouped into "dark" + "light" + "vivid" rows for visual scanning. All
// presets show by default in a 4×N grid (no collapse) so the user doesn't
// need to hunt for "more colors".

const BG_PRESETS: { label: string; color: string; patternColor: string }[] = [
  // Dark theme variants
  { label: "纯黑",   color: "oklch(0.04 0.004 260)", patternColor: "oklch(0.22 0.006 260 / 0.7)" },
  { label: "深灰",   color: "oklch(0.07 0.005 260)", patternColor: "oklch(0.26 0.008 260 / 0.7)" },
  { label: "柔黑",   color: "oklch(0.11 0.006 260)", patternColor: "oklch(0.30 0.008 260 / 0.6)" },
  { label: "夜蓝",   color: "oklch(0.09 0.022 235)", patternColor: "oklch(0.30 0.020 235 / 0.6)" },
  { label: "深紫",   color: "oklch(0.09 0.028 280)", patternColor: "oklch(0.32 0.024 280 / 0.6)" },
  { label: "墨绿",   color: "oklch(0.09 0.018 160)", patternColor: "oklch(0.30 0.016 160 / 0.6)" },
  { label: "暗酒红", color: "oklch(0.10 0.030 25)",  patternColor: "oklch(0.32 0.028 25  / 0.6)" },
  { label: "炭青",   color: "oklch(0.10 0.018 190)", patternColor: "oklch(0.30 0.018 190 / 0.6)" },
  // Light theme variants
  { label: "纯白",   color: "oklch(0.99 0.002 260)", patternColor: "oklch(0.78 0.005 260 / 0.65)" },
  { label: "浅灰",   color: "oklch(0.93 0.003 260)", patternColor: "oklch(0.72 0.006 260 / 0.7)" },
  { label: "暖米",   color: "oklch(0.95 0.012 80)",  patternColor: "oklch(0.70 0.016 80  / 0.6)" },
  { label: "浅蓝",   color: "oklch(0.95 0.010 225)", patternColor: "oklch(0.68 0.014 225 / 0.6)" },
  { label: "薄绿",   color: "oklch(0.95 0.010 155)", patternColor: "oklch(0.68 0.014 155 / 0.6)" },
  { label: "浅粉",   color: "oklch(0.95 0.014 350)", patternColor: "oklch(0.70 0.018 350 / 0.6)" },
  { label: "浅薰",   color: "oklch(0.94 0.014 290)", patternColor: "oklch(0.70 0.020 290 / 0.6)" },
  { label: "奶油",   color: "oklch(0.96 0.020 95)",  patternColor: "oklch(0.72 0.020 95  / 0.6)" },
];

// Convert an oklch() string to an approximate hex for the native color
// picker. Falls back to "#000000" on parse failure so the picker still
// works — we don't actually need to round-trip; users picking from the
// native input write hex back via update().
function bgColorToInputValue(color: string): string {
  // If already hex/rgb, pass through.
  if (color.startsWith("#")) return color;
  if (color.startsWith("rgb")) return rgbToHex(color);
  // For oklch we just default the input to neutral mid-gray — the live
  // canvas keeps the actual oklch color until the user changes it.
  return "#1a1a1a";
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return "#000000";
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(parseInt(m[0]))}${toHex(parseInt(m[1]))}${toHex(parseInt(m[2]))}`;
}

// Derive a sensible pattern color from any hex/oklch background by
// flipping luminance: dark bg → light pattern, light bg → dark pattern.
function derivePatternColor(bgColor: string): string {
  // Crude luminance estimate from hex
  if (bgColor.startsWith("#") && bgColor.length === 7) {
    const r = parseInt(bgColor.slice(1, 3), 16);
    const g = parseInt(bgColor.slice(3, 5), 16);
    const b = parseInt(bgColor.slice(5, 7), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum < 0.5
      ? `rgba(255, 255, 255, 0.30)`
      : `rgba(0, 0, 0, 0.30)`;
  }
  // Default fallback that reads decently on most backgrounds
  return "oklch(0.55 0.01 260 / 0.55)";
}

const PATTERN_OPTIONS: { id: BgPattern; label: string }[] = [
  { id: "none",  label: "无" },
  { id: "dots",  label: "点阵" },
  { id: "lines", label: "线格" },
  { id: "cross", label: "十字" },
];

// Mini SVG preview for each pattern
function PatternPreview({ pattern, bg, fg }: { pattern: BgPattern; bg: string; fg: string }) {
  const size = 36;
  const gap = 9;
  const dotR = 0.8;

  const dots = [];
  if (pattern === "dots") {
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++)
        dots.push(<circle key={`${row}-${col}`} cx={col * gap + gap / 2} cy={row * gap + gap / 2} r={dotR} fill={fg} />);
  }
  const lines = [];
  if (pattern === "lines") {
    for (let i = 0; i < 5; i++) {
      lines.push(<line key={`h${i}`} x1={0} y1={i * gap / 1.5} x2={size} y2={i * gap / 1.5} stroke={fg} strokeWidth={0.6} />);
    }
  }
  const crosses = [];
  if (pattern === "cross") {
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++) {
        const cx = col * gap + gap / 2;
        const cy = row * gap + gap / 2;
        crosses.push(
          <g key={`${row}-${col}`}>
            <line x1={cx - 2} y1={cy} x2={cx + 2} y2={cy} stroke={fg} strokeWidth={0.6} />
            <line x1={cx} y1={cy - 2} x2={cx} y2={cy + 2} stroke={fg} strokeWidth={0.6} />
          </g>
        );
      }
  }

  return (
    <svg width={size} height={size} style={{ borderRadius: 6, display: "block" }}>
      <rect width={size} height={size} fill={bg} />
      {dots}
      {lines}
      {crosses}
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  value: CanvasBg;
  onChange: (bg: CanvasBg) => void;
}

export function CanvasBgPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const update = (patch: Partial<CanvasBg>) => {
    const next = { ...value, ...patch };
    onChange(next);
    saveCanvasBg(next);
  };

  const selectPreset = (p: typeof BG_PRESETS[0]) => {
    update({ bgColor: p.color, patternColor: p.patternColor, followTheme: false });
  };

  return (
    <div style={{ position: "relative" }} ref={panelRef}>
      {/* Toolbar button */}
      <button
        onClick={() => setOpen(v => !v)}
        title="画布背景"
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          border: open ? "1px solid var(--c-bd3)" : "1px solid transparent",
          background: open ? "var(--c-elevated)" : "transparent",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: open ? "var(--c-t1)" : "var(--c-t3)",
          transition: "all 150ms ease",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          if (!open) {
            (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
            (e.currentTarget as HTMLElement).style.color = "var(--c-t1)";
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--c-t3)";
          }
        }}
      >
        <Wallpaper style={{ width: 14, height: 14 }} />
      </button>

      {/* Panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 10px)",
            left: "50%",
            transform: "translateX(-50%)",
            width: 260,
            background: "var(--c-base)",
            border: "1px solid var(--c-bd2)",
            borderRadius: 14,
            boxShadow: "0 16px 48px oklch(0 0 0 / 0.6), 0 4px 12px oklch(0 0 0 / 0.4)",
            zIndex: 50,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px 8px",
              borderBottom: "1px solid var(--c-bd1)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Wallpaper style={{ width: 12, height: 12, color: "var(--c-t4)" }} />
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--c-t4)" }}>
                画布背景
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-t4)", display: "flex", padding: 2, borderRadius: 4 }}
            >
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>

          <div style={{ padding: "12px" }}>

            {/* Follow-theme toggle — when on, the canvas底色 tracks the active
                theme's background; picking a preset/custom color turns it off. */}
            <button
              onClick={() => update({ followTheme: true })}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "7px 10px",
                marginBottom: 14,
                borderRadius: 9,
                border: value.followTheme ? "1.5px solid oklch(0.68 0.22 285 / 0.7)" : "1.5px solid var(--c-bd1)",
                background: value.followTheme ? "oklch(0.68 0.22 285 / 0.12)" : "var(--c-surface)",
                color: value.followTheme ? "oklch(0.68 0.22 285)" : "var(--c-t3)",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 150ms ease",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: value.followTheme ? "oklch(0.68 0.22 285)" : "var(--c-t4)" }} />
              跟随当前主题
            </button>

            {/* Pattern selector */}
            <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)", marginBottom: 8 }}>
              图案
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 14 }}>
              {PATTERN_OPTIONS.map((opt) => {
                const isActive = value.pattern === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => update({ pattern: opt.id })}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 5,
                      padding: "6px 4px",
                      borderRadius: 9,
                      border: isActive ? "1.5px solid oklch(0.68 0.22 285 / 0.7)" : "1.5px solid var(--c-bd1)",
                      background: isActive ? "oklch(0.68 0.22 285 / 0.10)" : "var(--c-surface)",
                      cursor: "pointer",
                      transition: "all 150ms ease",
                    }}
                  >
                    <PatternPreview pattern={opt.id} bg={value.bgColor} fg={value.patternColor} />
                    <span style={{ fontSize: 10, color: isActive ? "oklch(0.68 0.22 285)" : "var(--c-t3)", fontWeight: isActive ? 600 : 400 }}>
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Color presets — all 16 always visible in a 4-col grid */}
            <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-t4)", marginBottom: 8 }}>
              底色
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 10 }}>
              {BG_PRESETS.map((preset) => {
                const isActive = value.bgColor === preset.color;
                return (
                  <button
                    key={preset.color}
                    onClick={() => selectPreset(preset)}
                    title={preset.label}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 3,
                      padding: "4px 2px",
                      borderRadius: 8,
                      border: isActive ? "1.5px solid oklch(0.68 0.22 285 / 0.7)" : "1.5px solid transparent",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        height: 22,
                        borderRadius: 6,
                        background: preset.color,
                        border: "1px solid oklch(0.5 0 0 / 0.25)",
                        boxShadow: isActive ? `0 0 0 2px oklch(0.68 0.22 285 / 0.5)` : "none",
                      }}
                    />
                    <span style={{ fontSize: 9, color: "var(--c-t4)" }}>{preset.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Custom color picker — native input for arbitrary hex */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "var(--c-t4)" }}>自定义</span>
              <input
                type="color"
                value={bgColorToInputValue(value.bgColor)}
                onChange={(e) => {
                  const hex = e.target.value;
                  update({ bgColor: hex, patternColor: derivePatternColor(hex), followTheme: false });
                }}
                style={{
                  width: 30, height: 22, padding: 0, border: "1px solid var(--c-bd2)",
                  borderRadius: 6, cursor: "pointer", background: "transparent",
                }}
              />
              <span style={{ fontSize: 10, color: "var(--c-t3)", fontFamily: "monospace", flex: 1 }}>
                {value.bgColor}
              </span>
            </div>

            {/* Gap / size sliders for non-none patterns */}
            {value.pattern !== "none" && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: "var(--c-t4)" }}>间距</span>
                    <span style={{ fontSize: 10, color: "var(--c-t3)" }}>{value.gap}px</span>
                  </div>
                  <input
                    type="range" min={12} max={64} step={4}
                    value={value.gap}
                    onChange={(e) => update({ gap: Number(e.target.value) })}
                    className="w-full nodrag"
                    style={{ accentColor: "oklch(0.68 0.22 285)" }}
                  />
                </div>
                {value.pattern !== "lines" && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: "var(--c-t4)" }}>大小</span>
                      <span style={{ fontSize: 10, color: "var(--c-t3)" }}>{value.size}px</span>
                    </div>
                    <input
                      type="range" min={0.5} max={4} step={0.5}
                      value={value.size}
                      onChange={(e) => update({ size: Number(e.target.value) })}
                      className="w-full nodrag"
                      style={{ accentColor: "oklch(0.68 0.22 285)" }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Reset */}
            <button
              onClick={() => { onChange(DEFAULT_CANVAS_BG); saveCanvasBg(DEFAULT_CANVAS_BG); }}
              style={{
                marginTop: 12,
                width: "100%",
                padding: "6px 0",
                borderRadius: 8,
                border: "1px solid var(--c-bd2)",
                background: "transparent",
                color: "var(--c-t4)",
                fontSize: 11,
                cursor: "pointer",
                transition: "all 150ms ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
                (e.currentTarget as HTMLElement).style.color = "var(--c-t2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--c-t4)";
              }}
            >
              恢复默认
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
