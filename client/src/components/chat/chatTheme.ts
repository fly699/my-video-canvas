import type { CSSProperties } from "react";

// ── 扁平配色：跟随应用主题（CSS 变量），仅强调色固定为琥珀橙 ───────────────────
// 这样 /chat 页面与画布内悬浮窗都会随页面 10 套主题切换；无渐变、无大面积彩填。
// NOTE: do NOT use var(--c-canvas) — the canvas page overrides it to the user's
// background-color picker value, which would hijack the chat window's bg. Use
// the theme surface vars (like nodes do) so the chat follows the theme proper.
export const C = {
  bg: "var(--c-surface, #16161b)",
  bg2: "var(--c-surface, #14141a)",
  surface: "var(--c-elevated, #1b1b22)",
  surfaceFlat: "var(--c-elevated, #1b1b22)",
  elevated: "var(--c-elevated, #1c1c22)",
  border: "var(--c-bd2, rgba(128,128,128,0.18))",
  borderStrong: "var(--c-bd3, rgba(128,128,128,0.32))",
  t1: "var(--c-t1, #ededf0)",
  t2: "var(--c-t2, rgba(140,140,150,0.9))",
  t3: "var(--c-t3, rgba(140,140,150,0.7))",
  t4: "var(--c-t4, rgba(140,140,150,0.5))",
  accent: "#f59e0b",
  accent2: "#f7b955",
  accentSoft: "rgba(245,158,11,0.14)",
  online: "#22c55e",
  offline: "rgba(140,140,150,0.4)",
  danger: "#f87171",
  dangerSoft: "rgba(239,68,68,0.12)",
};

export const card: CSSProperties = {
  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
};

export const iconBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 34, height: 34, borderRadius: 9, flexShrink: 0,
  border: `1px solid ${C.border}`, background: C.elevated,
  color: C.t1, cursor: "pointer", transition: "all .12s",
};

export const ghostBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  border: `1px solid ${C.border}`, borderRadius: 9, cursor: "pointer",
  background: C.elevated, color: C.t1, fontWeight: 500,
};

// 小按钮的强调样式：描边为主，不做大面积填充
export const accentBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  border: `1px solid ${C.accent}`, borderRadius: 9, cursor: "pointer",
  background: C.accentSoft, color: C.accent, fontWeight: 600,
};

// 头像/标识用的低饱和纯色（无渐变）
const AVATAR_COLORS = ["#c2792b", "#7c6fb0", "#3f86a8", "#4a9a73", "#b06a86", "#5a73b8"];
export function avatarGrad(seed: string | number): string {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export function initials(name: string): string {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}
