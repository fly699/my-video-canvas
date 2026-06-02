import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { storagePut, assertObjectStorageWritable } from "../storage";
import { execFileAsync, downloadToTemp, buildAtempoFilters, hasAudioTrack, cssColorToASSHex, escapeASSText, formatASSTime } from "./videoEditor";
import { sanitizeFilenamePrefix } from "./comfyui";
import type { EditorDoc, Clip, ClipEffects, ClipTransform, ClipText } from "@shared/editorTypes";

// Render timeouts are generous: a full multi-clip render re-encodes everything
// in ONE pass, which can take minutes for long timelines.
const COMPOSE_TIMEOUT_MS = 20 * 60_000;

export interface ComposeOptions {
  userId: number;
  projectName?: string | null;
  onProgress?: (pct: number, stage: string) => void;
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
    const size = c.text.size ?? 48;
    const color = cssColorToASSHex(c.text.color ?? "white");
    const px = Math.round(c.x * opts.width);
    const py = Math.round(c.y * opts.height);
    const tags = [`\\an7`, `\\pos(${px},${py})`, `\\fs${size}`, `\\c${color}`];
    const motion = c.text.motionStyle;
    if (motion === "fade") tags.push("\\fad(300,300)");
    else if (motion === "roll") return `Dialogue: 0,${formatASSTime(c.start)},${formatASSTime(c.end)},Default,,0,0,0,,{\\an7\\move(${px},${opts.height},${px},${py})\\fs${size}\\c${color}}${escapeASSText(c.text.content)}`;
    else if (motion === "bounce" || motion === "karaoke") tags.push("\\fad(200,200)");
    return `Dialogue: 0,${formatASSTime(c.start)},${formatASSTime(c.end)},Default,,0,0,0,,{${tags.join("")}}${escapeASSText(c.text.content)}`;
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
  const { width: w, height: h, fps } = opts;
  const parts: string[] = [];
  const vLabels: string[] = [];
  const aLabels: string[] = [];

  segs.forEach((s, i) => {
    const dur = segmentDuration(s);
    // ── video chain ──
    const vChain: string[] = [];
    if (!s.isImage) {
      vChain.push(`trim=start=${s.trimIn.toFixed(3)}:end=${s.trimOut.toFixed(3)}`);
      vChain.push("setpts=PTS-STARTPTS");
      if (Math.abs(s.speed - 1) > 0.001) vChain.push(`setpts=${(1 / s.speed).toFixed(6)}*PTS`);
    } else {
      vChain.push("setpts=PTS-STARTPTS");
    }
    vChain.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease`);
    vChain.push(`pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`);
    vChain.push("setsar=1");
    vChain.push(`fps=${fps}`);
    vChain.push(...colorChain(s.effects));
    vChain.push("format=yuv420p");
    parts.push(`[${i}:v]${vChain.join(",")}[v${i}]`);
    vLabels.push(`[v${i}]`);

    // ── audio chain ── (real audio when present, otherwise silence of clip length)
    if (s.hasAudio) {
      const aChain: string[] = [
        `atrim=start=${s.trimIn.toFixed(3)}:end=${s.trimOut.toFixed(3)}`,
        "asetpts=PTS-STARTPTS",
      ];
      if (Math.abs(s.speed - 1) > 0.001) aChain.push(...buildAtempoFilters(s.speed));
      aChain.push("aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=44100");
      parts.push(`[${i}:a]${aChain.join(",")}[a${i}]`);
    } else {
      parts.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
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
      parts.push(`${curV}${vLabels[i]}xfade=transition=${xfadeName(tr!.type)}:duration=${td.toFixed(3)}:offset=${off.toFixed(3)}[vf${i}]`);
      parts.push(`${curA}${aLabels[i]}acrossfade=d=${td.toFixed(3)}[af${i}]`);
      curV = `[vf${i}]`; curA = `[af${i}]`;
      curDur = curDur + dur - td;
    } else {
      parts.push(`${curV}${vLabels[i]}concat=n=2:v=1:a=0[vf${i}]`);
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

    const x = Math.round((o.transform?.x ?? 0.1) * w);
    const y = Math.round((o.transform?.y ?? 0.1) * h);
    const end = o.start + o.duration;
    parts.push(`${curV}[ov${j}]overlay=x=${x}:y=${y}:enable='between(t,${o.start.toFixed(3)},${end.toFixed(3)})':eof_action=pass[ob${j}]`);
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
    for (const c of clips) {
      if (!c.assetUrl) throw new Error("片段缺少素材地址");
      const isImage = c.kind === "image";
      const p = await downloadToTemp(c.assetUrl, isImage ? "img" : "mp4");
      tmpFiles.push(p);
      const hasAudio = isImage ? false : await hasAudioTrack(p);
      const trimIn = isImage ? 0 : c.trimIn;
      const trimOut = isImage ? Math.max(0.05, c.trimOut - c.trimIn) : c.trimOut;
      const seg: Segment = { isImage, hasAudio, trimIn, trimOut, speed: c.speed ?? 1, effects: c.effects, transition: c.transitionIn };
      segs.push(seg);
      if (isImage) inputArgs.push("-loop", "1", "-t", segmentDuration(seg).toFixed(3), "-i", p);
      else inputArgs.push("-i", p);
      report(2 + Math.round((++done) / total * 28), "下载素材");
    }

    // Overlay clips next (composited on top).
    for (const c of overlayClips) {
      if (!c.assetUrl) continue;
      const isImage = c.kind === "image";
      const p = await downloadToTemp(c.assetUrl, isImage ? "img" : "mp4");
      tmpFiles.push(p);
      const dur = clipVisibleDuration(c);
      overlays.push({ isImage, trimIn: isImage ? 0 : c.trimIn, trimOut: isImage ? dur : c.trimOut, speed: c.speed ?? 1, start: c.start, duration: dur, transform: c.transform });
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

    // Positioned text/subtitles → ASS file (referenced by the ass filter).
    let assPath: string | undefined;
    if (textClips.length > 0) {
      assPath = path.join(os.tmpdir(), `editor-${Date.now()}-${Math.random().toString(36).slice(2)}.ass`);
      await fs.writeFile(assPath, buildEditorASS(textClips, { width: doc.width, height: doc.height }), "utf8");
      tmpFiles.push(assPath);
    }

    const graph = buildFilterGraph(segs, { width: doc.width, height: doc.height, fps: doc.fps }, overlays, { audioClips, assPath });

    const outName = `compose-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
    const outPath = path.join(os.tmpdir(), outName);

    const args = [
      ...inputArgs,
      "-filter_complex", graph.filterComplex,
      "-map", graph.outV, "-map", graph.outA,
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      "-y", outPath,
    ];

    report(32, "渲染中");
    try {
      await execFileAsync("ffmpeg", args, { timeoutMs: COMPOSE_TIMEOUT_MS });
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      throw new Error("渲染失败：" + (e.stderr?.slice(-600) || e.message || String(err)));
    }
    report(88, "上传成片");

    const outBuffer = await fs.readFile(outPath);
    tmpFiles.push(outPath);
    await assertObjectStorageWritable();
    const namePart = sanitizeFilenamePrefix(opts.projectName || "成片") || "成片";
    const key = `u/${opts.userId}/editor/${namePart}-${Date.now()}.mp4`;
    const { url, key: storageKey } = await storagePut(key, outBuffer, "video/mp4");

    report(100, "完成");
    return { url, storageKey, duration: graph.duration };
  } finally {
    await Promise.all(tmpFiles.map((f) => fs.unlink(f).catch(() => undefined)));
  }
}
