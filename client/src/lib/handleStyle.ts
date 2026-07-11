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

// 触屏(粗指针)无 hover：静止态桩若仍是 scale(0.6)/opacity .55 近乎隐形，用户看不出从哪拉线。
// 粗指针下把「静止态」桩放大、几近全不透明（只影响 resting，不动 valid/invalid/muted/active），
// 配合 ::before inset:-10px 命中区一起提升可发现性。模块加载时判定一次（运行时切换指针罕见）。
const COARSE_POINTER = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

export function handleStyle(color: string, active: boolean, shape: HandleShape = "circle", connect?: HandleConnect): CSSProperties {
  const base: CSSProperties = {
    width: 12,
    height: 12,
    borderWidth: 1.5,
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
          // 轻量化：半透明填充 + 不放大 + 很弱的光晕（原来 selVis 时是实心大绿点，太抢眼）。
          background: `color-mix(in oklch, ${color} 45%, transparent)`,
          borderColor: color,
          opacity: 0.9,
          transform: "scale(1)",
          boxShadow: `0 0 0 2px color-mix(in oklch, ${color} 12%, transparent)`,
        }
      : {
          background: COARSE_POINTER ? color : "transparent",
          borderColor: color,
          opacity: COARSE_POINTER ? 0.92 : 0.55,
          transform: COARSE_POINTER ? "scale(1.02)" : "scale(0.6)",
          boxShadow: COARSE_POINTER ? `0 0 0 3px color-mix(in oklch, ${color} 16%, transparent)` : "none",
        }),
  };
}
