import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { storagePut, assertObjectStorageWritable } from "../storage";
import { execFileAsync, downloadToTemp, buildAtempoFilters, probeStreams, cssColorToASSHex, escapeASSText, formatASSTime } from "./videoEditor";
import { sanitizeFilenamePrefix } from "./comfyui";
import type { EditorDoc, Clip, ClipEffects, ClipTransform, ClipText, FitMode, TransformKeyframe } from "@shared/editorTypes";

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
  effects?: ClipEffects;                          // color/filter (eq + preset)
  transition?: { type: string; duration: number }; // entry transition vs the previous segment
  fit?: FitMode;                                  // contain (default) | cover | stretch | blur
  reverse?: boolean;                              // 倒放：逆序播放（图片无效）
  transform?: ClipTransform;                      // main-track zoom(scale≥1)/pan(x,y)/rotate within the frame
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

/** ffmpeg filters that fit a frame into the output canvas per the fit mode. */
function fitChain(fit: FitMode | undefined, w: number, h: number): string[] {
  switch (fit) {
    case "cover":   // 填充：放大铺满，裁掉溢出
      return [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`];
    case "stretch": // 拉伸：精确铺满，可能变形
      return [`scale=${w}:${h}`];
    default:        // 适应：完整显示，居中留黑边
      return [`scale=${w}:${h}:force_original_aspect_ratio=decrease`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`];
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
}

/** Build a piecewise-linear ffmpeg expression (in the overlay's `t` time base, in
 *  seconds) for a keyframed field. Values hold flat before the first and after the
 *  last point. Returns null when there are no keyframes for the field. `pts` must
 *  be sorted ascending by `t`; `v` is already in target units (e.g. pixels). */
export function buildKeyframeExpr(pts: { t: number; v: number }[]): string | null {
  if (pts.length === 0) return null;
  const f = (n: number) => Number(n.toFixed(4)).toString();
  if (pts.length === 1) return f(pts[0].v); // single keyframe → constant
  let expr = f(pts[pts.length - 1].v); // after the last point: hold
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i], b = pts[i + 1];
    const slope = (b.v - a.v) / Math.max(1e-6, b.t - a.t);
    expr = `if(lt(t,${f(b.t)}),(${f(a.v)}+(t-${f(a.t)})*${f(slope)}),${expr})`;
  }
  return `if(lt(t,${f(pts[0].t)}),${f(pts[0].v)},${expr})`; // before the first: hold
}

/** Sorted keyframe points for one field, with clip-relative time shifted by
 *  `tOffset` (absolute timeline seconds for the overlay clock) and values mapped
 *  by `toUnit` (e.g. normalized→pixels). Empty when no keyframe defines the field. */
function keyframePoints(
  kfs: TransformKeyframe[] | undefined, field: "x" | "y", tOffset: number, toUnit: (v: number) => number,
): { t: number; v: number }[] {
  if (!kfs || kfs.length === 0) return [];
  return kfs
    .filter((k) => k[field] != null)
    .sort((a, b) => a.t - b.t)
    .map((k) => ({ t: k.t + tOffset, v: toUnit(k[field] as number) }));
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
}

/** A text clip rendered as an ASS dialogue event. */
export interface TextInput {
  start: number;
  end: number;
  text: ClipText;
  x: number;           // 0..1 of canvas (top-left anchor)
  y: number;           // 0..1 of canvas
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
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = clips.map((c) => {
    const t = c.text;
    const size = t.size ?? 48;
    const color = cssColorToASSHex(t.color ?? "white");
    const px = Math.round(c.x * opts.width);
    const py = Math.round(c.y * opts.height);
    // base styling tags shared by all motion styles
    const base: string[] = [`\\fs${size}`, `\\c${color}`];
    // Strip override-block delimiters from the font name so a `}` can't close
    // the tag block early and inject arbitrary ASS tags/text into the render.
    if (t.font) base.push(`\\fn${t.font.replace(/[{}\\]/g, "")}`); // requires the font installed on the render host
    if (t.bold) base.push("\\b1");
    if (t.italic) base.push("\\i1");
    // 描边 (outline): explicit width + colour, or 0 to disable the style default
    base.push(`\\bord${t.strokeWidth && t.strokeWidth > 0 ? t.strokeWidth : 0}`);
    if (t.strokeWidth && t.strokeWidth > 0) base.push(`\\3c${cssColorToASSHex(t.strokeColor ?? "black")}`);
    // 投影 (shadow): depth + back colour, or 0
    base.push(`\\shad${t.shadow ? 3 : 0}`);
    if (t.shadow) base.push(`\\4c${cssColorToASSHex(t.shadowColor ?? "#000000")}`);

    const motion = t.motionStyle;
    if (motion === "roll") {
      return `Dialogue: 0,${formatASSTime(c.start)},${formatASSTime(c.end)},Default,,0,0,0,,{\\an7\\move(${px},${opts.height},${px},${py})${base.join("")}}${escapeASSText(t.content)}`;
    }
    const tags = [`\\an7`, `\\pos(${px},${py})`, ...base];
    if (motion === "fade") tags.push("\\fad(300,300)");
    else if (motion === "bounce" || motion === "karaoke") tags.push("\\fad(200,200)");
    return `Dialogue: 0,${formatASSTime(c.start)},${formatASSTime(c.end)},Default,,0,0,0,,{${tags.join("")}}${escapeASSText(t.content)}`;
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
function xfadeName(t: string): string {
  switch (t) {
    case "dissolve": return "dissolve";
    case "slide": return "slideleft";
    case "wipe": return "wipeleft";
    case "fade": default: return "fade";
  }
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
  opts: { width: number; height: number; fps: number },
  overlays: OverlayInput[] = [],
  extra: { audioClips?: AudioInput[]; assPath?: string } = {},
): { filterComplex: string; outV: string; outA: string; duration: number } {
  const { fps } = opts;
  // even dims only (libx264/yuv420p reject odd sizes → empty graph, -22)
  const w = Math.max(2, opts.width - (opts.width % 2));
  const h = Math.max(2, opts.height - (opts.height % 2));
  const parts: string[] = [];
  const vLabels: string[] = [];
  const aLabels: string[] = [];

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
    // Pin the timebase so every segment matches when folded. concat emits a
    // microsecond timebase (1/1000000) while fps-filtered segments are 1/fps;
    // feeding a concat (hard cut) output into a later xfade alongside a fresh
    // segment then fails with "timebase ... do not match" → "Failed to
    // configure output pad". settb keeps all combine inputs on 1/fps.
    const post: string[] = ["setsar=1", `fps=${fps}`, ...colorChain(s.effects), "format=yuv420p", `settb=1/${fps}`];

    if (s.fit === "blur") {
      // 模糊填充：同一画面放大铺满 + 高斯/盒式模糊作背景，原画完整居中叠加，消除黑边。
      parts.push(`[${i}:v]${pre.join(",")},split[bg${i}][fg${i}]`);
      parts.push(`[bg${i}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:2,setsar=1[bgb${i}]`);
      parts.push(`[fg${i}]scale=${w}:${h}:force_original_aspect_ratio=decrease,setsar=1[fgs${i}]`);
      parts.push(`[bgb${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2,${post.join(",")}[v${i}]`);
    } else {
      parts.push(`[${i}:v]${[...pre, ...fitChain(s.fit, w, h), ...segmentTransformChain(s.transform, w, h), ...post].join(",")}[v${i}]`);
    }
    vLabels.push(`[v${i}]`);

    // ── audio chain ── (real audio when present, otherwise silence of clip length)
    if (s.hasAudio) {
      const aChain: string[] = [`atrim=start=${s.trimIn.toFixed(3)}:end=${s.trimOut.toFixed(3)}`];
      if (s.reverse) aChain.push("areverse");      // 倒放：音频同步逆序
      aChain.push("asetpts=PTS-STARTPTS");
      if (Math.abs(s.speed - 1) > 0.001) aChain.push(...buildAtempoFilters(s.speed));
      aChain.push("aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=44100");
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
  if (!hasTransitions(segs) && overlays.length === 0 && audioClips.length === 0 && !extra.assPath) {
    const concatInputs = segs.map((_, i) => `${vLabels[i]}${aLabels[i]}`).join("");
    parts.push(`${concatInputs}concat=n=${segs.length}:v=1:a=1[outv][outa]`);
    const duration = segs.reduce((sum, s) => sum + segmentDuration(s), 0);
    return { filterComplex: parts.join(";"), outV: "[outv]", outA: "[outa]", duration };
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
    oc.push(`scale=${scaleW}:-2`);
    oc.push(`fps=${fps}`);
    oc.push("format=rgba");
    const op = o.transform?.opacity ?? 1;
    if (op < 0.999) oc.push(`colorchannelmixer=aa=${op.toFixed(3)}`);
    const rot = o.transform?.rotation ?? 0;
    if (rot) oc.push(`rotate=${(rot * Math.PI / 180).toFixed(5)}:c=none:ow=rotw(iw):oh=roth(ih)`);
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

  // Burn positioned text/subtitles (ASS) over the composed video.
  if (extra.assPath) {
    parts.push(`${curV}ass='${escapeFilterPath(extra.assPath)}'[sv]`);
    curV = "[sv]";
  }

  // Mix dedicated audio-track clips into the base audio (positioned + faded).
  if (audioClips.length > 0) {
    const mixLabels = [curA];
    audioClips.forEach((a, k) => {
      const inIdx = segs.length + overlays.length + k;
      const dur = Math.max(0.05, (a.trimOut - a.trimIn) / (a.speed || 1));
      const ac: string[] = [
        `atrim=start=${a.trimIn.toFixed(3)}:end=${a.trimOut.toFixed(3)}`,
        "asetpts=PTS-STARTPTS",
      ];
      if (Math.abs(a.speed - 1) > 0.001) ac.push(...buildAtempoFilters(a.speed));
      if (Math.abs(a.volume - 1) > 0.001) ac.push(`volume=${a.volume.toFixed(3)}`);
      if (a.fadeIn > 0) ac.push(`afade=t=in:st=0:d=${a.fadeIn.toFixed(3)}`);
      if (a.fadeOut > 0) ac.push(`afade=t=out:st=${Math.max(0, dur - a.fadeOut).toFixed(3)}:d=${a.fadeOut.toFixed(3)}`);
      ac.push(`adelay=delays=${Math.round(a.start * 1000)}:all=1`);
      ac.push("aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=44100");
      parts.push(`[${inIdx}:a]${ac.join(",")}[ax${k}]`);
      mixLabels.push(`[ax${k}]`);
    });
    parts.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0:dropout_transition=0[outa]`);
    curA = "[outa]";
  }

  return { filterComplex: parts.join(";"), outV: curV, outA: curA, duration: curDur };
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
      out.push({ start: c.start, end: c.start + dur, text: c.text, x: c.transform?.x ?? 0.1, y: c.transform?.y ?? 0.8 });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function clipVisibleDuration(c: Clip): number {
  if (c.kind === "image") return Math.max(0.05, c.trimOut - c.trimIn);
  return Math.max(0.05, (c.trimOut - c.trimIn) / (c.speed ?? 1));
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
  if (clips.length === 0) throw new Error("时间轴没有可渲染的视频/图片片段");
  const overlayClips = collectOverlayClips(doc);
  const audioClipsSrc = collectAudioClips(doc);
  const textClips = collectTextClips(doc);

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
      const seg: Segment = { isImage, hasAudio, trimIn, trimOut, speed: c.speed ?? 1, effects: c.effects, transition: c.transitionIn, fit: c.fit, reverse: c.reverse, transform: c.transform };
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

    // Overlay clips next (composited on top).
    for (const c of overlayClips) {
      if (!c.assetUrl) continue;
      const isImage = c.kind === "image";
      const p = await downloadToTemp(c.assetUrl, isImage ? "img" : "mp4");
      tmpFiles.push(p);
      const dur = clipVisibleDuration(c);
      overlays.push({ isImage, trimIn: isImage ? 0 : c.trimIn, trimOut: isImage ? dur : c.trimOut, speed: c.speed ?? 1, start: c.start, duration: dur, transform: c.transform, keyframes: c.keyframes });
      if (isImage) inputArgs.push("-loop", "1", "-t", dur.toFixed(3), "-i", p);
      else inputArgs.push("-i", p);
      report(2 + Math.round((++done) / total * 28), "下载素材");
    }

    // Audio-track clips next (input order: main → overlays → audio).
    for (const c of audioClipsSrc) {
      if (!c.assetUrl) continue;
      const p = await downloadToTemp(c.assetUrl, "m4a");
      tmpFiles.push(p);
      audioClips.push({ trimIn: c.trimIn, trimOut: c.trimOut, speed: c.speed ?? 1, start: c.start, volume: c.volume ?? 1, fadeIn: c.fadeIn ?? 0, fadeOut: c.fadeOut ?? 0 });
      inputArgs.push("-i", p);
      report(2 + Math.round((++done) / total * 28), "下载素材");
    }

    // libx264 + yuv420p require EVEN dimensions — odd width/height (e.g. from a
    // custom canvas size) makes format=yuv420p fail and the whole graph produce
    // no packets (both encoders error -22). Round down to even. Resolution/fps
    // may be overridden by the export settings (default = doc dimensions).
    const even = (n: number) => Math.max(2, Math.round(n) - (Math.round(n) % 2));
    const W = even(opts.width ?? doc.width);
    const H = even(opts.height ?? doc.height);
    const fps = Math.max(1, Math.min(120, Math.round(opts.fps ?? doc.fps)));

    // Positioned text/subtitles → ASS file (referenced by the ass filter).
    let assPath: string | undefined;
    if (textClips.length > 0) {
      assPath = path.join(os.tmpdir(), `editor-${Date.now()}-${Math.random().toString(36).slice(2)}.ass`);
      await fs.writeFile(assPath, buildEditorASS(textClips, { width: W, height: H }), "utf8");
      tmpFiles.push(assPath);
    }

    const graph = buildFilterGraph(segs, { width: W, height: H, fps }, overlays, { audioClips, assPath });

    // Export container/codec/quality. Default mp4 + H.264 + high.
    const format = opts.format ?? "mp4";
    const quality = opts.quality ?? "high";
    // H.265/HEVC lives in an .mp4 container (tag hvc1 for QuickTime/Apple players).
    const ext = format === "webm" ? "webm" : format === "mov" ? "mov" : "mp4";
    const mimeType = format === "webm" ? "video/webm" : format === "mov" ? "video/quicktime" : "video/mp4";
    const isWebm = format === "webm";
    const isHevc = format === "hevc";
    const h264Crf = ({ high: "18", medium: "22", low: "27" } as const)[quality];
    const hevcCrf = ({ high: "20", medium: "24", low: "28" } as const)[quality];
    const vp9Crf = ({ high: "28", medium: "33", low: "38" } as const)[quality];
    const vCodec = isWebm
      ? ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", vp9Crf, "-row-mt", "1", "-pix_fmt", "yuv420p"]
      : isHevc
        ? ["-c:v", "libx265", "-preset", "medium", "-crf", hevcCrf, "-tag:v", "hvc1", "-pix_fmt", "yuv420p"]
        : ["-c:v", "libx264", "-preset", "medium", "-crf", h264Crf, "-pix_fmt", "yuv420p"];
    const aCodec = isWebm ? ["-c:a", "libopus", "-b:a", "160k"] : ["-c:a", "aac", "-b:a", "192k"];
    const containerArgs = isWebm ? [] : ["-movflags", "+faststart"];

    const outName = `compose-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const outPath = path.join(os.tmpdir(), outName);

    const args = [
      ...inputArgs,
      "-filter_complex", graph.filterComplex,
      "-map", graph.outV, "-map", graph.outA,
      ...vCodec,
      ...aCodec,
      ...containerArgs,
      "-y", outPath,
    ];

    report(32, "渲染中");
    try {
      await execFileAsync("ffmpeg", args, { timeoutMs: COMPOSE_TIMEOUT_MS });
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
