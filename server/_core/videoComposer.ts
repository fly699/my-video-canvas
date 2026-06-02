import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { storagePut, assertObjectStorageWritable } from "../storage";
import { execFileAsync, downloadToTemp, buildAtempoFilters, hasAudioTrack } from "./videoEditor";
import { sanitizeFilenamePrefix } from "./comfyui";
import type { EditorDoc, Clip } from "@shared/editorTypes";

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
}

/** Visible (output) duration of a segment in seconds. */
export function segmentDuration(s: Segment): number {
  if (s.isImage) return Math.max(0.05, s.trimOut - s.trimIn);
  return Math.max(0.05, (s.trimOut - s.trimIn) / (s.speed || 1));
}

/**
 * Build the single ffmpeg `-filter_complex` graph that normalizes every segment
 * to the output canvas and concatenates them — video AND audio — in ONE pass.
 * Pure function (no I/O) so it can be unit-tested. Input index i corresponds to
 * segment i (added to ffmpeg in the same order).
 */
export function buildFilterGraph(segs: Segment[], opts: { width: number; height: number; fps: number }): {
  filterComplex: string; outV: string; outA: string;
} {
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

  // Interleave v/a labels for concat.
  const concatInputs = segs.map((_, i) => `${vLabels[i]}${aLabels[i]}`).join("");
  parts.push(`${concatInputs}concat=n=${segs.length}:v=1:a=1[outv][outa]`);

  return { filterComplex: parts.join(";"), outV: "[outv]", outA: "[outa]" };
}

/** Collect the clips that contribute to the rendered video, in play order. */
export function collectVideoSegments(doc: EditorDoc): Clip[] {
  const clips: Clip[] = [];
  for (const t of doc.tracks) {
    if (t.hidden) continue;
    if (t.type !== "video" && t.type !== "overlay") continue;
    for (const c of t.clips) if (c.kind === "video" || c.kind === "image") clips.push(c);
  }
  return clips.sort((a, b) => a.start - b.start);
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

  const report = (p: number, s: string) => opts.onProgress?.(p, s);
  report(2, "准备素材");

  const tmpFiles: string[] = [];
  const inputArgs: string[] = [];
  const segs: Segment[] = [];

  try {
    // Download every source + probe audio (sequential is fine; counts as progress).
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      if (!c.assetUrl) throw new Error("片段缺少素材地址");
      const isImage = c.kind === "image";
      const ext = isImage ? "img" : "mp4";
      const p = await downloadToTemp(c.assetUrl, ext);
      tmpFiles.push(p);
      const hasAudio = isImage ? false : await hasAudioTrack(p);
      const speed = c.speed ?? 1;
      const trimIn = isImage ? 0 : c.trimIn;
      const trimOut = isImage ? Math.max(0.05, c.trimOut - c.trimIn) : c.trimOut;
      const seg: Segment = { isImage, hasAudio, trimIn, trimOut, speed };
      segs.push(seg);
      // Image inputs must be looped for their visible duration.
      if (isImage) inputArgs.push("-loop", "1", "-t", segmentDuration(seg).toFixed(3), "-i", p);
      else inputArgs.push("-i", p);
      report(2 + Math.round((i + 1) / clips.length * 28), "下载素材");
    }

    const { filterComplex, outV, outA } = buildFilterGraph(segs, { width: doc.width, height: doc.height, fps: doc.fps });

    const outName = `compose-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
    const outPath = path.join(os.tmpdir(), outName);

    const args = [
      ...inputArgs,
      "-filter_complex", filterComplex,
      "-map", outV, "-map", outA,
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

    const duration = segs.reduce((sum, s) => sum + segmentDuration(s), 0);
    report(100, "完成");
    return { url, storageKey, duration };
  } finally {
    await Promise.all(tmpFiles.map((f) => fs.unlink(f).catch(() => undefined)));
  }
}
