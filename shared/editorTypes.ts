// ── Video Editor EDL (Edit Decision List) ────────────────────────────────────
// The front-end timeline editor produces an `EditorDoc`; the server renders it
// in a SINGLE ffmpeg `-filter_complex` pass on export, so chaining many edits no
// longer re-encodes repeatedly (the core reason for the dedicated editor).
//
// All time values are in seconds. Positions/sizes for overlays are normalized
// (0..1) relative to the output canvas so the EDL is resolution-independent.

export const EDITOR_DOC_VERSION = 1 as const;

export type TrackType = "video" | "audio" | "text" | "overlay";
export type ClipKind = "video" | "image" | "audio" | "text" | "shape";

/** Vector shape overlay (drawn via ffmpeg drawbox on export; div in preview).
 *  Position is the clip's transform x/y (top-left); size is w/h (canvas fraction). */
export interface ClipShape {
  type: "rect";          // v1: rectangle (filled or outline). 矩形：高亮框/打码块/色块/分隔条
  color?: string;        // #RRGGBB
  fill?: boolean;        // true=填充, false=描边
  lineWidth?: number;    // 描边粗细 px（fill=false 时）
  opacity?: number;      // 0..1
  w?: number;            // normalized width (fraction of canvas)
  h?: number;            // normalized height
}

// Values map 1:1 to ffmpeg xfade transition names (verified on ffmpeg 6.1.1), plus
// "none" and the legacy aliases "slide"/"wipe" (kept for older saved projects).
export type TransitionType =
  | "none" | "slide" | "wipe" // legacy aliases
  | "fade" | "fadeblack" | "fadewhite" | "dissolve"
  | "wipeleft" | "wiperight" | "wipeup" | "wipedown"
  | "slideleft" | "slideright" | "slideup" | "slidedown"
  | "smoothleft" | "smoothright" | "circleopen" | "circleclose"
  | "circlecrop" | "rectcrop" | "radial" | "pixelize" | "zoomin"
  | "diagtl" | "diagbr" | "hlslice" | "squeezeh" | "squeezev"
  | "fadegrays" | "hblur";

/** How a visual clip fills the output frame.
 *  contain = 适应（完整显示，留黑边）; cover = 填充（铺满，裁剪溢出）; stretch = 拉伸（变形铺满）;
 *  blur = 模糊填充（原画完整居中，放大模糊的同画面铺满作背景，消除黑边）;
 *  none = 原始 1:1（源生分辨率不缩放，居中——小留黑、大居中裁切）. */
export type FitMode = "contain" | "cover" | "stretch" | "blur" | "none";

/** Preset color/filter adjustments applied to a visual clip. */
export interface ClipEffects {
  brightness?: number;  // -1..1   (ffmpeg eq brightness)
  contrast?: number;    // 0..2    (eq contrast, 1 = neutral)
  saturation?: number;  // 0..3    (eq saturation, 1 = neutral)
  filter?: string;      // named LUT/preset, e.g. "cinematic" | "vintage" | "cool" | "warm"
}

/** Position/size for overlay/PiP/text clips, normalized to the output canvas. */
export interface ClipTransform {
  x?: number;        // 0..1, left edge (0 = left, fraction of width)
  y?: number;        // 0..1, top edge
  scale?: number;    // 0..1+ relative to canvas (1 = full width)
  opacity?: number;  // 0..1
  rotation?: number; // degrees
}

export interface ClipText {
  content: string;
  font?: string;
  size?: number;        // px at output resolution
  color?: string;       // CSS fill color
  bgColor?: string;     // optional text background box
  motionStyle?: "none" | "fade" | "roll" | "karaoke" | "bounce" | "slideup" | "slidedown" | "pop";
  // ── rich styling (preview via CSS; export via ASS override tags) ──
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  strokeColor?: string; // 描边色
  strokeWidth?: number; // 描边粗细 (px @ output res, 0 = none)
  shadow?: boolean;     // 投影
  shadowColor?: string; // 投影色 (default semi-black)
}

/** Keyframe interpolation curve. Controls the segment LEAVING a keyframe (kf→next):
 *  linear=匀速; in=缓入(慢起加速); out=缓出(快起减速); inout=缓入缓出(S 曲线). */
export type EaseType = "linear" | "in" | "out" | "inout";

/** Apply an easing curve to a normalized progress `r`∈[0,1]. Pure; shared by the
 *  preview interpolation and (as an expression) the ffmpeg export. */
export function applyEase(r: number, ease: EaseType | undefined): number {
  const x = r <= 0 ? 0 : r >= 1 ? 1 : r;
  switch (ease) {
    case "in": return x * x;               // 二次缓入
    case "out": return x * (2 - x);        // 二次缓出
    case "inout": return x * x * (3 - 2 * x); // smoothstep S 曲线
    default: return x;                     // linear
  }
}

/** A transform keyframe: `t` seconds from the clip's start; any subset of the
 *  transform fields it animates. Between keyframes, values interpolate with the
 *  start keyframe's `ease` curve (default linear). */
export interface TransformKeyframe {
  t: number;         // seconds from the clip start
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
  rotation?: number;
  ease?: EaseType;   // 补间曲线（作用于本关键帧→下一关键帧的区间），缺省 linear
}

export interface Clip {
  id: string;
  kind: ClipKind;
  assetId?: number;
  assetUrl?: string;        // source media URL (own-storage or external)
  start: number;            // position on the timeline (seconds)
  trimIn: number;           // source in-point (seconds)
  trimOut: number;          // source out-point (seconds); for image/text = display duration from start
  speed?: number;           // 0.25..4, default 1
  reverse?: boolean;        // 倒放：视频/音频逆序播放（图片无效）
  flipH?: boolean;          // 水平镜像（左右翻转）
  flipV?: boolean;          // 垂直翻转（上下翻转）
  volume?: number;          // 0..2, default 1 (audio/video)
  fadeIn?: number;          // seconds
  fadeOut?: number;         // seconds
  fadeCurve?: "tri" | "qsin" | "hsin" | "log" | "exp"; // 音频淡变曲线（默认 tri=线性）
  ducking?: boolean;        // audio: 背景音乐，遇人声(其余音频)自动闪避压低
  denoise?: boolean;        // audio: FFT 降噪（afftdn），清理底噪/嗡声
  chromaKey?: { color?: string; similarity?: number; blend?: number }; // overlay 绿幕抠像
  transitionIn?: { type: TransitionType; duration: number };
  effects?: ClipEffects;
  transform?: ClipTransform;
  /** Transform animation keyframes (position/scale/opacity/rotation over time).
   *  When present, they override the static `transform` for the animated fields. */
  keyframes?: TransformKeyframe[];
  fit?: FitMode;            // how a full-frame visual clip fills the canvas (default contain)
  text?: ClipText;
  shape?: ClipShape;        // 矢量形状叠加（kind === "shape"）
}

/** The effective transform of a clip at `tIntoClip` seconds from its start —
 *  the static `transform` with any keyframed fields linearly interpolated. */
export function transformAt(clip: Clip, tIntoClip: number): ClipTransform {
  const base: ClipTransform = { ...(clip.transform ?? {}) };
  const kfs = clip.keyframes;
  if (!kfs || kfs.length === 0) return base;
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  const fields = ["x", "y", "scale", "opacity", "rotation"] as const;
  for (const f of fields) {
    const pts = sorted.filter((k) => k[f] != null);
    if (pts.length === 0) continue;
    if (tIntoClip <= pts[0].t) { base[f] = pts[0][f]; continue; }
    if (tIntoClip >= pts[pts.length - 1].t) { base[f] = pts[pts.length - 1][f]; continue; }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (tIntoClip >= a.t && tIntoClip <= b.t) {
        const r = (tIntoClip - a.t) / Math.max(1e-6, b.t - a.t);
        base[f] = (a[f] as number) + ((b[f] as number) - (a[f] as number)) * applyEase(r, a.ease);
        break;
      }
    }
  }
  return base;
}

export interface Track {
  id: string;
  type: TrackType;
  muted?: boolean;   // 静音：本轨音频不计入导出/预览
  hidden?: boolean;  // 隐藏：本轨画面不参与渲染
  locked?: boolean;  // 锁定：禁止在时间轴上选中/拖动/裁剪
  name?: string;     // optional custom label
  clips: Clip[];
}

export interface EditorDoc {
  version: typeof EDITOR_DOC_VERSION;
  width: number;   // output canvas width  (e.g. 1080)
  height: number;  // output canvas height (e.g. 1920)
  fps: number;     // output fps (e.g. 30)
  normalizeAudio?: boolean; // 导出时把最终音轨响度归一化到 -14 LUFS（流媒体标准）
  masterFadeIn?: number;    // 整片开头淡入（秒，从黑+静音渐显），0/缺省=关
  masterFadeOut?: number;   // 整片结尾淡出（秒，渐隐到黑+静音），0/缺省=关
  tracks: Track[];
}

/** A sensible empty document for a freshly created editor session. */
export function emptyEditorDoc(width = 1920, height = 1080, fps = 30): EditorDoc {
  return {
    version: EDITOR_DOC_VERSION,
    width,
    height,
    fps,
    tracks: [
      { id: "v1", type: "video", clips: [] },
      { id: "ov1", type: "overlay", clips: [] },
      { id: "t1", type: "text", clips: [] },
      { id: "a1", type: "audio", clips: [] },
    ],
  };
}

/** Visible duration of a clip on the timeline (seconds), accounting for speed. */
export function clipVisibleDuration(c: Clip): number {
  return Math.max(0.05, (c.trimOut - c.trimIn) / (c.speed ?? 1));
}

/** Produce a new doc containing only the [start, end] slice of the timeline:
 *  clips outside are dropped, clips crossing a boundary are trimmed, and everything
 *  is shifted so the slice begins at 0. Pure — used for "export selected range".
 *  Image/text clips are duration-encoded (trimOut = display seconds), so they're
 *  shortened directly; video/audio map the cut back to source trimIn/trimOut. */
export function sliceEditorDoc(doc: EditorDoc, start: number, end: number): EditorDoc {
  const lo = Math.max(0, Math.min(start, end));
  const hi = Math.max(start, end);
  const tracks = doc.tracks.map((t) => ({
    ...t,
    clips: t.clips.flatMap((c): Clip[] => {
      const dur = clipVisibleDuration(c);
      const cStart = c.start, cEnd = c.start + dur;
      if (cEnd <= lo || cStart >= hi) return []; // fully outside the slice
      const newStartTL = Math.max(cStart, lo);
      const newEndTL = Math.min(cEnd, hi);
      const leftTrim = newStartTL - cStart;   // timeline secs cut from the left
      const rightTrim = cEnd - newEndTL;       // timeline secs cut from the right
      const speed = c.speed ?? 1;
      const durationBased = c.kind === "image" || c.kind === "text";
      const newTrimIn = durationBased ? 0 : c.trimIn + leftTrim * speed;
      const newTrimOut = durationBased ? Math.max(0.05, newEndTL - newStartTL) : c.trimOut - rightTrim * speed;
      // keyframes are clip-relative timeline seconds → shift by -leftTrim, drop those
      // that fall outside the surviving span.
      const newDurTL = newEndTL - newStartTL;
      const keyframes = c.keyframes
        ? c.keyframes.map((k) => ({ ...k, t: k.t - leftTrim })).filter((k) => k.t >= -1e-6 && k.t <= newDurTL + 1e-6)
        : undefined;
      return [{ ...c, start: newStartTL - lo, trimIn: newTrimIn, trimOut: newTrimOut, ...(keyframes ? { keyframes } : {}) }];
    }),
  }));
  return { ...doc, tracks };
}

/** Total timeline duration (seconds) = furthest clip end across all tracks. */
export function editorDocDuration(doc: EditorDoc): number {
  let max = 0;
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      const dur = Math.max(0, (clip.trimOut - clip.trimIn)) / (clip.speed ?? 1);
      max = Math.max(max, clip.start + dur);
    }
  }
  return max;
}

export interface EditSessionSummary {
  id: number;
  name: string;
  projectId: number | null;
  thumbnailUrl: string | null;
  updatedAt: string | Date;
  createdAt: string | Date;
}
