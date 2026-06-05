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
/** During a connection drag, how this handle relates to the drag:
 *  - "valid":   could legally complete the connection → highlight (green glow)
 *  - "invalid": cannot complete it → fade out
 *  - "muted":   the opposite-direction handle on a candidate node → dim
 *  - undefined: no drag in progress → normal hover/active styling */
export type HandleConnect = "valid" | "invalid" | "muted" | undefined;

const VALID_GREEN = "oklch(0.74 0.18 150)";

export function handleStyle(color: string, active: boolean, shape: HandleShape = "circle", connect?: HandleConnect): CSSProperties {
  const base: CSSProperties = {
    width: 15,
    height: 15,
    borderWidth: 2,
    borderStyle: "solid",
    boxSizing: "border-box",
    borderRadius: shape === "square" ? 4 : "50%",
    transition: "opacity 150ms ease, transform 150ms ease, box-shadow 150ms ease, background 150ms ease, border-color 150ms ease",
    zIndex: 10,
  };
  // A drag is in progress → connection-affordance styling overrides hover/active.
  if (connect === "valid") {
    return { ...base, background: VALID_GREEN, borderColor: "var(--c-canvas)", opacity: 1, transform: "scale(1.3)", boxShadow: `0 0 0 5px color-mix(in oklch, ${VALID_GREEN} 30%, transparent)`, zIndex: 11 };
  }
  if (connect === "invalid") {
    return { ...base, background: "transparent", borderColor: color, opacity: 0.1, transform: "scale(0.5)", boxShadow: "none" };
  }
  if (connect === "muted") {
    return { ...base, background: "transparent", borderColor: color, opacity: 0.2, transform: "scale(0.5)", boxShadow: "none" };
  }
  return {
    ...base,
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
