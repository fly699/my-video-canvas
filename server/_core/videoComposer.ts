import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { storagePut, assertObjectStorageWritable } from "../storage";
import { execFileAsync, downloadToTemp, buildAtempoFilters, probeStreams, cssColorToASSHex, cssColorToASSAlpha, escapeASSText, formatASSTime } from "./videoEditor";
import { sanitizeFilenamePrefix } from "./comfyui";
import type { EditorDoc, Clip, ClipEffects, ClipTransform, ClipText, ClipMask, FitMode, TransformKeyframe, EaseType } from "@shared/editorTypes";
import { qualityPctToCrf } from "@shared/exportQuality";
import { shapeToSvg, type ShapeSpec } from "@shared/shapeSvg";
import { Resvg } from "@resvg/resvg-js";

// Render timeouts are generous: a full multi-clip render re-encodes everything
// in ONE pass, which can take minutes for long timelines.
const COMPOSE_TIMEOUT_MS = 20 * 60_000;

export interface ComposeOptions {
  userId: number;
  projectName?: string | null;
  onProgress?: (pct: number, stage: string) => void;
  // Export overrides (optional). Default: doc dimensions/fps, mp4/H.264, high quality.
  format?: "mp4" | "hevc" | "webm" | "mov";
  quality?: "high" | "medium" | "low";
  qualityPct?: number; // 1..100 精细质量（优先于 quality 档位）→ 映射为对应编码的 CRF
  encoder?: "software" | "hardware"; // 软件(CPU/libx264)质量优先 | 硬件(GPU/NVENC 等)速度优先；硬件不可用自动回退
  width?: number;   // output width override (even); preserves aspect at the caller
  height?: number;  // output height override (even)
  fps?: number;     // output fps override
}
export interface ComposeResult {
  url: string;
  storageKey: string;
  duration: number;
}

/** One normalized clip on the main video track, ready for the filter graph. */
export interface Segment {
  isImage: boolean;
  hasAudio: boolean;
  trimIn: number;
  trimOut: number;
  speed: number;
  volume?: number;                                // 原声音量增益（片段音量 × 轨道音量；1=原始）
  effects?: ClipEffects;                          // color/filter (eq + preset)
  transition?: { type: string; duration: number }; // entry transition vs the previous segment
  fit?: FitMode;                                  // contain (default) | cover | stretch | blur
  reverse?: boolean;                              // 倒放：逆序播放（图片无效）
  flipH?: boolean;                                // 水平镜像
  flipV?: boolean;                                // 垂直翻转
  transform?: ClipTransform;                      // main-track zoom(scale≥1)/pan(x,y)/rotate within the frame
  keyframes?: TransformKeyframe[];                // main-track Ken-Burns: animate zoom/pan over time
  fadeIn?: number;                                // 画面+音频淡入（秒，从黑/静音渐显）
  fadeOut?: number;                               // 画面+音频淡出（秒，渐隐到黑/静音）
  fadeCurve?: string;                             // 音频淡变曲线（afade curve；画面 fade 仍线性）
}

/** Zoom/pan/rotate a frame-sized image WITHIN the output frame (main-track clips):
 *  scale ≥ 1 zooms in; x/y pan as a fraction of the frame (0 = centered); the result
 *  stays w×h (overflow cropped). scale < 1 is treated as 1 (no shrink-to-black —
 *  that's what the overlay track is for). */
export function segmentTransformChain(tf: ClipTransform | undefined, w: number, h: number): string[] {
  if (!tf) return [];
  const out: string[] = [];
  if (tf.rotation) out.push(`rotate=${(tf.rotation * Math.PI / 180).toFixed(5)}:ow=iw:oh=ih`);
  const s = Math.max(1, tf.scale ?? 1);
  // Pan only matters once zoomed in (s>1) — that's the only time there's hidden
  // area to reveal. Clamp pan to the available room so the crop is always a valid,
  // in-bounds rectangle (plain numbers — no fragile ffmpeg expressions).
  if (s > 1.001) {
    const maxFrac = (s - 1) / 2;
    const px = Math.max(-maxFrac, Math.min(maxFrac, tf.x ?? 0));
    const py = Math.max(-maxFrac, Math.min(maxFrac, tf.y ?? 0));
    out.push(`scale=${Math.round(w * s)}:${Math.round(h * s)}`);
    out.push(`crop=${w}:${h}:${Math.round((maxFrac - px) * w)}:${Math.round((maxFrac - py) * h)}`);
  }
  return out;
}

/** True when a main-track clip's keyframes actually animate zoom/pan (≥2 points
 *  touching scale/x/y) — i.e. a Ken-Burns move that must be rendered over time. */
function hasZoomPanAnimation(kfs: TransformKeyframe[] | undefined): boolean {
  return (kfs?.filter((k) => k.scale != null || k.x != null || k.y != null).length ?? 0) >= 2;
}
/** ≥2 keyframes touch rotation → animate the picture's rotation over time. */
function hasRotationAnimation(kfs: TransformKeyframe[] | undefined): boolean {
  return (kfs?.filter((k) => k.rotation != null).length ?? 0) >= 2;
}

/** Ken-Burns for a main-track clip: animate zoom (scale≥1) + pan (x/y) over time
 *  using per-frame `t` expressions. Falls back to the static chain when there's no
 *  real animation. The `t` here is clip-local (segments run pre-concat after
 *  setpts=PTS-STARTPTS), so keyframe times are used as-is. The crop offset is
 *  clip()-clamped in-expression so it can never leave the (zoomed) frame. */
export function segmentZoomPanChain(tf: ClipTransform | undefined, kfs: TransformKeyframe[] | undefined, w: number, h: number): string[] {
  if (!hasZoomPanAnimation(kfs) && !hasRotationAnimation(kfs)) return segmentTransformChain(tf, w, h);
  const out: string[] = [];
  // rotation: animate over keyframes when present (rotate's `a` is per-frame — no
  // eval option, like crop), else static. ow=iw:oh=ih keeps the frame size.
  const rotExpr = buildKeyframeExpr(keyframePoints(kfs, "rotation", 0, (v) => v * Math.PI / 180));
  if (rotExpr != null) out.push(`rotate=a='${rotExpr}':ow=iw:oh=ih`);
  else if (tf?.rotation) out.push(`rotate=${(tf.rotation * Math.PI / 180).toFixed(5)}:ow=iw:oh=ih`);
  // scale clamped ≥1; pan in pixels. Missing fields on a keyframe just drop out of
  // that field's point list (buildKeyframeExpr interpolates the ones present).
  const zExpr = buildKeyframeExpr(keyframePoints(kfs, "scale", 0, (v) => Math.max(1, v)));
  const pxExpr = buildKeyframeExpr(keyframePoints(kfs, "x", 0, (v) => v * w));
  const pyExpr = buildKeyframeExpr(keyframePoints(kfs, "y", 0, (v) => v * h));
  const z = zExpr ?? Number(Math.max(1, tf?.scale ?? 1).toFixed(4)).toString();
  const px = pxExpr ?? "0";
  const py = pyExpr ?? "0";
  // scale eval=frame supports the `t` (timestamp) variable → per-frame zoom.
  // crop's x/y are ALWAYS evaluated per-frame (no eval option on the crop filter —
  // adding `:eval=frame` errors with "Option not found"), so the pan animates too.
  out.push(`scale=w='${w}*(${z})':h='${h}*(${z})':eval=frame`);
  out.push(`crop=${w}:${h}:x='clip((iw-${w})/2-(${px}),0,iw-${w})':y='clip((ih-${h})/2-(${py}),0,ih-${h})'`);
  return out;
}

/** Visual fade filters (picture fade from/to black, or alpha fade for overlays).
 *  `dur` is the clip's visible seconds (fade times are clip-local, st-from-0). */
function videoFadeFilters(fadeIn: number | undefined, fadeOut: number | undefined, dur: number, alpha = false): string[] {
  const out: string[] = [];
  const a = alpha ? ":alpha=1" : "";
  if (fadeIn && fadeIn > 0) out.push(`fade=t=in:st=0:d=${Math.min(fadeIn, dur).toFixed(3)}${a}`);
  if (fadeOut && fadeOut > 0) { const d = Math.min(fadeOut, dur); out.push(`fade=t=out:st=${Math.max(0, dur - d).toFixed(3)}:d=${d.toFixed(3)}${a}`); }
  return out;
}

/** afade curve names we expose (others rejected to keep the filter string safe). */
const ALLOWED_FADE_CURVES = new Set(["tri", "qsin", "hsin", "log", "exp"]);

/** Audio fade-in/out (afade) for a clip-local stream of `dur` seconds. `curve`
 *  shapes the gain envelope (tri=linear default; qsin/hsin smooth; log fast-then-
 *  slow; exp slow-then-fast). Unknown curves fall back to linear (no `:curve=`). */
function audioFadeFilters(fadeIn: number | undefined, fadeOut: number | undefined, dur: number, curve?: string): string[] {
  const cv = curve && curve !== "tri" && ALLOWED_FADE_CURVES.has(curve) ? `:curve=${curve}` : "";
  const out: string[] = [];
  if (fadeIn && fadeIn > 0) out.push(`afade=t=in:st=0:d=${Math.min(fadeIn, dur).toFixed(3)}${cv}`);
  if (fadeOut && fadeOut > 0) { const d = Math.min(fadeOut, dur); out.push(`afade=t=out:st=${Math.max(0, dur - d).toFixed(3)}:d=${d.toFixed(3)}${cv}`); }
  return out;
}

// 缩放算法：源→画布的适配缩放统一用 lanczos（对下采样——手机/相机 4K→1080p 导出的
// 主场景——比默认 bicubic 更锐，实测边缘能量 +10%；对上采样也是行业 NLE 的高质量首选）。
const LANCZOS = ":flags=lanczos";

/** ffmpeg filters that fit a frame into the output canvas per the fit mode. */
function fitChain(fit: FitMode | undefined, w: number, h: number): string[] {
  switch (fit) {
    case "cover":   // 填充：放大铺满，裁掉溢出
      return [`scale=${w}:${h}:force_original_aspect_ratio=increase${LANCZOS}`, `crop=${w}:${h}`];
    case "stretch": // 拉伸：精确铺满，可能变形
      return [`scale=${w}:${h}${LANCZOS}`];
    case "none":    // 原始 1:1：源生分辨率不缩放，居中（小留黑、大居中裁切）
      // pad up to at least the canvas so pad never fails for oversize sources,
      // centered, then crop back to the canvas. Quotes protect the commas in max().
      return [`pad=w='max(${w},iw)':h='max(${h},ih)':x=(ow-iw)/2:y=(oh-ih)/2:color=black`, `crop=${w}:${h}`];
    default:        // 适应：完整显示，居中留黑边
      return [`scale=${w}:${h}:force_original_aspect_ratio=decrease${LANCZOS}`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`];
  }
}

/** A clip on an overlay track, composited on top of the base at its time slot. */
export interface OverlayInput {
  isImage: boolean;
  trimIn: number;
  trimOut: number;
  speed: number;
  start: number;       // timeline position (seconds)
  duration: number;    // visible duration on the timeline
  transform?: ClipTransform;
  keyframes?: TransformKeyframe[]; // position (x/y) animated on export; others static
  chromaKey?: { color?: string; similarity?: number; blend?: number }; // 绿幕抠像
  fadeIn?: number;                 // 叠加层 alpha 淡入（秒）
  fadeOut?: number;                // 叠加层 alpha 淡出（秒）
  flipH?: boolean;                 // 水平镜像
  flipV?: boolean;                 // 垂直翻转
  mask?: ClipMask;                 // 形状蒙版（裁成矩形/椭圆 + 羽化/反转）
}

/** Build a sanitized `chromakey` filter (keys the given colour transparent). Colour
 *  is strictly validated to `0xRRGGBB` to prevent any filter-string injection. */
export function chromaKeyFilter(ck: { color?: string; similarity?: number; blend?: number } | undefined): string | null {
  if (!ck) return null;
  const hex = (ck.color ?? "").replace(/^#/, "").replace(/^0x/i, "");
  const color = /^[0-9a-fA-F]{6}$/.test(hex) ? `0x${hex}` : "0x00D000"; // default green
  const sim = Math.min(1, Math.max(0.01, ck.similarity ?? 0.3));
  const blend = Math.min(1, Math.max(0, ck.blend ?? 0.1));
  return `chromakey=${color}:${sim.toFixed(3)}:${blend.toFixed(3)}`;
}

/** 形状蒙版 → 作用于片段 alpha 通道的 `geq` 滤镜（叠加层）。用 W/H 符号表达，故与片段
 *  实际分辨率无关。形状内 alpha 保留、形状外置 0（invert 时相反），feather 给软边过渡。
 *  表达式整体用单引号包裹保护逗号（与本文件其它表达式选项一致）。 */
export function maskAlphaFilter(mask: ClipMask | undefined): string | null {
  if (!mask) return null;
  const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const x = cl(mask.x, -1, 2), y = cl(mask.y, -1, 2);
  const w = cl(mask.w, 0.01, 2), h = cl(mask.h, 0.01, 2);
  const f = cl(mask.feather ?? 0, 0, 1);
  const n = (v: number) => v.toFixed(4);
  let m: string;
  if (mask.type === "ellipse") {
    const cx = n(x + w / 2), cy = n(y + h / 2), rx = n(w / 2), ry = n(h / 2);
    const fEff = Math.max(f, 0.0001).toFixed(4);
    // 归一化椭圆距离 d（边缘=1）；clip((1-d)/feather,0,1) 给软边，feather→0 即硬边。
    m = `clip((1-sqrt(pow((X-${cx}*W)/(${rx}*W),2)+pow((Y-${cy}*H)/(${ry}*H),2)))/${fEff},0,1)`;
  } else {
    const x1 = n(x), x2 = n(x + w), y1 = n(y), y2 = n(y + h);
    // 羽化像素 = feather/2 × 形状短边；至少 1 像素避免除零。
    const fpx = `max(1,${(f * 0.5).toFixed(4)}*min(${n(w)}*W,${n(h)}*H))`;
    m = `clip(min(min(X-${x1}*W,${x2}*W-X),min(Y-${y1}*H,${y2}*H-Y))/${fpx},0,1)`;
  }
  const mm = mask.invert ? `(1-(${m}))` : m;
  return `geq=r='p(X,Y)':g='p(X,Y)':b='p(X,Y)':a='p(X,Y)*(${mm})'`;
}

/** A vector shape drawn onto the composed video (rect via drawbox), time-gated. */
export interface ShapeInput {
  start: number; end: number;
  type: string;
  color?: string; fill?: boolean; lineWidth?: number; opacity?: number;
  x: number; y: number; w: number; h: number; // all normalized 0..1
}

/** Build a sanitized `drawbox` filter for a rectangle shape. Color is strictly
 *  validated to `0xRRGGBB` and all geometry clamped/rounded, so nothing from the
 *  shape can inject into the filter string. Time-gated via `enable=between`. */
export function shapeDrawbox(s: ShapeInput, w: number, h: number): string {
  const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const hex = (s.color ?? "").replace(/^#/, "").replace(/^0x/i, "");
  const color = /^[0-9a-fA-F]{6}$/.test(hex) ? `0x${hex}` : "0xFFD400";
  const op = cl(s.opacity ?? 1, 0, 1);
  const bx = Math.round(cl(s.x, 0, 1) * w);
  const by = Math.round(cl(s.y, 0, 1) * h);
  const bw = Math.max(1, Math.round(cl(s.w, 0.005, 1) * w));
  const bh = Math.max(1, Math.round(cl(s.h, 0.005, 1) * h));
  const thick = s.fill ? "fill" : String(Math.round(cl(s.lineWidth ?? 4, 1, 100)));
  const start = Math.max(0, s.start), end = Math.max(start, s.end);
  return `drawbox=x=${bx}:y=${by}:w=${bw}:h=${bh}:color=${color}@${op.toFixed(3)}:t=${thick}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`;
}

const exprF = (n: number) => Number(n.toFixed(4)).toString();

/** ffmpeg expression for one keyframe segment a→b in the `t` time base. Linear keeps
 *  the exact previous form (byte-identical, zero export regression); easing replaces
 *  the progress `r=(t-at)/dt` with the matching polynomial — same curves as the
 *  preview's `applyEase`, so preview and export agree. */
function segmentKeyframeExpr(av: number, bv: number, at: number, dt: number, ease: EaseType | undefined): string {
  if (!ease || ease === "linear") {
    const slope = (bv - av) / dt;
    return `(${exprF(av)}+(t-${exprF(at)})*${exprF(slope)})`;
  }
  const R = `((t-${exprF(at)})/${exprF(dt)})`;
  const poly = ease === "in" ? `${R}*${R}` : ease === "out" ? `${R}*(2-${R})` : `${R}*${R}*(3-2*${R})`;
  return `(${exprF(av)}+(${exprF(bv)}-${exprF(av)})*(${poly}))`;
}

/** Build a piecewise ffmpeg expression (in the overlay's `t` time base, seconds)
 *  for a keyframed field. Values hold flat before the first and after the last
 *  point; each segment uses its start keyframe's `ease` curve. Returns null when
 *  there are no keyframes. `pts` must be sorted ascending by `t`; `v` is already
 *  in target units (e.g. pixels). */
export function buildKeyframeExpr(pts: { t: number; v: number; ease?: EaseType }[]): string | null {
  if (pts.length === 0) return null;
  if (pts.length === 1) return exprF(pts[0].v); // single keyframe → constant
  let expr = exprF(pts[pts.length - 1].v); // after the last point: hold
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i], b = pts[i + 1];
    const seg = segmentKeyframeExpr(a.v, b.v, a.t, Math.max(1e-6, b.t - a.t), a.ease);
    expr = `if(lt(t,${exprF(b.t)}),${seg},${expr})`;
  }
  return `if(lt(t,${exprF(pts[0].t)}),${exprF(pts[0].v)},${expr})`; // before the first: hold
}

/** Sorted keyframe points for one field, with clip-relative time shifted by
 *  `tOffset` (absolute timeline seconds for the overlay clock) and values mapped
 *  by `toUnit` (e.g. normalized→pixels). Empty when no keyframe defines the field. */
function keyframePoints(
  kfs: TransformKeyframe[] | undefined, field: "x" | "y" | "scale" | "rotation" | "opacity", tOffset: number, toUnit: (v: number) => number,
): { t: number; v: number; ease?: EaseType }[] {
  if (!kfs || kfs.length === 0) return [];
  return kfs
    .filter((k) => k[field] != null)
    .sort((a, b) => a.t - b.t)
    .map((k) => ({ t: k.t + tOffset, v: toUnit(k[field] as number), ease: k.ease }));
}

/** A clip on a dedicated audio track, mixed into the output. */
export interface AudioInput {
  trimIn: number;
  trimOut: number;
  speed: number;
  start: number;       // timeline position (seconds)
  volume: number;
  fadeIn: number;
  fadeOut: number;
  fadeCurve?: string;  // afade 曲线（tri/qsin/hsin/log/exp）
  ducking?: boolean;   // background music: auto-duck under the other (voice) audio
  denoise?: boolean;   // FFT noise reduction (afftdn) — clean up hiss/hum
}

/** A text clip rendered as an ASS dialogue event. */
export interface TextInput {
  start: number;
  end: number;
  text: ClipText;
  x: number;           // 0..1 of canvas (text box left edge)
  y: number;           // 0..1 of canvas
  boxW?: number;       // 文本框宽度（画布占比，默认 0.4）——用于按 align 求左/中/右锚点
}

/** 打字机逐字显现：每个字符先 \alpha&HFF&（全透明），到自己的时刻用 \t 瞬变 \alpha&H00&
 *  （不透明）出现。节奏约 60ms/字，并压缩到不超过片段时长的 80%，CJK/emoji 按码点切分。 */
export function typewriterText(content: string, clipDurMs: number, cps?: number, vertical?: boolean): string {
  const chars = Array.from(content);
  if (chars.length === 0) return "";
  const perCps = 1000 / Math.max(1, Math.min(60, cps ?? 16)); // 字符间隔(ms)，默认 ~16 字/秒
  const per = Math.min(perCps, (Math.max(0, clipDurMs) * 0.9) / chars.length); // 压到片段时长内
  return chars.map((ch, i) => {
    const t0 = Math.round(i * per);
    return `{\\alpha&HFF&\\t(${t0},${t0 + 1},\\alpha&H00&)}${escapeASSText(ch)}`;
  }).join(vertical ? "\\N" : ""); // 竖排：逐字换行
}

/** Build an ASS subtitle document for the editor's text clips (CJK-safe, positioned). */
export function buildEditorASS(clips: TextInput[], opts: { width: number; height: number }): string {
  const head = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,48,&H00FFFFFF,&H00000000,&H64000000,1,1,2,1,7,0,0,0,1",
    // 背景框样式：BorderStyle=3（不透明框），\3c 即框色、\bord 即内边距。用于设了底色的字幕。
    "Style: Box,Arial,48,&H00FFFFFF,&H00000000,&H64000000,1,3,2,1,7,0,0,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = clips.map((c) => {
    const t = c.text;
    const size = t.size ?? 48;
    const fill = t.color ?? "white";
    // 水平对齐（与预览一致的盒模型）：文本框左缘在 c.x、宽 boxW；左/中/右对齐分别把
    // 锚点取在框左/中/右，并用 \an7/8/9 让多行文字同向对齐。默认居中（与预览默认一致）。
    const align = t.align ?? "center";
    const boxW = c.boxW ?? 0.4;
    const anchorFrac = align === "left" ? c.x : align === "right" ? c.x + boxW : c.x + boxW / 2;
    const an = align === "left" ? 7 : align === "right" ? 9 : 8;
    const px = Math.round(anchorFrac * opts.width);
    const py = Math.round(c.y * opts.height);
    // base styling tags shared by all motion styles. ASS colours are `\c&HBBGGRR&`
    // and alpha is a SEPARATE inverted tag (`\1a&HAA&`, 00=opaque, FF=transparent).
    const base: string[] = [`\\fs${size}`, `\\c&H${cssColorToASSHex(fill)}&`];
    const fillAlpha = cssColorToASSAlpha(fill);
    if (fillAlpha !== "00") base.push(`\\1a&H${fillAlpha}&`);
    // Strip override-block delimiters from the font name so a `}` can't close
    // the tag block early and inject arbitrary ASS tags/text into the render.
    if (t.font) base.push(`\\fn${t.font.replace(/[{}\\]/g, "")}`); // requires the font installed on the render host
    if (t.bold) base.push("\\b1");
    if (t.italic) base.push("\\i1");
    // 背景框（bgColor）：用 Box 样式（BorderStyle=3 不透明框），\3c=框色、\bord=内边距。
    // ASS 的不透明框会占用描边通道，故有底色时不再单独画描边（与预览的「底框」语义一致）。
    const hasBox = !!t.bgColor;
    const styleName = hasBox ? "Box" : "Default";
    if (hasBox) {
      base.push(`\\bord${Math.max(2, Math.round(size * 0.22))}`);
      base.push(`\\3c&H${cssColorToASSHex(t.bgColor!)}&`);
      const ba = cssColorToASSAlpha(t.bgColor!);
      if (ba !== "00") base.push(`\\3a&H${ba}&`);
    } else {
      // 描边 (outline): explicit width + colour (+ alpha), or 0 to disable the style default
      base.push(`\\bord${t.strokeWidth && t.strokeWidth > 0 ? t.strokeWidth : 0}`);
      if (t.strokeWidth && t.strokeWidth > 0) {
        const sc = t.strokeColor ?? "black";
        base.push(`\\3c&H${cssColorToASSHex(sc)}&`);
        const sa = cssColorToASSAlpha(sc);
        if (sa !== "00") base.push(`\\3a&H${sa}&`);
      }
    }
    // 投影 (shadow): depth + back colour (+ alpha), or 0
    base.push(`\\shad${t.shadow ? 3 : 0}`);
    if (t.shadow) {
      const dc = t.shadowColor ?? "#000000";
      base.push(`\\4c&H${cssColorToASSHex(dc)}&`);
      const da = cssColorToASSAlpha(dc);
      if (da !== "00") base.push(`\\4a&H${da}&`);
    }

    const motion = t.motionStyle;
    // 竖排：把正文逐字用 \N 换行（单列纵向）；否则正常转义。
    const plainBody = t.vertical ? Array.from(t.content).map((ch) => escapeASSText(ch)).join("\\N") : escapeASSText(t.content);
    if (motion === "roll") {
      return `Dialogue: 0,${formatASSTime(c.start)},${formatASSTime(c.end)},${styleName},,0,0,0,,{\\an${an}\\move(${px},${opts.height},${px},${py})${base.join("")}}${plainBody}`;
    }
    // 片尾滚动字幕：整段文字在本片段时长内从画面底部下方持续上滚至顶部上方（多行 credits）。
    if (motion === "credits") {
      return `Dialogue: 0,${formatASSTime(c.start)},${formatASSTime(c.end)},${styleName},,0,0,0,,{\\an${an}\\move(${px},${opts.height},${px},${-opts.height})${base.join("")}}${plainBody}`;
    }
    // 入场动效（前 ~350ms）：滑入用 \move 从偏移位归位 + 淡入；弹入用 \fscx/\fscy + \t 缩放。
    const MD = 350;
    const off = Math.max(8, Math.round(opts.height * 0.06)); // 滑入距离（脚本像素）
    const lead: string[] = [`\\an${an}`];
    if (motion === "slideup") lead.push(`\\move(${px},${py + off},${px},${py},0,${MD})`);
    else if (motion === "slidedown") lead.push(`\\move(${px},${py - off},${px},${py},0,${MD})`);
    else lead.push(`\\pos(${px},${py})`);
    const tags = [...lead, ...base];
    if (motion === "fade") tags.push("\\fad(300,300)");
    else if (motion === "slideup" || motion === "slidedown") tags.push(`\\fad(${MD},0)`);
    else if (motion === "pop") tags.push(`\\fscx40\\fscy40\\t(0,${MD},\\fscx100\\fscy100)`, "\\fad(150,0)");
    else if (motion === "bounce" || motion === "karaoke") tags.push("\\fad(200,200)");
    // 打字机：逐字显现（每字先全透明、到时刻瞬变不透明），文本本身改成 per-char 块。
    const body = motion === "typewriter"
      ? typewriterText(t.content, (c.end - c.start) * 1000, t.typewriterCps, t.vertical)
      : plainBody;
    return `Dialogue: 0,${formatASSTime(c.start)},${formatASSTime(c.end)},${styleName},,0,0,0,,{${tags.join("")}}${body}`;
  });
  return head.concat(events).join("\n") + "\n";
}

/** Escape a file path for use inside the ffmpeg `ass`/`subtitles` filter. */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/,/g, "\\,").replace(/'/g, "\\'");
}

/** Visible (output) duration of a segment in seconds. */
export function segmentDuration(s: Segment): number {
  if (s.isImage) return Math.max(0.05, s.trimOut - s.trimIn);
  return Math.max(0.05, (s.trimOut - s.trimIn) / (s.speed || 1));
}

/** Map our transition names to ffmpeg xfade transition identifiers. */
const XFADE_NAMES = new Set([
  "fade", "fadeblack", "fadewhite", "dissolve",
  "wipeleft", "wiperight", "wipeup", "wipedown",
  "slideleft", "slideright", "slideup", "slidedown",
  "smoothleft", "smoothright", "circleopen", "circleclose",
  "circlecrop", "rectcrop", "radial", "pixelize", "zoomin",
  "diagtl", "diagbr", "hlslice", "squeezeh", "squeezev",
  "fadegrays", "hblur",
]);
function xfadeName(t: string): string {
  if (t === "slide") return "slideleft"; // legacy alias
  if (t === "wipe") return "wipeleft";   // legacy alias
  if (XFADE_NAMES.has(t)) return t;      // new values are valid xfade names as-is
  return "fade";                          // unknown → safe default
}

/** Color/filter chain for a visual clip (ffmpeg eq + preset). Empty when none. */
function colorChain(e?: ClipEffects): string[] {
  if (!e) return [];
  const out: string[] = [];
  const parts: string[] = [];
  if (e.brightness != null) parts.push(`brightness=${e.brightness}`);
  if (e.contrast != null) parts.push(`contrast=${e.contrast}`);
  if (e.saturation != null) parts.push(`saturation=${e.saturation}`);
  if (parts.length) out.push(`eq=${parts.join(":")}`);
  switch (e.filter) {
    case "vintage": out.push("curves=preset=vintage"); break;
    case "warm": out.push("colorbalance=rm=0.12:gm=0.04:bm=-0.12"); break;
    case "cool": out.push("colorbalance=rm=-0.12:gm=-0.02:bm=0.12"); break;
    case "bw": case "mono": out.push("hue=s=0"); break;
    case "cinematic": out.push("curves=preset=increase_contrast"); break;
    case "teal_orange": out.push("colorbalance=rs=-0.08:bs=0.08:rh=0.10:bh=-0.08", "eq=contrast=1.06"); break;
    case "sepia": out.push("colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131"); break;
    case "noir": out.push("hue=s=0", "eq=contrast=1.25:brightness=-0.02"); break;
    case "faded": out.push("curves=preset=lighter", "eq=saturation=0.72"); break;
    case "vivid": out.push("eq=saturation=1.40:contrast=1.08"); break;
    case "cyberpunk": out.push("colorbalance=rs=0.05:bs=0.12:rh=0.05:bh=0.10", "eq=saturation=1.30:contrast=1.05"); break;
    case "moody": out.push("colorbalance=rs=-0.06:bs=0.06", "eq=contrast=1.10:brightness=-0.05:saturation=0.90"); break;
    case "gold": out.push("colorbalance=rm=0.12:gm=0.06:bm=-0.10", "eq=saturation=1.10"); break;
  }
  // 画质质感：暗角 / 锐化（独立于上面的调色预设，叠加其后）。0/缺省时完全跳过 → 零回归。
  if (e.vignette != null && e.vignette > 0) {
    // 强度 0..1 → 暗角角度 0..PI/2.2（越大边角越暗）；clamp 防越界。
    const a = (Math.min(1, Math.max(0, e.vignette)) * Math.PI / 2.2).toFixed(4);
    out.push(`vignette=a=${a}`);
  }
  if (e.sharpen != null && e.sharpen > 0) {
    // 强度 0..1 → unsharp 亮度增益 0..1.8（5x5 高斯核），仅锐化亮度通道。
    const amt = (Math.min(1, Math.max(0, e.sharpen)) * 1.8).toFixed(3);
    out.push(`unsharp=5:5:${amt}:5:5:0`);
  }
  return out;
}

/** Whether any segment requests a real entry transition. */
function hasTransitions(segs: Segment[]): boolean {
  return segs.some((s, i) => i > 0 && s.transition && s.transition.type !== "none" && s.transition.duration > 0);
}

/**
 * Build the single ffmpeg `-filter_complex` graph that normalizes every segment
 * to the output canvas and concatenates them — video AND audio — in ONE pass.
 * Pure function (no I/O) so it can be unit-tested. Input index i corresponds to
 * segment i (added to ffmpeg in the same order).
 */
export function buildFilterGraph(
  segs: Segment[],
  opts: { width: number; height: number; fps: number; normalizeAudio?: boolean; masterFadeIn?: number; masterFadeOut?: number },
  overlays: OverlayInput[] = [],
  extra: { audioClips?: AudioInput[]; assPath?: string; shapes?: ShapeInput[] } = {},
): { filterComplex: string; outV: string; outA: string; duration: number } {
  const { fps } = opts;
  // even dims only (libx264/yuv420p reject odd sizes → empty graph, -22)
  const w = Math.max(2, opts.width - (opts.width % 2));
  const h = Math.max(2, opts.height - (opts.height % 2));
  const parts: string[] = [];
  const vLabels: string[] = [];
  const aLabels: string[] = [];

  // 最终音轨处理（混音之后）：可选响度归一化（loudnorm → 流媒体标准 -14 LUFS）+
  // 整片首尾淡入淡出（afade）。都不启用时不加滤镜（旧导出零回归）。`dur` 为成片总时长。
  const finalizeAudio = (label: string, dur: number): string => {
    const f: string[] = [];
    if (opts.normalizeAudio) f.push("loudnorm=I=-14:TP=-1.5:LRA=11");
    if (opts.masterFadeIn && opts.masterFadeIn > 0) f.push(`afade=t=in:st=0:d=${Math.min(opts.masterFadeIn, dur).toFixed(3)}`);
    if (opts.masterFadeOut && opts.masterFadeOut > 0) { const d = Math.min(opts.masterFadeOut, dur); f.push(`afade=t=out:st=${Math.max(0, dur - d).toFixed(3)}:d=${d.toFixed(3)}`); }
    if (f.length === 0) return label;
    parts.push(`${label}${f.join(",")}[outan]`);
    return "[outan]";
  };
  // 整片首尾画面淡入淡出（从黑/到黑），作用于最终视频输出。
  const finalizeVideo = (label: string, dur: number): string => {
    const f = videoFadeFilters(opts.masterFadeIn, opts.masterFadeOut, dur);
    if (f.length === 0) return label;
    parts.push(`${label}${f.join(",")}[outvf]`);
    return "[outvf]";
  };

  segs.forEach((s, i) => {
    const dur = segmentDuration(s);
    // ── video chain ──
    // pre = source-side filters (trim / 倒放 / 变速); post = normalize to canvas
    // (sar / fps / color / format / timebase). The fit stage sits between them and
    // is either a linear chain (contain/cover/stretch) or a split+overlay subgraph
    // (blur fill), so it must be emitted separately.
    const pre: string[] = [];
    if (!s.isImage) {
      pre.push(`trim=start=${s.trimIn.toFixed(3)}:end=${s.trimOut.toFixed(3)}`);
      if (s.reverse) pre.push("reverse");          // 倒放：逆序整段（缓冲整段，故仅适合短片段）
      pre.push("setpts=PTS-STARTPTS");
      if (Math.abs(s.speed - 1) > 0.001) pre.push(`setpts=${(1 / s.speed).toFixed(6)}*PTS`);
    } else {
      pre.push("setpts=PTS-STARTPTS");
    }
    if (s.flipH) pre.push("hflip");                 // 水平镜像
    if (s.flipV) pre.push("vflip");                 // 垂直翻转
    // Pin the timebase so every segment matches when folded. concat emits a
    // microsecond timebase (1/1000000) while fps-filtered segments are 1/fps;
    // feeding a concat (hard cut) output into a later xfade alongside a fresh
    // segment then fails with "timebase ... do not match" → "Failed to
    // configure output pad". settb keeps all combine inputs on 1/fps.
    // 片段不透明度（主轨）：与预览一致 = 在 RGB 上朝黑乘 op。仅 op<1 时插入此滤镜，
    // op=1（绝大多数片段）链路保持原样、无任何额外转换 → 对常规导出零影响、零质量损失。
    const op = s.transform?.opacity ?? 1;
    const opChain = op < 0.999 ? [`colorchannelmixer=rr=${op.toFixed(3)}:gg=${op.toFixed(3)}:bb=${op.toFixed(3)}`] : [];
    const post: string[] = ["setsar=1", `fps=${fps}`, ...colorChain(s.effects), ...opChain, "format=yuv420p", ...videoFadeFilters(s.fadeIn, s.fadeOut, dur), `settb=1/${fps}`];

    if (s.fit === "blur") {
      // 模糊填充：同一画面放大铺满 + 高斯/盒式模糊作背景，原画完整居中叠加，消除黑边。
      parts.push(`[${i}:v]${pre.join(",")},split[bg${i}][fg${i}]`);
      parts.push(`[bg${i}]scale=${w}:${h}:force_original_aspect_ratio=increase${LANCZOS},crop=${w}:${h},boxblur=20:2,setsar=1[bgb${i}]`);
      parts.push(`[fg${i}]scale=${w}:${h}:force_original_aspect_ratio=decrease${LANCZOS},setsar=1[fgs${i}]`);
      parts.push(`[bgb${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2,${[...segmentZoomPanChain(s.transform, s.keyframes, w, h), ...post].join(",")}[v${i}]`);
    } else {
      parts.push(`[${i}:v]${[...pre, ...fitChain(s.fit, w, h), ...segmentZoomPanChain(s.transform, s.keyframes, w, h), ...post].join(",")}[v${i}]`);
    }
    vLabels.push(`[v${i}]`);

    // ── audio chain ── (real audio when present, otherwise silence of clip length)
    if (s.hasAudio) {
      const aChain: string[] = [`atrim=start=${s.trimIn.toFixed(3)}:end=${s.trimOut.toFixed(3)}`];
      if (s.reverse) aChain.push("areverse");      // 倒放：音频同步逆序
      aChain.push("asetpts=PTS-STARTPTS");
      if (Math.abs(s.speed - 1) > 0.001) aChain.push(...buildAtempoFilters(s.speed));
      aChain.push("aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=44100");
      // 原声音量（片段音量 × 轨道音量）。1 时跳过 → 零回归。
      if (s.volume != null && Math.abs(s.volume - 1) > 0.001) aChain.push(`volume=${Math.max(0, s.volume).toFixed(3)}`);
      aChain.push(...audioFadeFilters(s.fadeIn, s.fadeOut, dur, s.fadeCurve)); // 片段画面淡入淡出时音频同步渐变
      parts.push(`[${i}:a]${aChain.join(",")}[a${i}]`);
    } else {
      // Silence MUST use the same sample format as real-audio chains (fltp), else
      // concat sees mismatched audio formats and produces no packets → the AAC
      // encoder can't open ("Could not open encoder before EOF") and export fails.
      parts.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=44100[a${i}]`);
    }
    aLabels.push(`[a${i}]`);
  });

  const audioClips = extra.audioClips ?? [];

  // Fast path: nothing but a plain concat is needed.
  if (!hasTransitions(segs) && overlays.length === 0 && audioClips.length === 0 && !extra.assPath && (extra.shapes?.length ?? 0) === 0) {
    const concatInputs = segs.map((_, i) => `${vLabels[i]}${aLabels[i]}`).join("");
    parts.push(`${concatInputs}concat=n=${segs.length}:v=1:a=1[outv][outa]`);
    const duration = segs.reduce((sum, s) => sum + segmentDuration(s), 0);
    const outvLabel = finalizeVideo("[outv]", duration);
    const outaLabel = finalizeAudio("[outa]", duration);
    return { filterComplex: parts.join(";"), outV: outvLabel, outA: outaLabel, duration };
  }

  // General path: fold segments left-to-right with per-pair xfade or concat,
  // so transitions and hard cuts can be mixed in one graph.
  let curV = vLabels[0];
  let curA = aLabels[0];
  let curDur = segmentDuration(segs[0]);
  for (let i = 1; i < segs.length; i++) {
    const dur = segmentDuration(segs[i]);
    const tr = segs[i].transition;
    const useX = tr && tr.type !== "none" && tr.duration > 0;
    if (useX) {
      const td = Math.min(tr!.duration, curDur, dur);
      const off = Math.max(0, curDur - td);
      parts.push(`${curV}${vLabels[i]}xfade=transition=${xfadeName(tr!.type)}:duration=${td.toFixed(3)}:offset=${off.toFixed(3)},settb=1/${fps}[vf${i}]`);
      parts.push(`${curA}${aLabels[i]}acrossfade=d=${td.toFixed(3)}[af${i}]`);
      curV = `[vf${i}]`; curA = `[af${i}]`;
      curDur = curDur + dur - td;
    } else {
      parts.push(`${curV}${vLabels[i]}concat=n=2:v=1:a=0,settb=1/${fps}[vf${i}]`);
      parts.push(`${curA}${aLabels[i]}concat=n=2:v=0:a=1[af${i}]`);
      curV = `[vf${i}]`; curA = `[af${i}]`;
      curDur = curDur + dur;
    }
  }

  // Composite overlay clips on top of the base video at their time slots.
  overlays.forEach((o, j) => {
    const inIdx = segs.length + j;
    const oc: string[] = [];
    if (!o.isImage) {
      oc.push(`trim=start=${o.trimIn.toFixed(3)}:end=${o.trimOut.toFixed(3)}`, "setpts=PTS-STARTPTS");
      if (Math.abs(o.speed - 1) > 0.001) oc.push(`setpts=${(1 / o.speed).toFixed(6)}*PTS`);
    } else {
      oc.push("setpts=PTS-STARTPTS");
    }
    const scaleW = Math.max(2, Math.round((o.transform?.scale ?? 0.4) * w));
    // PiP 缩放动画：有 scale 关键帧时逐帧缩放（clip-local 时基，在位移前），否则静态。
    const sExpr = buildKeyframeExpr(keyframePoints(o.keyframes, "scale", 0, (v) => Math.max(0.02, v) * w));
    // 动画缩放 `scale=...:eval=frame` 必须是「位移 setpts 前的最后一个像素滤镜」：它之后任何会
    // config_props 的几何/格式滤镜（format/flip/crop/rotate/colorchannelmixer 等）都会把叠加输入
    // 尺寸冻结在首帧，overlay 便按首帧尺寸合成——PiP 推拉在导出里静止（预览却在动）。只有时间类
    // 滤镜（fps/setpts）在它之后是尺寸安全的；对等比缩放这些滤镜与 scale 可交换，放到前面视觉等价。
    // 已用 ffmpeg 6.1.1 真机量化验证（仅此顺序下叠加区域 YAVG 逐帧上升）。静态缩放无此问题，按原序提前做。
    const animScale = sExpr != null ? `scale=w='${sExpr}':h=-2:eval=frame` : null;
    if (!animScale) oc.push(`scale=${scaleW}:-2${LANCZOS}`);
    oc.push(`fps=${fps}`);
    oc.push("format=rgba");
    if (o.flipH) oc.push("hflip");
    if (o.flipV) oc.push("vflip");
    const maskF = maskAlphaFilter(o.mask);
    if (maskF) oc.push(maskF); // 形状蒙版：裁成矩形/椭圆（含羽化/反转），作用于 alpha
    const ckf = chromaKeyFilter(o.chromaKey);
    if (ckf) oc.push(ckf); // 绿幕抠像：把指定颜色变透明，再合成
    // 透明度：有 opacity 关键帧时逐帧改 alpha。colorchannelmixer 的 aa 不吃表达式，故改用 geq
    // 改写 alpha 平面；geq 的时间变量是大写 T（小写 t 无效），且此处在位移 setpts 之前=clip-local。
    // 静态情形保持原 colorchannelmixer（零回归）。
    const opExpr = buildKeyframeExpr(keyframePoints(o.keyframes, "opacity", 0, (v) => Math.max(0, Math.min(1, v))));
    if (opExpr != null) {
      oc.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='clip(${opExpr.replace(/\bt\b/g, "T")},0,1)*alpha(X,Y)'`);
    } else {
      const op = o.transform?.opacity ?? 1;
      if (op < 0.999) oc.push(`colorchannelmixer=aa=${op.toFixed(3)}`);
    }
    // 旋转：有 rotation 关键帧时逐帧旋转。坑：rotate 的 a 本应逐帧求值，但 c=none（透明填充）
    // 会禁用逐帧（实测 6.1.1：c=none 下 a 冻结在首帧）；必须用 c=black@0（透明黑）才能既保透明角
    // 又动画，ow=iw:oh=ih 固定输出尺寸（绕开下游缩放的 config_props 尺寸锁，且中心对齐预览）。
    // 静态情形保持原 c=none:ow=rotw/roth（零回归）。
    const rotExpr = buildKeyframeExpr(keyframePoints(o.keyframes, "rotation", 0, (v) => v * Math.PI / 180));
    if (rotExpr != null) oc.push(`rotate=a='${rotExpr}':c=black@0:ow=iw:oh=ih`);
    else if (o.transform?.rotation) oc.push(`rotate=${(o.transform.rotation * Math.PI / 180).toFixed(5)}:c=none:ow=rotw(iw):oh=roth(ih)`);
    // alpha fade in/out while the overlay's PTS is still clip-local (0..duration)
    oc.push(...videoFadeFilters(o.fadeIn, o.fadeOut, o.duration, true));
    // 动画缩放放到所有像素滤镜之后、位移 setpts 之前（见上方说明：尺寸安全顺序）
    if (animScale) oc.push(animScale);
    // shift the overlay so its frames land at its timeline start
    oc.push(`setpts=PTS+${o.start.toFixed(3)}/TB`);
    parts.push(`[${inIdx}:v]${oc.join(",")}[ov${j}]`);

    // Position: animate x/y from keyframes (overlay's `t` is absolute timeline
    // seconds, so shift clip-relative keyframe times by o.start), else static.
    const xPts = keyframePoints(o.keyframes, "x", o.start, (v) => v * w);
    const yPts = keyframePoints(o.keyframes, "y", o.start, (v) => v * h);
    const xExpr = buildKeyframeExpr(xPts);
    const yExpr = buildKeyframeExpr(yPts);
    const xArg = xExpr != null ? `'${xExpr}'` : `${Math.round((o.transform?.x ?? 0.1) * w)}`;
    const yArg = yExpr != null ? `'${yExpr}'` : `${Math.round((o.transform?.y ?? 0.1) * h)}`;
    // re-evaluate per frame only when something is actually animated
    const evalArg = (xExpr != null || yExpr != null) ? ":eval=frame" : "";
    const end = o.start + o.duration;
    parts.push(`${curV}[ov${j}]overlay=x=${xArg}:y=${yArg}${evalArg}:enable='between(t,${o.start.toFixed(3)},${end.toFixed(3)})':eof_action=pass[ob${j}]`);
    curV = `[ob${j}]`;
  });

  // Draw vector shapes (rects) onto the composed video, UNDER the subtitles.
  (extra.shapes ?? []).forEach((sh, k) => {
    parts.push(`${curV}${shapeDrawbox(sh, w, h)}[shp${k}]`);
    curV = `[shp${k}]`;
  });

  // Burn positioned text/subtitles (ASS) over the composed video.
  if (extra.assPath) {
    parts.push(`${curV}ass='${escapeFilterPath(extra.assPath)}'[sv]`);
    curV = "[sv]";
  }

  // Mix dedicated audio-track clips into the base audio (positioned + faded).
  if (audioClips.length > 0) {
    // The base (video) audio is the dialogue/"voice" bus; non-ducking clips join it,
    // ducking clips ("background music") form a separate bus that gets compressed by
    // the voice bus via sidechaincompress.
    const voiceLabels = [curA];
    const musicLabels: string[] = [];
    const AFMT = "aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=44100";
    audioClips.forEach((a, k) => {
      const inIdx = segs.length + overlays.length + k;
      const dur = Math.max(0.05, (a.trimOut - a.trimIn) / (a.speed || 1));
      const ac: string[] = [
        `atrim=start=${a.trimIn.toFixed(3)}:end=${a.trimOut.toFixed(3)}`,
        "asetpts=PTS-STARTPTS",
      ];
      if (a.denoise) ac.push("afftdn=nr=20:nf=-30"); // 降噪：对原始音频做 FFT 降噪（实测噪声带降约 12dB）
      if (Math.abs(a.speed - 1) > 0.001) ac.push(...buildAtempoFilters(a.speed));
      if (Math.abs(a.volume - 1) > 0.001) ac.push(`volume=${a.volume.toFixed(3)}`);
      ac.push(...audioFadeFilters(a.fadeIn, a.fadeOut, dur, a.fadeCurve));
      ac.push(`adelay=delays=${Math.round(a.start * 1000)}:all=1`);
      ac.push(AFMT);
      parts.push(`[${inIdx}:a]${ac.join(",")}[ax${k}]`);
      (a.ducking ? musicLabels : voiceLabels).push(`[ax${k}]`);
    });

    if (musicLabels.length === 0) {
      parts.push(`${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0:dropout_transition=0[outa]`);
    } else {
      // voice bus (the sidechain key)
      let keyLabel = voiceLabels[0];
      if (voiceLabels.length > 1) {
        parts.push(`${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0:dropout_transition=0[keyraw]`);
        keyLabel = "[keyraw]";
      }
      // music bus
      let musicLabel = musicLabels[0];
      if (musicLabels.length > 1) {
        parts.push(`${musicLabels.join("")}amix=inputs=${musicLabels.length}:normalize=0:dropout_transition=0[musicraw]`);
        musicLabel = "[musicraw]";
      }
      // duck the music by the voice; split the key so it also survives into the mix
      parts.push(`${keyLabel}${AFMT},asplit=2[keyout][keysc]`);
      parts.push(`${musicLabel}${AFMT}[musicfmt]`);
      parts.push(`[musicfmt][keysc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[ducked]`);
      parts.push(`[keyout][ducked]amix=inputs=2:normalize=0:dropout_transition=0[outa]`);
    }
    curA = "[outa]";
  }

  const outvLabel = finalizeVideo(curV, curDur);
  const outaLabel = finalizeAudio(curA, curDur);
  return { filterComplex: parts.join(";"), outV: outvLabel, outA: outaLabel, duration: curDur };
}

/** Main (base) video-track clips that get concatenated, in play order. */
export function collectVideoSegments(doc: EditorDoc): Clip[] {
  const clips: Clip[] = [];
  for (const t of doc.tracks) {
    if (t.hidden || t.type !== "video") continue;
    for (const c of t.clips) if (c.kind === "video" || c.kind === "image") clips.push(c);
  }
  return clips.sort((a, b) => a.start - b.start);
}

/** Overlay-track clips composited on top of the base, in time order. */
export function collectOverlayClips(doc: EditorDoc): Clip[] {
  const clips: Clip[] = [];
  for (const t of doc.tracks) {
    if (t.hidden || t.type !== "overlay") continue;
    for (const c of t.clips) if (c.kind === "video" || c.kind === "image") clips.push(c);
  }
  return clips.sort((a, b) => a.start - b.start);
}

/** Audio-track clips mixed into the output, in time order. */
export function collectAudioClips(doc: EditorDoc): Clip[] {
  const clips: Clip[] = [];
  for (const t of doc.tracks) {
    if (t.hidden || t.muted || t.type !== "audio") continue;
    for (const c of t.clips) if (c.kind === "audio") clips.push(c);
  }
  return clips.sort((a, b) => a.start - b.start);
}

/** Text clips rendered as ASS dialogue, in time order. */
export function collectTextClips(doc: EditorDoc): TextInput[] {
  const out: TextInput[] = [];
  for (const t of doc.tracks) {
    if (t.hidden || t.type !== "text") continue;
    for (const c of t.clips) {
      if (c.kind !== "text" || !c.text?.content) continue;
      const dur = Math.max(0.05, c.trimOut - c.trimIn);
      out.push({ start: c.start, end: c.start + dur, text: c.text, x: c.transform?.x ?? 0.1, y: c.transform?.y ?? 0.8, boxW: c.transform?.scale ?? 0.4 });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Shape clips (kind "shape") on attachment/overlay/text tracks → raster-overlay sources, time-ordered. */
export function collectShapeClips(doc: EditorDoc): Clip[] {
  const out: Clip[] = [];
  for (const t of doc.tracks) {
    if (t.hidden || (t.type !== "attachment" && t.type !== "overlay" && t.type !== "text")) continue;
    for (const c of t.clips) {
      if (c.kind === "shape" && c.shape) out.push(c);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 形状 → SVG → PNG（resvg 光栅化，带透明通道），返回 PNG 字节。 */
export function rasterizeShape(shape: ShapeSpec, wPx: number, hPx: number): Buffer {
  const svg = shapeToSvg(shape, Math.max(1, wPx), Math.max(1, hPx));
  return Buffer.from(new Resvg(svg, { background: "rgba(0,0,0,0)" }).render().asPng());
}

function clipVisibleDuration(c: Clip): number {
  if (c.kind === "image") return Math.max(0.05, c.trimOut - c.trimIn);
  return Math.max(0.05, (c.trimOut - c.trimIn) / (c.speed ?? 1));
}

// ── 硬件(GPU)编码 ───────────────────────────────────────────────────────────────
// 「ffmpeg -encoders 列出」≠「可用」：无 GPU 时 nvenc/qsv 等会在运行期失败。故用「实跑
// 1 帧」探测真实可用性，结果进程内缓存（探测一次）。
const _hwProbeCache = new Map<string, boolean>();
async function probeEncoder(name: string): Promise<boolean> {
  const cached = _hwProbeCache.get(name);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.1:r=10", "-c:v", name, "-frames:v", "1", "-f", "null", "-"], { timeoutMs: 15000 });
    ok = true;
  } catch { ok = false; }
  _hwProbeCache.set(name, ok);
  return ok;
}

/** drop-in 硬件编码器候选（仅选无需改滤镜链的 nvenc/amf/videotoolbox；qsv/vaapi 需 hwupload，略）。 */
function hwCandidates(isHevc: boolean): string[] {
  return isHevc ? ["hevc_nvenc", "hevc_amf", "hevc_videotoolbox"] : ["h264_nvenc", "h264_amf", "h264_videotoolbox"];
}

/** 硬件编码器输出参数（质量参数因编码器而异；输入 yuv420p 直接喂，GPU 内部上传）。 */
export function hwVideoArgs(encoder: string, crf: number, isHevc: boolean): string[] {
  const tag = isHevc ? ["-tag:v", "hvc1"] : [];
  if (encoder.includes("nvenc")) return ["-c:v", encoder, "-preset", "p5", "-rc", "vbr", "-cq", String(crf), "-b:v", "0", "-pix_fmt", "yuv420p", ...tag];
  if (encoder.includes("amf")) return ["-c:v", encoder, "-rc", "cqp", "-qp_i", String(crf), "-qp_p", String(crf), "-pix_fmt", "yuv420p", ...tag];
  const q = Math.max(10, Math.min(100, Math.round(((51 - crf) / 51) * 100))); // videotoolbox: -q:v 1..100（越大越好）
  return ["-c:v", encoder, "-q:v", String(q), "-pix_fmt", "yuv420p", ...tag];
}

/**
 * Render an EditorDoc to a single MP4 in ONE ffmpeg pass and upload to storage.
 * PR3 scope: the main video track (video + image clips), trim/speed/scale/concat
 * with per-clip audio (silence-filled). Transitions, overlays, text, color, and
 * dedicated audio tracks are layered on in later phases.
 */
export async function composeTimeline(doc: EditorDoc, opts: ComposeOptions): Promise<ComposeResult> {
  const clips = collectVideoSegments(doc);
  // clips whose (video) track is muted → drop their audio in the render
  const mutedClipIds = new Set(doc.tracks.filter((t) => t.type === "video" && t.muted).flatMap((t) => t.clips.map((c) => c.id)));
  // 每个片段所属轨道的音量增益（默认 1）。原声/音轨音量 = 片段音量 × 轨道音量。
  const trackVolOf = new Map<string, number>();
  for (const t of doc.tracks) { const v = t.volume ?? 1; for (const c of t.clips) trackVolOf.set(c.id, v); }
  const effVolume = (c: Clip) => (c.volume ?? 1) * (trackVolOf.get(c.id) ?? 1);
  if (clips.length === 0) throw new Error("时间轴没有可渲染的视频/图片片段");
  const overlayClips = collectOverlayClips(doc);
  const audioClipsSrc = collectAudioClips(doc);
  const textClips = collectTextClips(doc);
  const shapeClips = collectShapeClips(doc);

  const report = (p: number, s: string) => opts.onProgress?.(p, s);
  report(2, "准备素材");

  const tmpFiles: string[] = [];
  const inputArgs: string[] = [];
  const segs: Segment[] = [];
  const overlays: OverlayInput[] = [];
  const audioClips: AudioInput[] = [];
  const total = clips.length + overlayClips.length + audioClipsSrc.length;
  let done = 0;

  try {
    // Main (base) clips first — input order must match the filter graph.
    let skippedNoVideo = 0;
    for (const c of clips) {
      if (!c.assetUrl) throw new Error("片段缺少素材地址");
      const isImage = c.kind === "image";
      const p = await downloadToTemp(c.assetUrl, isImage ? "img" : "mp4");
      tmpFiles.push(p);
      let hasAudio: boolean;
      if (isImage) {
        hasAudio = false;
      } else {
        // Probe BOTH streams in one ffprobe call. A "video" clip that carries no
        // video stream (e.g. an audio file dropped onto the video track, or a
        // corrupt source) would make the filter graph reference a non-existent
        // [i:v] pad → empty video output → libx264 "Could not open encoder
        // before EOF" / code -22. Skip such clips here so the render survives.
        const probe = await probeStreams(p);
        if (!probe.hasVideo) {
          skippedNoVideo++;
          report(2 + Math.round((++done) / total * 28), "下载素材");
          continue;
        }
        hasAudio = mutedClipIds.has(c.id) ? false : probe.hasAudio;
      }
      const trimIn = isImage ? 0 : c.trimIn;
      const trimOut = isImage ? Math.max(0.05, c.trimOut - c.trimIn) : c.trimOut;
      const seg: Segment = { isImage, hasAudio, trimIn, trimOut, speed: c.speed ?? 1, volume: effVolume(c), effects: c.effects, transition: c.transitionIn, fit: c.fit, reverse: c.reverse, transform: c.transform, keyframes: c.keyframes, fadeIn: c.fadeIn, fadeOut: c.fadeOut, fadeCurve: c.fadeCurve, flipH: c.flipH, flipV: c.flipV };
      segs.push(seg);
      if (isImage) inputArgs.push("-loop", "1", "-t", segmentDuration(seg).toFixed(3), "-i", p);
      else inputArgs.push("-i", p);
      report(2 + Math.round((++done) / total * 28), "下载素材");
    }

    // Every base clip turned out to have no usable video stream — bail with a
    // clear, actionable message instead of letting ffmpeg fail opaquely.
    if (segs.length === 0) {
      throw new Error(
        skippedNoVideo > 0
          ? `视频轨道上的 ${skippedNoVideo} 个片段都不包含视频画面（可能是把音频文件拖到了视频轨道，或源文件损坏）。请将纯音频素材放到音频轨道，或移除这些片段后重试。`
          : "时间轴没有可渲染的视频/图片片段",
      );
    }

    // 输出尺寸/帧率（偶数维度——奇数会让 yuv420p 失败）。形状光栅化按此分辨率以保清晰。
    const even = (n: number) => Math.max(2, Math.round(n) - (Math.round(n) % 2));
    const W = even(opts.width ?? doc.width);
    const H = even(opts.height ?? doc.height);
    const fps = Math.max(1, Math.min(120, Math.round(opts.fps ?? doc.fps)));

    // Overlay clips next (composited on top).
    for (const c of overlayClips) {
      if (!c.assetUrl) continue;
      // 动图(GIF/APNG/动态WebP)：当作循环视频处理(逐帧播放并循环铺满时长)，而非静态图片
      // (静态图用 -loop 1 会冻结首帧)。按扩展名识别。
      const animated = /\.(gif|apng|webp)(\?|#|$)/i.test(c.assetUrl);
      const isImage = c.kind === "image" && !animated;
      const p = await downloadToTemp(c.assetUrl, animated ? "gif" : isImage ? "img" : "mp4");
      tmpFiles.push(p);
      const dur = clipVisibleDuration(c);
      overlays.push({ isImage, trimIn: (isImage || animated) ? 0 : c.trimIn, trimOut: (isImage || animated) ? dur : c.trimOut, speed: c.speed ?? 1, start: c.start, duration: dur, transform: c.transform, keyframes: c.keyframes, chromaKey: c.chromaKey, fadeIn: c.fadeIn, fadeOut: c.fadeOut, flipH: c.flipH, flipV: c.flipV, mask: c.mask });
      if (animated) inputArgs.push("-stream_loop", "-1", "-t", dur.toFixed(3), "-i", p); // 循环动图铺满时长
      else if (isImage) inputArgs.push("-loop", "1", "-t", dur.toFixed(3), "-i", p);
      else inputArgs.push("-i", p);
      report(2 + Math.round((++done) / total * 28), "下载素材");
    }

    // 形状/SVG 片段：按输出分辨率光栅化为透明 PNG，作为图片叠加层合成（复用叠加管线：
    // 位置 transform.x/y、尺寸=shape.w/h、时长、透明度/旋转/淡入淡出/蒙版均沿用）。
    for (const c of shapeClips) {
      const sh = c.shape!;
      const wFrac = sh.w ?? 0.3, hFrac = sh.h ?? 0.2;
      const dur = clipVisibleDuration(c);
      try {
        const png = rasterizeShape(sh as ShapeSpec, Math.round(wFrac * W), Math.round(hFrac * H));
        const p = path.join(os.tmpdir(), `shape-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
        await fs.writeFile(p, png);
        tmpFiles.push(p);
        overlays.push({
          isImage: true, trimIn: 0, trimOut: dur, speed: 1, start: c.start, duration: dur,
          transform: { x: c.transform?.x ?? 0.1, y: c.transform?.y ?? 0.1, scale: wFrac, opacity: 1, rotation: c.transform?.rotation },
          fadeIn: c.fadeIn, fadeOut: c.fadeOut,
        });
        inputArgs.push("-loop", "1", "-t", dur.toFixed(3), "-i", p);
      } catch (e) {
        console.error("[videoComposer] 形状光栅化失败，跳过该形状：", e instanceof Error ? e.message : e);
      }
      report(2 + Math.round((++done) / total * 28), "渲染形状");
    }

    // Audio-track clips next (input order: main → overlays → audio).
    for (const c of audioClipsSrc) {
      if (!c.assetUrl) continue;
      const p = await downloadToTemp(c.assetUrl, "m4a");
      tmpFiles.push(p);
      audioClips.push({ trimIn: c.trimIn, trimOut: c.trimOut, speed: c.speed ?? 1, start: c.start, volume: effVolume(c), fadeIn: c.fadeIn ?? 0, fadeOut: c.fadeOut ?? 0, fadeCurve: c.fadeCurve, ducking: c.ducking, denoise: c.denoise });
      inputArgs.push("-i", p);
      report(2 + Math.round((++done) / total * 28), "下载素材");
    }

    // Positioned text/subtitles → ASS file (referenced by the ass filter).
    let assPath: string | undefined;
    if (textClips.length > 0) {
      assPath = path.join(os.tmpdir(), `editor-${Date.now()}-${Math.random().toString(36).slice(2)}.ass`);
      await fs.writeFile(assPath, buildEditorASS(textClips, { width: W, height: H }), "utf8");
      tmpFiles.push(assPath);
    }

    const graph = buildFilterGraph(segs, { width: W, height: H, fps, normalizeAudio: doc.normalizeAudio, masterFadeIn: doc.masterFadeIn, masterFadeOut: doc.masterFadeOut }, overlays, { audioClips, assPath });

    // Export container/codec/quality. Default mp4 + H.264 + high.
    const format = opts.format ?? "mp4";
    const quality = opts.quality ?? "high";
    // H.265/HEVC lives in an .mp4 container (tag hvc1 for QuickTime/Apple players).
    const ext = format === "webm" ? "webm" : format === "mov" ? "mov" : "mp4";
    const mimeType = format === "webm" ? "video/webm" : format === "mov" ? "video/quicktime" : "video/mp4";
    const isWebm = format === "webm";
    const isHevc = format === "hevc";
    // 精细质量：传了 qualityPct(1..100) 则按编码映射成 CRF，覆盖三档预设（只有匹配
    // 当前格式编码的那一路会被实际使用，故三者同赋无副作用）。
    const pctCrf = opts.qualityPct != null ? String(qualityPctToCrf(format, opts.qualityPct)) : null;
    const h264Crf = pctCrf ?? ({ high: "18", medium: "22", low: "27" } as const)[quality];
    const hevcCrf = pctCrf ?? ({ high: "20", medium: "24", low: "28" } as const)[quality];
    const vp9Crf = pctCrf ?? ({ high: "28", medium: "33", low: "38" } as const)[quality];
    // 软件(CPU)编码：质量优先（libx264/265/vpx-vp9）。
    const swVCodec = isWebm
      ? ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", vp9Crf, "-row-mt", "1", "-pix_fmt", "yuv420p"]
      : isHevc
        ? ["-c:v", "libx265", "-preset", "medium", "-crf", hevcCrf, "-tag:v", "hvc1", "-pix_fmt", "yuv420p"]
        : ["-c:v", "libx264", "-preset", "medium", "-crf", h264Crf, "-pix_fmt", "yuv420p"];
    // 硬件(GPU)编码：仅 mp4/mov/hevc（webm 无理想 drop-in 硬件路径，保持软件）。实跑探测，
    // 选第一个真正可用的；都不可用则回退软件。
    let vCodec = swVCodec;
    let hwUsed: string | null = null;
    if (opts.encoder === "hardware" && !isWebm) {
      const crfNum = Number(isHevc ? hevcCrf : h264Crf);
      for (const enc of hwCandidates(isHevc)) {
        if (await probeEncoder(enc)) { vCodec = hwVideoArgs(enc, crfNum, isHevc); hwUsed = enc; break; }
      }
    }
    const aCodec = isWebm ? ["-c:a", "libopus", "-b:a", "160k"] : ["-c:a", "aac", "-b:a", "192k"];
    const containerArgs = isWebm ? [] : ["-movflags", "+faststart"];

    const outName = `compose-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const outPath = path.join(os.tmpdir(), outName);

    const buildArgs = (vc: string[]) => [
      ...inputArgs,
      "-filter_complex", graph.filterComplex,
      "-map", graph.outV, "-map", graph.outA,
      ...vc,
      ...aCodec,
      ...containerArgs,
      "-y", outPath,
    ];

    report(32, hwUsed ? `渲染中（GPU 加速：${hwUsed}）` : "渲染中");
    // 硬件编码若运行期失败（如 GPU 驱动问题），静默回退软件重试一次——保证导出不因 GPU 失败。
    let hwOk = false;
    if (hwUsed) {
      try { await execFileAsync("ffmpeg", buildArgs(vCodec), { timeoutMs: COMPOSE_TIMEOUT_MS }); hwOk = true; }
      catch { hwOk = false; report(32, "GPU 编码失败，回退软件渲染中"); }
    }
    if (!hwOk) try {
      await execFileAsync("ffmpeg", buildArgs(swVCodec), { timeoutMs: COMPOSE_TIMEOUT_MS });
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string; code?: string };
      if (e.code === "ENOENT" || /ENOENT/.test(e.message ?? "")) {
        throw new Error("未找到 ffmpeg：请在服务器安装 ffmpeg（Windows: winget install Gyan.FFmpeg）并重启应用；或设置环境变量 FFMPEG_PATH 指向 ffmpeg 可执行文件。");
      }
      const stderr = e.stderr ?? "";
      // Log the FULL stderr server-side for diagnosis — the user-facing message
      // is necessarily truncated.
      if (stderr) console.error("[videoComposer] ffmpeg failed; filter_complex=\n" + graph.filterComplex + "\n--- stderr ---\n" + stderr);
      // Surface the FIRST meaningful root-cause line (filter graph / mapping
      // errors), not just the encoder-failure tail which hides why the stream
      // was empty ("Could not open encoder before EOF").
      const rootLine = stderr
        .split(/\r?\n/)
        .map((l) => l.trim())
        // Prefer the SPECIFIC cause line (e.g. "...timebase ... do not match",
        // "...parameters ... do not match", "matches no streams") over the
        // generic "Failed to configure output pad" that ffmpeg prints right
        // after it; also skip the encoder-failure tail which hides the root.
        .find((l) => /do not match|matches no streams|No such filter|Invalid argument|Error (initializing|reinitializing|applying|parsing|opening)|Cannot|Impossible to convert|deprecated pixel format/i.test(l)
          && !/Could not open encoder|Terminating thread|received no packets|Task finished with error|Failed to configure output pad|Error reinitializing filters/i.test(l));
      const detail = rootLine || stderr.slice(-600) || e.message || String(err);
      // No "渲染失败：" prefix here — the client already prepends it when showing
      // the job error (avoids the doubled "渲染失败：渲染失败：").
      throw new Error(detail);
    }
    report(88, "上传成片");

    const outBuffer = await fs.readFile(outPath);
    tmpFiles.push(outPath);
    await assertObjectStorageWritable();
    const namePart = sanitizeFilenamePrefix(opts.projectName || "成片") || "成片";
    const key = `u/${opts.userId}/editor/${namePart}-${Date.now()}.${ext}`;
    const { url, key: storageKey } = await storagePut(key, outBuffer, mimeType);

    report(100, "完成");
    return { url, storageKey, duration: graph.duration };
  } finally {
    await Promise.all(tmpFiles.map((f) => fs.unlink(f).catch(() => undefined)));
  }
}
