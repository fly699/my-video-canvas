// #327 导演台动画层批1：时间线/关键帧/轨迹的纯函数（插值·缓动·样条·运镜预设·导出）。
// 全部无副作用、不依赖 three.js，便于单测与在 UI/回放/导出三处复用。
// 数据类型见 shared/types.ts（DirectorTimeline / DirectorTrack / DirectorChannel /
// DirectorKeyframe / DirectorPath / DirectorExportData）。

import type {
  Bezier,
  DirectorChannel,
  DirectorExportData,
  DirectorKeyframe,
  DirectorPath,
  DirectorScene,
  DirectorTimeline,
  DirectorTrack,
  Vec3,
} from "../../../shared/types";

// ── 基础工具 ────────────────────────────────────────────────────────────────
export const LINEAR: Bezier = [0, 0, 1, 1];
const EPS = 1e-6;

/** 常用缓动预设（CSS cubic-bezier 语义）——供曲线编辑器「缓动预设库」下拉直接取用。 */
export const EASING_PRESETS: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  easeInBack: [0.36, 0, 0.66, -0.56],
  easeOutBack: [0.34, 1.56, 0.64, 1],
};

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
const clamp01 = (v: number) => clamp(v, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

// ── 三次贝塞尔缓动 ──────────────────────────────────────────────────────────
// 曲线过 (0,0),(p1x,p1y),(p2x,p2y),(1,1)。输入进度 t 视作 x，解出参数 s 使 Cx(s)=t，
// 返回 Cy(s)。采用与浏览器 UnitBezier 一致的 Newton-Raphson + 二分兜底。
/** 三次贝塞尔缓动求值：t∈[0,1] → 缓动后进度∈[0,1]。 */
export function bezierEase(t: number, bez: Bezier = LINEAR): number {
  const x = clamp01(t);
  const [p1x, p1y, p2x, p2y] = bez;
  // 线性快路径
  if (p1x === 0 && p1y === 0 && p2x === 1 && p2y === 1) return x;
  if (p1x === p1y && p2x === p2y) return x; // 对角线控制点 = 线性

  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const curveX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const curveY = (s: number) => ((ay * s + by) * s + cy) * s;
  const derivX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;

  // Newton-Raphson
  let s = x;
  for (let i = 0; i < 8; i++) {
    const xErr = curveX(s) - x;
    if (Math.abs(xErr) < EPS) return curveY(s);
    const d = derivX(s);
    if (Math.abs(d) < EPS) break;
    s -= xErr / d;
  }
  // 二分兜底
  let lo = 0;
  let hi = 1;
  s = x;
  while (lo < hi) {
    const xv = curveX(s);
    if (Math.abs(xv - x) < EPS) break;
    if (xv < x) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
    if (hi - lo < EPS) break;
  }
  return curveY(s);
}

// ── 通道插值 ────────────────────────────────────────────────────────────────
/** 关键帧数组在 time 处插值（含段缓动、端点夹取、无帧回退 null）。 */
export function sampleKeyframes(kfs: DirectorKeyframe[], time: number): number | null {
  if (!kfs || kfs.length === 0) return null;
  if (kfs.length === 1) return kfs[0].value;
  // 假定已按 time 升序（addKeyframe 维护）；仍做端点夹取
  if (time <= kfs[0].time) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (time >= last.time) return last.value;
  for (let i = 0; i < kfs.length - 1; i++) {
    const k0 = kfs[i];
    const k1 = kfs[i + 1];
    if (time >= k0.time && time <= k1.time) {
      const span = k1.time - k0.time;
      if (span <= EPS) return k1.value;
      const localT = (time - k0.time) / span;
      const eased = bezierEase(localT, k0.easing ?? LINEAR);
      return lerp(k0.value, k1.value, eased);
    }
  }
  return last.value;
}

/** 单通道在 time 处的值（无帧回退 null）。 */
export function sampleChannel(channel: DirectorChannel, time: number): number | null {
  return sampleKeyframes(channel.keyframes, time);
}

// ── 样条路径采样 ────────────────────────────────────────────────────────────
function segmentInfo(path: DirectorPath): { segCount: number; closed: boolean } {
  const n = path.points.length;
  const closed = !!path.closed && n >= 3;
  if (path.kind === "bezier") {
    // 折贝塞尔：points = [P0, C1, C2, P3, C4, C5, P6, ...]，每段消耗 3 点
    return { segCount: Math.max(1, Math.floor((n - 1) / 3)), closed: false };
  }
  return { segCount: closed ? n : Math.max(1, n - 1), closed };
}

function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    out[i] =
      0.5 *
      (2 * p1[i] +
        (-p0[i] + p2[i]) * t +
        (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
        (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  }
  return [out[0], out[1], out[2]];
}

function cubicBezierPoint(p0: Vec3, c1: Vec3, c2: Vec3, p3: Vec3, t: number): Vec3 {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return [
    w0 * p0[0] + w1 * c1[0] + w2 * c2[0] + w3 * p3[0],
    w0 * p0[1] + w1 * c1[1] + w2 * c2[1] + w3 * p3[1],
    w0 * p0[2] + w1 * c1[2] + w2 * c2[2] + w3 * p3[2],
  ];
}

/** 样条在全局参数 u∈[0,1] 处的位置。points<2 时回退首点/原点。 */
export function samplePath(path: DirectorPath, u: number): Vec3 {
  const pts = path.points;
  if (!pts || pts.length === 0) return [0, 0, 0];
  if (pts.length === 1) return [...pts[0]] as Vec3;
  const { segCount, closed } = segmentInfo(path);
  const uu = clamp01(u);
  const scaled = uu * segCount;
  let seg = Math.floor(scaled);
  let localT = scaled - seg;
  if (seg >= segCount) {
    seg = segCount - 1;
    localT = 1;
  }

  if (path.kind === "linear") {
    const a = pts[seg];
    const b = pts[closed ? (seg + 1) % pts.length : seg + 1];
    return lerpVec(a, b, localT);
  }
  if (path.kind === "bezier") {
    const base = seg * 3;
    const p0 = pts[base];
    const c1 = pts[base + 1];
    const c2 = pts[base + 2];
    const p3 = pts[base + 3];
    if (!p3) return [...pts[pts.length - 1]] as Vec3;
    return cubicBezierPoint(p0, c1, c2, p3, localT);
  }
  // catmullrom
  const n = pts.length;
  const idx = (i: number) => (closed ? ((i % n) + n) % n : clamp(i, 0, n - 1));
  const p0 = pts[idx(seg - 1)];
  const p1 = pts[idx(seg)];
  const p2 = pts[idx(seg + 1)];
  const p3 = pts[idx(seg + 2)];
  return catmullRom(p0, p1, p2, p3, localT);
}

/** 样条在 u 处的单位切线（有限差分）——供 orient="velocity" 朝向推导。 */
export function pathTangent(path: DirectorPath, u: number): Vec3 {
  const h = 1e-3;
  const a = samplePath(path, clamp01(u - h));
  const b = samplePath(path, clamp01(u + h));
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < EPS) return [0, 0, 1];
  return [d[0] / len, d[1] / len, d[2] / len];
}

// ── 合成对象在 time 的完整变换 ──────────────────────────────────────────────
export interface TransformBase {
  position: Vec3;
  rotation?: Vec3;      // 欧拉角(度)
  scale?: number;       // 标量缩放
  fov?: number;
  focus?: Vec3;         // 相机注视点
}

export interface SampledTransform {
  position: Vec3;
  rotation: Vec3;       // 度
  scale: number;
  fov: number;
  focus: Vec3;
  opacity: number;
}

function channelOf(track: DirectorTrack, prop: DirectorChannel["prop"], axis?: "x" | "y" | "z") {
  return track.channels.find((c) => c.prop === prop && c.axis === axis);
}

function axisValue(
  track: DirectorTrack,
  prop: DirectorChannel["prop"],
  axisIdx: 0 | 1 | 2,
  time: number,
  fallback: number,
): number {
  const axis = (["x", "y", "z"] as const)[axisIdx];
  const ch = channelOf(track, prop, axis);
  if (!ch) return fallback;
  const v = sampleChannel(ch, time);
  return v == null ? fallback : v;
}

function scalarValue(
  track: DirectorTrack,
  prop: DirectorChannel["prop"],
  time: number,
  fallback: number,
): number {
  const ch = channelOf(track, prop);
  if (!ch) return fallback;
  const v = sampleChannel(ch, time);
  return v == null ? fallback : v;
}

const DEG = 180 / Math.PI;

/** 面向目标点的欧拉角(度)：仅算 yaw(绕Y) + pitch(绕X)，from 看向 to。 */
export function lookAtEuler(from: Vec3, to: Vec3): Vec3 {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const yaw = Math.atan2(dx, dz) * DEG;
  const horiz = Math.hypot(dx, dz);
  const pitch = Math.atan2(dy, horiz) * DEG;
  return [pitch, yaw, 0];
}

export interface SampleOpts {
  span?: [number, number];  // 路径参数映射区间(秒)；缺省取 track.clip，再缺省 [0,1]
  lookAtPos?: Vec3;         // orient="lookAt" 的注视目标世界坐标（由上层按 lookAtId 解析）
}

/** 合成某轨道在 time(秒) 的完整变换（path 优先驱动 position/朝向；channels 覆盖各分量）。 */
export function sampleTransformAt(
  track: DirectorTrack,
  time: number,
  base: TransformBase,
  opts: SampleOpts = {},
): SampledTransform {
  const baseRot = base.rotation ?? [0, 0, 0];
  const baseScale = base.scale ?? 1;
  const baseFov = base.fov ?? 50;
  const baseFocus = base.focus ?? [0, 0, 0];

  let position: Vec3;
  let rotation: Vec3 = [
    axisValue(track, "rotation", 0, time, baseRot[0]),
    axisValue(track, "rotation", 1, time, baseRot[1]),
    axisValue(track, "rotation", 2, time, baseRot[2]),
  ];

  if (track.path && track.path.points.length >= 2) {
    const [start, end] = opts.span ?? (track.clip ? [track.clip.start, track.clip.end] : [0, 1]);
    const span = end - start;
    const u = span > EPS ? clamp01((time - start) / span) : 0;
    position = samplePath(track.path, u);
    if (track.path.orient === "velocity") {
      const tan = pathTangent(track.path, u);
      rotation = [rotation[0], Math.atan2(tan[0], tan[2]) * DEG, rotation[2]];
    } else if (track.path.orient === "lookAt" && opts.lookAtPos) {
      rotation = lookAtEuler(position, opts.lookAtPos);
    }
  } else {
    position = [
      axisValue(track, "position", 0, time, base.position[0]),
      axisValue(track, "position", 1, time, base.position[1]),
      axisValue(track, "position", 2, time, base.position[2]),
    ];
  }

  const focus: Vec3 = [
    axisValue(track, "focus", 0, time, baseFocus[0]),
    axisValue(track, "focus", 1, time, baseFocus[1]),
    axisValue(track, "focus", 2, time, baseFocus[2]),
  ];

  return {
    position,
    rotation,
    scale: scalarValue(track, "uniformScale", time, baseScale),
    fov: scalarValue(track, "fov", time, baseFov),
    focus,
    opacity: scalarValue(track, "opacity", time, 1),
  };
}

// ── 关键帧编辑（纯函数，返回新数组） ────────────────────────────────────────
/** 插入/替换关键帧（同 time 内 EPS 视为同帧，替换其 value/easing），保持升序。 */
export function addKeyframe(kfs: DirectorKeyframe[], kf: DirectorKeyframe): DirectorKeyframe[] {
  const out = kfs.filter((k) => Math.abs(k.time - kf.time) > EPS);
  out.push({ ...kf });
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** 删除 time 附近的关键帧。 */
export function removeKeyframeAt(kfs: DirectorKeyframe[], time: number, eps = 1e-4): DirectorKeyframe[] {
  return kfs.filter((k) => Math.abs(k.time - time) > eps);
}

/** 把 fromTime 附近的关键帧移到 toTime（若目标已有帧则合并覆盖）。 */
export function moveKeyframe(
  kfs: DirectorKeyframe[],
  fromTime: number,
  toTime: number,
  eps = 1e-4,
): DirectorKeyframe[] {
  const target = kfs.find((k) => Math.abs(k.time - fromTime) <= eps);
  if (!target) return kfs;
  const rest = kfs.filter((k) => Math.abs(k.time - fromTime) > eps);
  return addKeyframe(rest, { ...target, time: Math.max(0, toTime) });
}

/** 整体缩放关键帧时间（改片段时长/整体拉伸），factor>0。 */
export function scaleKeyframes(kfs: DirectorKeyframe[], factor: number): DirectorKeyframe[] {
  const f = Math.max(EPS, factor);
  return kfs.map((k) => ({ ...k, time: k.time * f }));
}

/** 整条时间线重定时到新总时长（所有关键帧按比例缩放；path 不变）。 */
export function retimeTimeline(timeline: DirectorTimeline, newDuration: number): DirectorTimeline {
  const old = timeline.duration;
  const factor = old > EPS ? newDuration / old : 1;
  return {
    ...timeline,
    duration: newDuration,
    tracks: timeline.tracks.map((tr) => ({
      ...tr,
      clip: tr.clip ? { start: tr.clip.start * factor, end: tr.clip.end * factor } : tr.clip,
      channels: tr.channels.map((c) => ({ ...c, keyframes: scaleKeyframes(c.keyframes, factor) })),
    })),
  };
}

// ── 运镜预设 → 关键帧 ───────────────────────────────────────────────────────
export type CameraPreset =
  | "orbit"     // 环绕（360°）
  | "arc"       // 半弧（180°）
  | "dollyIn"   // 推近
  | "dollyOut"  // 拉远
  | "crane"     // 升降
  | "truck"     // 横移
  | "spiral"    // 螺旋上升
  // #330→批5 扩充（超越 liblib 固定 7 种）：
  | "handheld"  // 手持抖动（确定性多频抖动，非随机）
  | "whipPan"   // 甩镜（焦点绕机位快速水平扫过）
  | "dollyZoom" // 变焦推（希区柯克：推近同时 FOV 变宽保持主体大小）
  | "follow"    // 跟随（机位+焦点同步侧移跟拍）
  | "dive";     // 俯冲（下降并推向注视点）

/** 12 种运镜预设的中文标签（UI 网格用；顺序即展示顺序）。 */
export const CAMERA_PRESET_LABELS: { key: CameraPreset; label: string; icon: string }[] = [
  { key: "orbit", label: "环绕", icon: "⟳" },
  { key: "arc", label: "半弧", icon: "◜" },
  { key: "dollyIn", label: "推近", icon: "⊕" },
  { key: "dollyOut", label: "拉远", icon: "⊖" },
  { key: "crane", label: "升降", icon: "↕" },
  { key: "truck", label: "横移", icon: "↔" },
  { key: "spiral", label: "螺旋上升", icon: "🌀" },
  { key: "handheld", label: "手持抖动", icon: "〜" },
  { key: "whipPan", label: "甩镜", icon: "⇢" },
  { key: "dollyZoom", label: "变焦推", icon: "◎" },
  { key: "follow", label: "跟随", icon: "⇉" },
  { key: "dive", label: "俯冲", icon: "↘" },
];

export interface PresetBase {
  position: Vec3;   // 机位起点
  target: Vec3;     // 注视点
  fov?: number;     // 当前视角（变焦推 dollyZoom 需要，用于算保持主体大小的目标 FOV）
}

export interface PresetOpts {
  duration: number;
  steps?: number;      // 曲线类采样点数（越多越圆滑），默认 24
  startTime?: number;  // 关键帧起始时间偏移（append 时用）
  amount?: number;     // 幅度：推拉的比例 / 横移升降的米数；缺省按预设合理值
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scaleV(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function vecChannelsFromSamples(
  prop: "position" | "focus",
  samples: { t: number; pos: Vec3 }[],
  easing: Bezier,
): DirectorChannel[] {
  const mk = (axisIdx: 0 | 1 | 2, axis: "x" | "y" | "z"): DirectorChannel => ({
    prop,
    axis,
    keyframes: samples.map((s) => ({ time: s.t, value: s.pos[axisIdx], easing })),
  });
  return [mk(0, "x"), mk(1, "y"), mk(2, "z")];
}
function posChannelsFromSamples(samples: { t: number; pos: Vec3 }[], easing: Bezier): DirectorChannel[] {
  return vecChannelsFromSamples("position", samples, easing);
}
function focusChannelsFromSamples(samples: { t: number; pos: Vec3 }[], easing: Bezier): DirectorChannel[] {
  return vecChannelsFromSamples("focus", samples, easing);
}

/**
 * 运镜预设 → 位置关键帧通道（相机沿轨迹运动，注视点默认保持不变）。
 * 返回 DirectorChannel[]；上层用 applyPreset(track, channels, mode) 合入轨道。
 */
export function presetMoveToKeyframes(
  preset: CameraPreset,
  base: PresetBase,
  opts: PresetOpts,
): DirectorChannel[] {
  const steps = Math.max(2, opts.steps ?? 24);
  const t0 = opts.startTime ?? 0;
  const dur = Math.max(EPS, opts.duration);
  const easing = LINEAR;
  const rel = sub(base.position, base.target); // 机位相对注视点
  const radius = Math.hypot(rel[0], rel[2]);
  const angle0 = Math.atan2(rel[0], rel[2]);
  const height = rel[1];

  const arcSamples = (sweepRad: number, riseY = 0): { t: number; pos: Vec3 }[] => {
    const out: { t: number; pos: Vec3 }[] = [];
    for (let i = 0; i < steps; i++) {
      const p = i / (steps - 1);
      const ang = angle0 + sweepRad * p;
      const y = base.target[1] + height + riseY * p;
      out.push({
        t: t0 + dur * p,
        pos: [base.target[0] + radius * Math.sin(ang), y, base.target[2] + radius * Math.cos(ang)],
      });
    }
    return out;
  };

  const twoPoint = (endPos: Vec3): { t: number; pos: Vec3 }[] => [
    { t: t0, pos: [...base.position] as Vec3 },
    { t: t0 + dur, pos: endPos },
  ];

  switch (preset) {
    case "orbit":
      return posChannelsFromSamples(arcSamples(Math.PI * 2), easing);
    case "arc":
      return posChannelsFromSamples(arcSamples(Math.PI), easing);
    case "spiral":
      return posChannelsFromSamples(arcSamples(Math.PI * 2, opts.amount ?? 2), easing);
    case "dollyIn": {
      const amt = opts.amount ?? 0.6; // 靠近注视点 60%
      const end = add(base.target, scaleV(rel, 1 - amt));
      return posChannelsFromSamples(twoPoint(end), easing);
    }
    case "dollyOut": {
      const amt = opts.amount ?? 0.6; // 后退 60%
      const end = add(base.target, scaleV(rel, 1 + amt));
      return posChannelsFromSamples(twoPoint(end), easing);
    }
    case "crane": {
      const dy = opts.amount ?? 1.5;
      return posChannelsFromSamples(twoPoint([base.position[0], base.position[1] + dy, base.position[2]]), easing);
    }
    case "truck": {
      // 沿视线水平右向量平移（视线在 XZ 平面的右垂直方向）
      const dist = opts.amount ?? 2;
      const viewLen = Math.hypot(rel[0], rel[2]) || 1;
      const right: Vec3 = [rel[2] / viewLen, 0, -rel[0] / viewLen];
      return posChannelsFromSamples(twoPoint(add(base.position, scaleV(right, dist))), easing);
    }
    case "handheld": {
      // 手持抖动：机位在原位附近多频正弦叠加抖动（确定性、无 Math.random，便于单测）。
      const amp = opts.amount ?? 0.06;
      const samples: { t: number; pos: Vec3 }[] = [];
      for (let i = 0; i < steps; i++) {
        const p = i / (steps - 1);
        const ph = p * Math.PI * 2;
        const jx = amp * (Math.sin(ph * 5) * 0.6 + Math.sin(ph * 11 + 1.3) * 0.4);
        const jy = amp * (Math.sin(ph * 7 + 0.7) * 0.5 + Math.sin(ph * 13 + 2.1) * 0.5);
        const jz = amp * 0.4 * Math.sin(ph * 9 + 0.3);
        samples.push({ t: t0 + dur * p, pos: [base.position[0] + jx, base.position[1] + jy, base.position[2] + jz] });
      }
      return posChannelsFromSamples(samples, easing);
    }
    case "whipPan": {
      // 甩镜：焦点绕机位在 XZ 平面快速水平扫过（amount 为扫掠角度，默认 60°）。
      const sweep = ((opts.amount ?? 60) * Math.PI) / 180;
      const relTgt = sub(base.target, base.position);
      const r = Math.hypot(relTgt[0], relTgt[2]) || 1;
      const a0 = Math.atan2(relTgt[0], relTgt[2]);
      const samples: { t: number; pos: Vec3 }[] = [];
      for (let i = 0; i < steps; i++) {
        const p = i / (steps - 1);
        const ang = a0 + sweep * p;
        samples.push({ t: t0 + dur * p, pos: [base.position[0] + r * Math.sin(ang), base.target[1], base.position[2] + r * Math.cos(ang)] });
      }
      return focusChannelsFromSamples(samples, easing);
    }
    case "dollyZoom": {
      // 变焦推（希区柯克 vertigo）：推近同时 FOV 变宽，保持主体大小、改透视。需 base.fov。
      const amt = clamp(opts.amount ?? 0.5, 0.05, 0.9); // 靠近注视点比例
      const end = add(base.target, scaleV(rel, 1 - amt));
      const posCh = posChannelsFromSamples(twoPoint(end), easing);
      const baseFov = base.fov ?? 50;
      const baseHalf = Math.tan(((baseFov * Math.PI) / 180) / 2);
      const endHalf = baseHalf / (1 - amt); // dist*tan(fov/2)=const ⇒ 推近后 fov 变宽
      const endFov = clamp((2 * Math.atan(endHalf) * 180) / Math.PI, 8, 160);
      const fovCh: DirectorChannel = {
        prop: "fov",
        keyframes: [{ time: t0, value: baseFov, easing }, { time: t0 + dur, value: endFov, easing }],
      };
      return [...posCh, fovCh];
    }
    case "follow": {
      // 跟随/横移跟拍：机位与焦点同步侧移（右向量平移），保持构图。
      const dist = opts.amount ?? 2;
      const viewLen = Math.hypot(rel[0], rel[2]) || 1;
      const right: Vec3 = [rel[2] / viewLen, 0, -rel[0] / viewLen];
      const delta = scaleV(right, dist);
      const posCh = posChannelsFromSamples(twoPoint(add(base.position, delta)), easing);
      const focusCh = focusChannelsFromSamples(
        [{ t: t0, pos: [...base.target] as Vec3 }, { t: t0 + dur, pos: add(base.target, delta) }],
        easing,
      );
      return [...posCh, ...focusCh];
    }
    case "dive": {
      // 俯冲：机位下降并推向注视点（升降 + 推近的合成）。
      const drop = opts.amount ?? 1.5;
      const forward = 0.5; // 水平推向注视点 50%
      const horiz = add(base.target, scaleV(rel, 1 - forward));
      const end: Vec3 = [horiz[0], base.position[1] - drop, horiz[2]];
      return posChannelsFromSamples(twoPoint(end), easing);
    }
    default:
      return posChannelsFromSamples(twoPoint([...base.position] as Vec3), easing);
  }
}

/** 把预设通道合入轨道：replace=覆盖同 prop/axis 的通道；append=接到现有关键帧末尾之后。 */
export function applyPreset(
  track: DirectorTrack,
  presetChannels: DirectorChannel[],
  mode: "replace" | "append",
): DirectorTrack {
  if (mode === "replace") {
    const kept = track.channels.filter(
      (c) => !presetChannels.some((p) => p.prop === c.prop && p.axis === c.axis),
    );
    return { ...track, channels: [...kept, ...presetChannels.map((c) => ({ ...c })) ] };
  }
  // append：把预设关键帧时间整体后移到现有该通道末帧之后
  const channels = [...track.channels.map((c) => ({ ...c, keyframes: [...c.keyframes] }))];
  for (const pc of presetChannels) {
    const existing = channels.find((c) => c.prop === pc.prop && c.axis === pc.axis);
    if (!existing) {
      channels.push({ ...pc, keyframes: [...pc.keyframes] });
      continue;
    }
    const lastT = existing.keyframes.length ? existing.keyframes[existing.keyframes.length - 1].time : 0;
    const shifted = pc.keyframes.map((k) => ({ ...k, time: k.time + lastT }));
    existing.keyframes = [...existing.keyframes, ...shifted].sort((a, b) => a.time - b.time);
  }
  return { ...track, channels };
}

// ── 导出用结构化运镜数据 ────────────────────────────────────────────────────
function actorBase(scene: DirectorScene, id: string): TransformBase | null {
  const a = scene.actors.find((x) => x.id === id);
  if (!a) return null;
  return { position: a.position, rotation: a.rotation, scale: a.scale };
}
function cameraBase(scene: DirectorScene, id?: string): TransformBase {
  const cams = scene.cameras ?? [];
  const cam = (id ? cams.find((c) => c.id === id) : undefined) ?? scene.camera;
  return { position: cam.position, focus: cam.target, fov: cam.fov };
}

/**
 * 时间线 → 结构化运镜数据（逐帧采样相机/角色轨道）。喂视频模型作运镜控制或存编排。
 * 帧数 = round(duration*fps)+1（含首尾帧）。
 */
export function timelineToExportData(timeline: DirectorTimeline, scene: DirectorScene): DirectorExportData {
  const fps = Math.max(1, timeline.fps);
  const dur = Math.max(0, timeline.duration);
  const frames = Math.max(1, Math.round(dur * fps));
  const times: number[] = [];
  for (let f = 0; f <= frames; f++) times.push((f / frames) * dur);

  const camera: DirectorExportData["camera"] = [];
  const actors: DirectorExportData["actors"] = [];

  for (const track of timeline.tracks) {
    const span: [number, number] = track.clip ? [track.clip.start, track.clip.end] : [0, dur];
    if (track.targetKind === "camera") {
      const base = cameraBase(scene, track.targetId);
      camera.push({
        id: track.targetId,
        keyframes: times.map((t) => {
          const s = sampleTransformAt(track, t, base, { span });
          return { t, position: s.position, target: s.focus, fov: s.fov };
        }),
      });
    } else {
      const base = actorBase(scene, track.targetId);
      if (!base) continue;
      actors.push({
        id: track.targetId,
        keyframes: times.map((t) => {
          const s = sampleTransformAt(track, t, base, { span });
          return { t, position: s.position, rotation: s.rotation, scale: s.scale };
        }),
      });
    }
  }
  return { duration: dur, fps, camera, actors };
}

// ── 工厂 ────────────────────────────────────────────────────────────────────
/** 默认空时间线（10s / 30fps，无轨道）。 */
export function makeDefaultTimeline(): DirectorTimeline {
  return { duration: 10, fps: 30, loop: true, tracks: [] };
}

/** 为对象建空轨道（无通道/无路径）。 */
export function makeTrack(targetId: string, targetKind: DirectorTrack["targetKind"]): DirectorTrack {
  return { targetId, targetKind, channels: [] };
}

// ── 时间线 UI 辅助（批2）──────────────────────────────────────────────────────
/** 标尺刻度：按像素密度自适应步长（保证相邻主刻度≥minPx），返回各刻度秒值（含 0 与末端）。 */
export function timelineTicks(duration: number, pxPerSec: number, minPx = 64): number[] {
  const dur = Math.max(0, duration);
  if (dur <= 0 || pxPerSec <= 0) return [0];
  // 候选步长（秒）：0.5/1/2/5/10/15/30/60…，选第一个使 step*pxPerSec≥minPx 的。
  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  let step = candidates.find((s) => s * pxPerSec >= minPx);
  if (step == null) step = Math.ceil(minPx / pxPerSec);
  const out: number[] = [];
  for (let t = 0; t <= dur + 1e-6; t += step) out.push(Math.round(t * 1000) / 1000);
  if (out[out.length - 1] < dur - 1e-6) out.push(dur);
  return out;
}

/** 该轨道所有关键帧的时间点（去重升序）——供时间线在轨道行上打◇标记。 */
export function trackKeyframeTimes(track: DirectorTrack): number[] {
  const set = new Set<number>();
  for (const ch of track.channels) for (const k of ch.keyframes) set.add(Math.round(k.time * 1000) / 1000);
  return Array.from(set).sort((a, b) => a - b);
}

/** 秒 → mm:ss.d 展示（如 7.49 → "0:07.5"，含一位小数）。 */
export function fmtTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}:${rem.toFixed(1).padStart(4, "0")}`;
}

// ── 逐轴打帧 / 跳帧 / 设缓动（批3；纯函数，返回新对象）────────────────────────
const KF_EPS = 1e-3;

/** 关键帧数组在 time 附近是否已有帧。 */
export function hasKeyframeAt(kfs: DirectorKeyframe[], time: number, eps = KF_EPS): boolean {
  return kfs.some((k) => Math.abs(k.time - time) <= eps);
}

/** 从时间点集合里找 time 的下一/上一关键帧时间（dir=1 后 / -1 前）；无则 null。 */
export function adjacentKeyframeTime(times: number[], time: number, dir: 1 | -1, eps = KF_EPS): number | null {
  const sorted = [...times].sort((a, b) => a - b);
  if (dir === 1) {
    for (const t of sorted) if (t > time + eps) return t;
    return null;
  }
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i] < time - eps) return sorted[i];
  return null;
}

/** 切换某通道在 time 的关键帧：已有则删、没有则以 value 打帧。空通道会被剔除。返回新轨道。 */
export function toggleKeyframe(
  track: DirectorTrack,
  prop: DirectorChannel["prop"],
  axis: "x" | "y" | "z" | undefined,
  time: number,
  value: number,
  eps = KF_EPS,
): DirectorTrack {
  const channels = track.channels.map((c) => ({ ...c, keyframes: [...c.keyframes] }));
  let ch = channels.find((c) => c.prop === prop && c.axis === axis);
  if (!ch) { ch = { prop, axis, keyframes: [] }; channels.push(ch); }
  ch.keyframes = hasKeyframeAt(ch.keyframes, time, eps)
    ? removeKeyframeAt(ch.keyframes, time, eps)
    : addKeyframe(ch.keyframes, { time, value });
  return { ...track, channels: channels.filter((c) => c.keyframes.length > 0) };
}

/** 把 time 处所有通道关键帧的段缓动设为 easing（liblib「设置曲线」的跨通道套用）。返回新轨道。 */
export function setEasingAt(track: DirectorTrack, time: number, easing: Bezier, eps = KF_EPS): DirectorTrack {
  return {
    ...track,
    channels: track.channels.map((c) => ({
      ...c,
      keyframes: c.keyframes.map((k) => (Math.abs(k.time - time) <= eps ? { ...k, easing } : k)),
    })),
  };
}

/** 读 time 处任一通道关键帧的段缓动（用于回填曲线编辑器）；无则 null。 */
export function easingAt(track: DirectorTrack, time: number, eps = KF_EPS): Bezier | null {
  for (const c of track.channels) {
    const k = c.keyframes.find((x) => Math.abs(x.time - time) <= eps);
    if (k) return k.easing ?? LINEAR;
  }
  return null;
}

/** 对时间线里 targetId 的轨道应用 fn（不存在则先建空轨道）；结果为空轨道（无通道且无 path）会被剔除。 */
export function updateTrackIn(
  timeline: DirectorTimeline,
  targetId: string,
  targetKind: DirectorTrack["targetKind"],
  fn: (t: DirectorTrack) => DirectorTrack,
): DirectorTimeline {
  const idx = timeline.tracks.findIndex((t) => t.targetId === targetId);
  const base = idx >= 0 ? timeline.tracks[idx] : makeTrack(targetId, targetKind);
  const next = fn(base);
  const tracks = idx >= 0 ? timeline.tracks.map((t, i) => (i === idx ? next : t)) : [...timeline.tracks, next];
  return { ...timeline, tracks: tracks.filter((t) => t.channels.length > 0 || (t.path && t.path.points.length >= 2)) };
}

/** 某类对象可 K 帧的通道定义（右面板逐轴打帧用）。 */
export interface ChannelDef { prop: DirectorChannel["prop"]; axis?: "x" | "y" | "z"; label: string }
export function channelsForKind(kind: DirectorTrack["targetKind"]): ChannelDef[] {
  const xyz = (prop: DirectorChannel["prop"], base: string): ChannelDef[] =>
    (["x", "y", "z"] as const).map((axis) => ({ prop, axis, label: `${base}.${axis.toUpperCase()}` }));
  if (kind === "camera") {
    return [
      ...xyz("position", "位置"),
      ...xyz("focus", "焦点"),
      { prop: "fov", label: "视角(FOV)" },
    ];
  }
  return [
    ...xyz("position", "位置"),
    ...xyz("rotation", "旋转"),
    { prop: "uniformScale", label: "缩放" },
  ];
}
