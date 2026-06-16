// 内置图标库。每个图标是一段 SVG 内联标记（viewBox 0 0 24 24），主色用 __C__ 占位，
// 选中时替换为当前颜色后写入 shape.svg（复用自定义 SVG 渲染/导出路径）。

export interface IconDef { id: string; label: string; svg: string }

// 简洁的填充型图标（24x24）。__C__ 在选用时替换为颜色。
export const SHAPE_ICONS: IconDef[] = [
  { id: "star", label: "星", svg: `<path fill="__C__" d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z"/>` },
  { id: "heart", label: "心", svg: `<path fill="__C__" d="M12 21s-7.5-4.6-10-9.3C.6 8.9 2 5 5.5 5c2 0 3.4 1.2 4.5 2.6C11.1 6.2 12.5 5 14.5 5 18 5 19.4 8.9 22 11.7 19.5 16.4 12 21 12 21z"/>` },
  { id: "thumbs-up", label: "点赞", svg: `<path fill="__C__" d="M2 10h4v12H2zM22 11a2 2 0 0 0-2-2h-5l1-4a2.5 2.5 0 0 0-4.7-1.4L8 9v13h11a2 2 0 0 0 2-1.6l1-7z"/>` },
  { id: "fire", label: "火焰", svg: `<path fill="__C__" d="M12 2c1 3-1 4-2 6-1 1.7-2 3-2 5a4 4 0 0 0 8 0c0-1-.3-2-1-3 .3 2-1 3-2 3 1-2-.5-3.5-1-5 2 .5 4 2 4 5a6 6 0 1 1-12 0c0-4 3-6 4-8 1-1.5 2-3 2-3z"/>` },
  { id: "bell", label: "铃铛", svg: `<path fill="__C__" d="M12 2a6 6 0 0 0-6 6c0 5-2 6-2 7h16c0-1-2-2-2-7a6 6 0 0 0-6-6zM10 20a2 2 0 0 0 4 0z"/>` },
  { id: "bolt", label: "闪电", svg: `<path fill="__C__" d="M13 2L4 14h6l-1 8 9-12h-6z"/>` },
  { id: "crown", label: "皇冠", svg: `<path fill="__C__" d="M3 7l4 4 5-6 5 6 4-4-2 12H5z"/>` },
  { id: "gift", label: "礼物", svg: `<path fill="__C__" d="M3 8h18v3H3zM4 12h7v9H5a1 1 0 0 1-1-1zM13 12h7v8a1 1 0 0 1-1 1h-6zM12 3a2.5 2.5 0 0 1 4 2.5V7h-3zM12 3a2.5 2.5 0 0 0-4 2.5V7h3z"/>` },
  { id: "location", label: "定位", svg: `<path fill="__C__" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/>` },
  { id: "camera", label: "相机", svg: `<path fill="__C__" d="M9 4l-2 2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3l-2-2zM12 18a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/>` },
  { id: "music", label: "音符", svg: `<path fill="__C__" d="M9 18a3 3 0 1 1-2-2.8V4l11-2v12a3 3 0 1 1-2-2.8V6L9 7.2z"/>` },
  { id: "check", label: "对勾", svg: `<path fill="__C__" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14L6 11.2l1.6-1.6 3.2 3.2 5.6-5.6L18 8.8z"/>` },
  { id: "cross", label: "叉号", svg: `<path fill="__C__" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4 12.6L14.6 16 12 13.4 9.4 16 8 14.6 10.6 12 8 9.4 9.4 8 12 10.6 14.6 8 16 9.4 13.4 12z"/>` },
  { id: "play", label: "播放", svg: `<path fill="__C__" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9 8l8 4-8 4z"/>` },
  { id: "speech", label: "对话", svg: `<path fill="__C__" d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>` },
  { id: "diamond", label: "钻石", svg: `<path fill="__C__" d="M6 3h12l4 6-10 12L2 9z"/>` },
  { id: "sun", label: "太阳", svg: `<circle cx="12" cy="12" r="5" fill="__C__"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M20 4l-2 2M6 18l-2 2" stroke="__C__" stroke-width="2" stroke-linecap="round" fill="none"/>` },
  { id: "flag", label: "旗帜", svg: `<path fill="__C__" d="M5 3v18M5 4h12l-2 4 2 4H5z"/>` },
];

/** 把图标主色占位替换为指定颜色，得到可直接放进 shape.svg 的内联标记。 */
export function iconSvg(def: IconDef, color: string): string {
  const c = /^#[0-9a-fA-F]{3,8}$|^rgba?\(|^[a-zA-Z]{3,20}$/.test(color) ? color : "#FFD400";
  return def.svg.replace(/__C__/g, c);
}
