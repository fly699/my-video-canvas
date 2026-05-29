import type { CSSProperties } from "react";

// ── "炫酷" 深色 + 琥珀橙渐变 设计令牌 ──────────────────────────────────────────
// 一套自洽的暗色皮肤，参考 AI Prompt Studio：近黑底、卡片细边、暖橙强调、柔光。
export const C = {
  bg: "#0a0a0c",
  bg2: "#0d0d11",
  surface: "linear-gradient(160deg, #16161c 0%, #101015 100%)",
  surfaceFlat: "#141419",
  elevated: "#1b1b22",
  border: "rgba(255,255,255,0.07)",
  borderStrong: "rgba(255,255,255,0.12)",
  t1: "#f5f5f7",
  t2: "rgba(255,255,255,0.62)",
  t3: "rgba(255,255,255,0.40)",
  t4: "rgba(255,255,255,0.24)",
  accent: "#f59e0b",
  accent2: "#fb923c",
  accentGrad: "linear-gradient(135deg, #f59e0b 0%, #fb7185 120%)",
  accentGradText: "linear-gradient(90deg, #fbbf24, #fb7185)",
  accentSoft: "rgba(245,158,11,0.14)",
  online: "#22c55e",
  offline: "rgba(255,255,255,0.25)",
  danger: "#f87171",
  dangerSoft: "rgba(239,68,68,0.13)",
};

export const card: CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 16,
};

export const accentBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
  border: "none", borderRadius: 10, cursor: "pointer",
  background: C.accentGrad, color: "#1a1205", fontWeight: 700,
  boxShadow: "0 6px 20px rgba(245,158,11,0.25)",
};

export const ghostBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  border: `1px solid ${C.borderStrong}`, borderRadius: 10, cursor: "pointer",
  background: "rgba(255,255,255,0.04)", color: C.t1, fontWeight: 500,
};

export const iconBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
  border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.04)",
  color: C.t1, cursor: "pointer", transition: "all .15s",
};

// 由用户名/ID 派生稳定的头像渐变色
const AVATAR_GRADS = [
  "linear-gradient(135deg,#f59e0b,#ef4444)",
  "linear-gradient(135deg,#8b5cf6,#d946ef)",
  "linear-gradient(135deg,#06b6d4,#3b82f6)",
  "linear-gradient(135deg,#22c55e,#14b8a6)",
  "linear-gradient(135deg,#f43f5e,#f59e0b)",
  "linear-gradient(135deg,#6366f1,#06b6d4)",
];
export function avatarGrad(seed: string | number): string {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_GRADS[h % AVATAR_GRADS.length];
}
export function initials(name: string): string {
  const n = (name || "?").trim();
  return n.slice(0, 2).toUpperCase();
}
