// 导演台「多机位宫格」：绕同一 3D 场景的注视点，按一组相对当前机位的角度偏移渲染多张，
// 落成连好线的分镜节点网格——确定性、免抽卡（对标 LibTV 的「AI 出 N 张」，更可控）。
// 角度为相对当前机位的偏移：az=方位角(度,绕Y)、el=俯仰(度)、dist=距离倍数。

export interface GridAngle { az: number; el: number; dist: number }
export interface GridPreset { key: string; label: string; rows: number; cols: number; angles: GridAngle[] }

// 3×3：上中下三排俯仰 × 左中右三档方位，中心给当前机位。
const NINE: GridAngle[] = [
  { az: -35, el: 12, dist: 1.05 }, { az: 0, el: 14, dist: 1.05 }, { az: 35, el: 12, dist: 1.05 },
  { az: -38, el: 0, dist: 1.0 }, { az: 0, el: 0, dist: 1.0 }, { az: 38, el: 0, dist: 1.0 },
  { az: -32, el: -12, dist: 1.0 }, { az: 0, el: -12, dist: 1.0 }, { az: 32, el: -12, dist: 1.0 },
];

// 5×5：更密的方位×俯仰扫描。
const TWENTYFIVE: GridAngle[] = (() => {
  const azs = [-60, -30, 0, 30, 60];
  const els = [22, 10, 0, -10, -20];
  const out: GridAngle[] = [];
  for (const el of els) for (const az of azs) out.push({ az, el, dist: 1.0 });
  return out;
})();

// 2×2：剧情推进——大全景→中景→近景→反打。
const FOUR: GridAngle[] = [
  { az: 0, el: 6, dist: 1.6 }, { az: -18, el: 2, dist: 1.1 },
  { az: 12, el: -2, dist: 0.72 }, { az: 170, el: 4, dist: 1.15 },
];

// 1×3：角色三视图——正面 / 侧面 / 斜 45°。
const THREE_VIEW: GridAngle[] = [
  { az: 0, el: 0, dist: 1.0 }, { az: 90, el: 0, dist: 1.0 }, { az: 45, el: 4, dist: 1.0 },
];

// 1×3：产品三视图——正面 / 侧面 / 顶视（俯拍）。
const PRODUCT_VIEW: GridAngle[] = [
  { az: 0, el: 0, dist: 1.05 }, { az: 90, el: 0, dist: 1.05 }, { az: 0, el: 82, dist: 1.1 },
];

// 2×4：环绕八向——每 45° 一机位，水平一圈。
const ORBIT8: GridAngle[] = [0, 45, 90, 135, 180, 225, 270, 315].map((az) => ({ az, el: 4, dist: 1.0 }));

export const GRID_PRESETS: GridPreset[] = [
  { key: "nine", label: "多机位九宫格", rows: 3, cols: 3, angles: NINE },
  { key: "four", label: "剧情推进四宫格", rows: 2, cols: 2, angles: FOUR },
  { key: "threeview", label: "角色三视图", rows: 1, cols: 3, angles: THREE_VIEW },
  { key: "product", label: "产品三视图", rows: 1, cols: 3, angles: PRODUCT_VIEW },
  { key: "orbit8", label: "环绕八向", rows: 2, cols: 4, angles: ORBIT8 },
  { key: "twentyfive", label: "25 宫格", rows: 5, cols: 5, angles: TWENTYFIVE },
];

/** 由当前机位的世界坐标 + 注视点 + 角度偏移，算出某个机位的相机世界坐标。 */
export function gridCameraPosition(
  camPos: [number, number, number],
  target: [number, number, number],
  a: GridAngle,
): [number, number, number] {
  const ox = camPos[0] - target[0], oy = camPos[1] - target[1], oz = camPos[2] - target[2];
  const baseDist = Math.max(0.2, Math.hypot(ox, oy, oz));
  const baseAz = Math.atan2(ox, oz);                 // 绕 Y 的方位角
  const baseEl = Math.asin(Math.max(-1, Math.min(1, oy / baseDist)));
  const D = Math.PI / 180;
  const az = baseAz + a.az * D;
  const el = Math.max(-1.45, Math.min(1.45, baseEl + a.el * D));
  const r = baseDist * a.dist;
  return [
    target[0] + r * Math.cos(el) * Math.sin(az),
    target[1] + r * Math.sin(el),
    target[2] + r * Math.cos(el) * Math.cos(az),
  ];
}
