// #329 连线样式偏好（线宽档位 + 颜色）——【按模式独立存储】：创意 / 专业 / 工作室
// 三种模式各存一份自定义，互不影响；null = 跟随该模式当前内置默认样式
// （创意=1.25px 墨线；专业=2px 源节点类型色；工作室=2.4px 源节点类型色）。
// localStorage 持久化（本地偏好，不跨设备）。
import { create } from "zustand";

const KEY = "avc:edge-style:v2";

export type EdgeStyleModeKey = "creative" | "pro" | "studio";

export interface EdgeStylePref {
  /** 常态线宽 px；null=该模式默认 */
  width: number | null;
  /** 连线颜色（CSS color）；null=该模式默认（创意墨线自动适配深浅底 / 其它模式类型色） */
  color: string | null;
}

export const MODE_LABEL: Record<EdgeStyleModeKey, string> = {
  creative: "创意模式", pro: "专业模式", studio: "工作室模式",
};

/** 线宽档位（v=null 跟随该模式默认）。 */
export const EDGE_WIDTH_OPTIONS: Array<{ label: string; v: number | null }> = [
  { label: "默认", v: null },
  { label: "细", v: 1.25 },
  { label: "标准", v: 1.8 },
  { label: "中粗", v: 2.4 },
  { label: "粗", v: 3.2 },
];

/** 颜色色板（第一项 null=该模式默认；其余为低调 oklch 固定色，深浅底都可辨）。 */
export const EDGE_COLOR_OPTIONS: Array<{ label: string; v: string | null }> = [
  { label: "默认", v: null },
  { label: "白", v: "oklch(0.95 0 0)" },
  { label: "灰", v: "oklch(0.65 0 0)" },
  { label: "黑", v: "oklch(0.28 0 0)" },
  { label: "蓝", v: "oklch(0.62 0.13 255)" },
  { label: "青", v: "oklch(0.66 0.11 200)" },
  { label: "绿", v: "oklch(0.62 0.13 155)" },
  { label: "紫", v: "oklch(0.62 0.13 300)" },
  { label: "橙", v: "oklch(0.68 0.13 60)" },
  { label: "粉", v: "oklch(0.68 0.12 350)" },
];

const EMPTY: EdgeStylePref = { width: null, color: null };

function sanitize(o: unknown): EdgeStylePref {
  const p = (o ?? {}) as Partial<EdgeStylePref>;
  return {
    width: typeof p.width === "number" && p.width >= 0.5 && p.width <= 8 ? p.width : null,
    color: typeof p.color === "string" && p.color.length <= 64 ? p.color : null,
  };
}

function load(): Record<EdgeStyleModeKey, EdgeStylePref> {
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const o = JSON.parse(s) as Partial<Record<EdgeStyleModeKey, unknown>>;
      return { creative: sanitize(o.creative), pro: sanitize(o.pro), studio: sanitize(o.studio) };
    }
  } catch { /* SSR / 隐私模式 / 脏数据 → 全默认 */ }
  return { creative: { ...EMPTY }, pro: { ...EMPTY }, studio: { ...EMPTY } };
}

interface EdgeStyleState {
  prefs: Record<EdgeStyleModeKey, EdgeStylePref>;
  setWidth: (mode: EdgeStyleModeKey, w: number | null) => void;
  setColor: (mode: EdgeStyleModeKey, c: string | null) => void;
}

export const useEdgeStyleStore = create<EdgeStyleState>((set, get) => {
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(get().prefs)); } catch { /* quota */ }
  };
  return {
    prefs: load(),
    setWidth: (mode, w) => {
      set((s) => ({ prefs: { ...s.prefs, [mode]: { ...s.prefs[mode], width: w } } }));
      persist();
    },
    setColor: (mode, c) => {
      set((s) => ({ prefs: { ...s.prefs, [mode]: { ...s.prefs[mode], color: c } } }));
      persist();
    },
  };
});
