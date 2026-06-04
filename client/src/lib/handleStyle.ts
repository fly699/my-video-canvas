import type { CSSProperties } from "react";

export type HandleShape = "square" | "circle";

/**
 * Shared connection-handle visual style for every node (BaseNode defaults AND the
 * per-node typed handles). At rest (node not hovered/selected) the dot is a small
 * HOLLOW ring — transparent interior, thin colored border, shrunk & dimmed — so it
 * doesn't visually compete with node content. On hover/select it fills with the
 * accent color, enlarges and gains a soft outer glow.
 *
 * `color` accepts any CSS color (hex or oklch); the glow uses `color-mix` so it
 * works regardless of format. Position (top/left/right) is set by the caller.
 */
export function handleStyle(color: string, active: boolean, shape: HandleShape = "circle"): CSSProperties {
  return {
    width: 15,
    height: 15,
    borderWidth: 2,
    borderStyle: "solid",
    boxSizing: "border-box",
    borderRadius: shape === "square" ? 4 : "50%",
    transition: "opacity 150ms ease, transform 150ms ease, box-shadow 150ms ease, background 150ms ease, border-color 150ms ease",
    zIndex: 10,
    ...(active
      ? {
          background: color,
          borderColor: "var(--c-canvas)",
          opacity: 1,
          transform: "scale(1.12)",
          boxShadow: `0 0 0 4px color-mix(in oklch, ${color} 22%, transparent)`,
        }
      : {
          background: "transparent",
          borderColor: color,
          opacity: 0.55,
          transform: "scale(0.6)",
          boxShadow: "none",
        }),
  };
}
