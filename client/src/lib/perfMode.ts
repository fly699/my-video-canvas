import { create } from "zustand";

// ── #81 渲染性能三档开关（适配老旧电脑）────────────────────────────────────────
// 模式：auto（默认，FPS 哨兵自动降档）/ lite（强制流畅）/ quality（强制画质，永不降档）。
// 生效信号只有一个：<html data-perf="lite">，CSS 与组件一律读它——绝不各自判断，
// 保证「哪里降了级」全站一致、可一键回退。原则：只降视觉成本（模糊/阴影/过渡/
// 离屏节点渲染），零功能删减（用户红线：原有优势功能不能丢）。

export type PerfMode = "auto" | "lite" | "quality";
const KEY = "avc:perf-mode";

export const PERF_MODE_LABEL: Record<PerfMode, string> = {
  auto: "自适应", lite: "流畅", quality: "画质",
};
export const PERF_MODE_ORDER: PerfMode[] = ["auto", "lite", "quality"];

export function loadPerfMode(): PerfMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "lite" || v === "quality" || v === "auto") return v;
  } catch { /* SSR/隐私模式 */ }
  return "auto";
}

interface PerfState {
  mode: PerfMode;
  /** auto 模式下 FPS 哨兵触发的自动降档标志（手动切档即清零）。 */
  autoLite: boolean;
  setMode: (m: PerfMode) => void;
  setAutoLite: (v: boolean) => void;
}

export const usePerfStore = create<PerfState>((set) => ({
  mode: loadPerfMode(),
  autoLite: false,
  setMode: (m) => {
    try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
    set({ mode: m, autoLite: false });
  },
  setAutoLite: (v) => set({ autoLite: v }),
}));

/** 当前是否生效 lite（选择器返回原始布尔，zustand「不返回新对象」铁律）。 */
export const selectPerfLite = (s: { mode: PerfMode; autoLite: boolean }): boolean =>
  s.mode === "lite" || (s.mode === "auto" && s.autoLite);

// 单一信号源：store 变化 → <html data-perf>。模块级订阅（不依赖任何组件挂载）。
function applyAttr(s: { mode: PerfMode; autoLite: boolean }) {
  if (typeof document === "undefined") return;
  if (selectPerfLite(s)) document.documentElement.setAttribute("data-perf", "lite");
  else document.documentElement.removeAttribute("data-perf");
}
applyAttr(usePerfStore.getState());
usePerfStore.subscribe(applyAttr);

// ── FPS 哨兵判决（纯函数，单测覆盖）──────────────────────────────────────────
// 进入 lite：连续 4 秒 FPS < 34（真卡才降，避免偶发掉帧误判）；
// 退出 lite：连续 10 秒 FPS > 55（大迟滞防抖动来回切）。samples 为每秒一个的 FPS 序列。
export function sentinelDecide(samples: number[], currentlyLite: boolean): "enter" | "exit" | null {
  if (!currentlyLite) {
    const recent = samples.slice(-4);
    return recent.length === 4 && recent.every((f) => f < 34) ? "enter" : null;
  }
  const recent = samples.slice(-10);
  return recent.length === 10 && recent.every((f) => f > 55) ? "exit" : null;
}
