import { create } from "zustand";
import { GUIDE_STEPS } from "../lib/guideSteps";

/**
 * 交互式新手导览的全局开关。多处触发（欢迎弹窗「开始导览」、更多菜单「重开导览」、
 * 帮助面板顶部按钮），故用一个轻量 zustand store 承载激活态与当前步号。
 *
 * GuidedTour 组件订阅这里渲染 spotlight；Canvas.tsx 订阅当前步的 openPanel 决定
 * 程序化打开/关闭哪个面板。导览走完或跳过时写 localStorage 记忆（首次不再自动弹），
 * 但用户随时可从菜单重新开始。
 */
export const GUIDE_DONE_KEY = "avc:tour-done:v1";

interface GuideState {
  active: boolean;
  stepIndex: number;
  /** 从第 from 步开始导览（默认 0）。 */
  start: (from?: number) => void;
  next: () => void;
  prev: () => void;
  goTo: (i: number) => void;
  /** 结束导览。done=true 时写入 localStorage 记忆（跳过/完成都算看过）。 */
  stop: (done?: boolean) => void;
}

function markDone() {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(GUIDE_DONE_KEY, "1");
  } catch {
    /* private mode / storage disabled — 记不住无妨，仅影响是否自动再弹 */
  }
}

export const useGuideStore = create<GuideState>((set, get) => ({
  active: false,
  stepIndex: 0,
  start: (from = 0) => set({ active: true, stepIndex: Math.max(0, Math.min(from, GUIDE_STEPS.length - 1)) }),
  next: () => {
    const { stepIndex } = get();
    if (stepIndex >= GUIDE_STEPS.length - 1) {
      markDone();
      set({ active: false, stepIndex: 0 });
    } else {
      set({ stepIndex: stepIndex + 1 });
    }
  },
  prev: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  goTo: (i) => set({ stepIndex: Math.max(0, Math.min(i, GUIDE_STEPS.length - 1)) }),
  stop: (done = false) => {
    if (done) markDone();
    set({ active: false, stepIndex: 0 });
  },
}));

/** 首次访问（未看过欢迎页也未走过导览）时用于决定是否主动提示。 */
export function hasSeenGuide(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(GUIDE_DONE_KEY) === "1";
  } catch {
    return false;
  }
}
