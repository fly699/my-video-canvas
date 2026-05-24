import { execFile } from "child_process";
import { promisify } from "util";
import { storagePut } from "../storage";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const _execFileRaw = promisify(execFile);
const FFMPEG_TIMEOUT_MS = 120_000;
const FFPROBE_TIMEOUT_MS = 30_000;

function execFileAsync(cmd: "ffmpeg" | "ffprobe", args: string[]) {
  const timeout = cmd === "ffprobe" ? FFPROBE_TIMEOUT_MS : FFMPEG_TIMEOUT_MS;
  return _execFileRaw(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function assertSafeUrl(url: string): void {
  const { protocol, hostname } = new URL(url);
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error(`Unsupported URL scheme: ${protocol}`);
  }
  // URL.hostname wraps IPv6 addresses in brackets (e.g. "[::1]") — strip them before pattern matching.
  const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const privatePatterns = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^::1$/,
    /^::ffff:/i,
    /^0\./,
    /^fd[0-9a-f]{2}:/i,
  ];
  if (privatePatterns.some((p) => p.test(host))) {
    throw new Error(`Access to private/local hosts is not allowed: ${hostname}`);
  }
}

async function downloadToTemp(url: string, ext: string): Promise<string> {
  assertSafeUrl(url);
  const uniqueName = `ffmpeg-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const tmpPath = path.join(os.tmpdir(), uniqueName);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status} ${res.statusText}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(tmpPath, buf);
  return tmpPath;
}

function buildAtempoFilters(speed: number): string[] {
  // atempo supports 0.5–2.0; chain multiple filters for values outside this range
  const filters: string[] = [];

  if (speed < 0.5) {
    // e.g. speed=0.25 → atempo=0.5,atempo=0.5
    let remaining = speed;
    while (remaining < 0.5) {
      filters.push("atempo=0.5");
      remaining /= 0.5;
    }
    // Remaining adjustment (if exactly lands on 0.5 chains, no extra needed)
    if (Math.abs(remaining - 1.0) > 0.001) {
      filters.push(`atempo=${remaining.toFixed(6)}`);
    }
  } else if (speed > 2.0) {
    // e.g. speed=4.0 → atempo=2.0,atempo=2.0
    let remaining = speed;
    while (remaining > 2.0) {
      filters.push("atempo=2.0");
      remaining /= 2.0;
    }
    if (Math.abs(remaining - 1.0) > 0.001) {
      filters.push(`atempo=${remaining.toFixed(6)}`);
    }
  } else {
    filters.push(`atempo=${speed.toFixed(6)}`);
  }

  return filters;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface TrimOptions {
  inputUrl: string;
  startTime: number;    // seconds
  endTime: number;      // seconds
  speed?: number;       // 0.25–4.0, default 1.0 (1.0 = no change)
  audioUrl?: string;    // optional audio track URL to replace/mix in
  audioVolume?: number; // 0.0–2.0 volume for mixed audio (default 1.0)
}

export interface TrimResult {
  url: string;
  duration: number;
}

export async function trimVideo(opts: TrimOptions): Promise<TrimResult> {
  const speed = opts.speed ?? 1.0;
  const audioVolume = opts.audioVolume ?? 1.0;

  const ext = "mp4";
  const inputPath = await downloadToTemp(opts.inputUrl, ext);

  const outName = `ffmpeg-out-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const outPath = path.join(os.tmpdir(), outName);

  let audioPath: string | null = null;

  try {
    // Download optional audio track
    if (opts.audioUrl) {
      audioPath = await downloadToTemp(opts.audioUrl, "m4a");
    }

    const args: string[] = [];

    // Fast seek before input
    args.push("-ss", String(opts.startTime));
    args.push("-to", String(opts.endTime));
    args.push("-i", inputPath);

    if (audioPath) {
      args.push("-i", audioPath);
    }

    const hasSpeedChange = Math.abs(speed - 1.0) > 0.001;

    if (!hasSpeedChange && !audioPath) {
      // Simple copy — fastest path
      args.push("-c:v", "copy");
      args.push("-c:a", "copy");
    } else if (!hasSpeedChange && audioPath) {
      // Replace audio, no speed change
      args.push("-map", "0:v");
      args.push("-map", "1:a");
      args.push("-c:v", "copy");
      args.push("-c:a", "aac");
      if (Math.abs(audioVolume - 1.0) > 0.001) {
        args.push("-af", `volume=${audioVolume.toFixed(4)}`);
      }
      args.push("-shortest");
    } else {
      // Speed change required — must re-encode
      const videoFilter = `setpts=${(1 / speed).toFixed(6)}*PTS`;
      const atempoFilters = buildAtempoFilters(speed);

      if (audioPath) {
        // Custom audio + speed change
        const audioFilter = [
          `volume=${audioVolume.toFixed(4)}`,
          ...atempoFilters,
        ].join(",");

        args.push("-map", "0:v");
        args.push("-map", "1:a");
        args.push("-vf", videoFilter);
        args.push("-af", audioFilter);
        args.push("-c:v", "libx264");
        args.push("-preset", "fast");
        args.push("-c:a", "aac");
        args.push("-shortest");
      } else {
        // Speed change on original audio
        const audioFilter = atempoFilters.join(",");

        args.push("-vf", videoFilter);
        args.push("-af", audioFilter);
        args.push("-c:v", "libx264");
        args.push("-preset", "fast");
        args.push("-c:a", "aac");
      }
    }

    // Output options
    args.push("-movflags", "+faststart");
    args.push("-y"); // overwrite without prompt
    args.push(outPath);

    let stderrOutput = "";
    try {
      const result = await execFileAsync("ffmpeg", args);
      stderrOutput = result.stderr ?? "";
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; stdout?: string; message?: string };
      stderrOutput = execErr.stderr ?? "";
      throw new Error(
        `FFmpeg failed:\n${stderrOutput || (execErr.message ?? String(err))}`
      );
    }

    // Read output and upload to storage
    const outBuffer = await fs.readFile(outPath);
    const { url } = await storagePut(`generated/clip-${Date.now()}.mp4`, outBuffer, "video/mp4");

    // Calculate duration
    const duration = (opts.endTime - opts.startTime) / speed;

    return { url, duration };
  } finally {
    // Clean up all temp files
    await fs.unlink(inputPath).catch(() => undefined);
    await fs.unlink(outPath).catch(() => undefined);
    if (audioPath) {
      await fs.unlink(audioPath).catch(() => undefined);
    }
  }
}

// ── Merge ─────────────────────────────────────────────────────────────────────

export interface MergeOptions {
  inputUrls: string[];
  transition?: "none" | "fade" | "dissolve";
  transitionDuration?: number;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
}

export interface MergeResult {
  url: string;
  duration: number;
}

export async function mergeVideos(opts: MergeOptions): Promise<MergeResult> {
  const transition = opts.transition ?? "none";
  const td = opts.transitionDuration ?? 0.5;
  const bgVol = opts.bgMusicVolume ?? 0.3;

  const inputPaths: string[] = [];
  const outName = `ffmpeg-merge-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const outPath = path.join(os.tmpdir(), outName);
  let bgMusicPath: string | null = null;

  try {
    // Download sequentially so inputPaths is populated incrementally;
    // the finally block can then clean up whichever files were created
    // even if a mid-array download fails.
    for (const u of opts.inputUrls) {
      inputPaths.push(await downloadToTemp(u, "mp4"));
    }
    if (opts.bgMusicUrl) {
      bgMusicPath = await downloadToTemp(opts.bgMusicUrl, "mp3");
    }

    let totalDuration = 0;
    const args: string[] = [];

    if (transition === "none") {
      const listName = `ffmpeg-list-${Date.now()}.txt`;
      const listPath = path.join(os.tmpdir(), listName);
      const listContent = inputPaths.map((p) => `file '${p}'`).join("\n");
      await fs.writeFile(listPath, listContent, "utf8");

      args.push("-f", "concat", "-safe", "0", "-i", listPath);
      if (bgMusicPath) args.push("-i", bgMusicPath);

      if (bgMusicPath) {
        args.push("-map", "0:v:0", "-map", "1:a:0");
        args.push("-c:v", "libx264", "-preset", "fast");
        args.push("-af", `volume=${bgVol.toFixed(4)}`);
        args.push("-c:a", "aac", "-shortest");
      } else {
        args.push("-c:v", "copy", "-c:a", "copy");
      }
      args.push("-movflags", "+faststart", "-y", outPath);

      try {
        await execFileAsync("ffmpeg", args);
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        throw new Error(`FFmpeg merge failed:\n${e.stderr || e.message || String(err)}`);
      } finally {
        await fs.unlink(listPath).catch(() => undefined);
      }

      for (const p of inputPaths) {
        try {
          const r = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", p]);
          totalDuration += parseFloat(r.stdout.trim()) || 0;
        } catch { /* skip */ }
      }
    } else {
      const n = inputPaths.length;
      inputPaths.forEach((p) => { args.push("-i", p); });
      if (bgMusicPath) args.push("-i", bgMusicPath);

      const durations: number[] = [];
      for (const p of inputPaths) {
        try {
          const r = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", p]);
          durations.push(parseFloat(r.stdout.trim()) || 5);
        } catch { durations.push(5); }
      }

      const xfadeType = transition === "dissolve" ? "dissolve" : "fade";
      let filterStr = "";
      let lastLabel = "[0:v]";
      let timeOffset = 0;

      for (let i = 1; i < n; i++) {
        timeOffset = Math.max(0, timeOffset + durations[i - 1] - td);
        const outLabel = i === n - 1 ? "[vout]" : `[v${i}]`;
        filterStr += `${lastLabel}[${i}:v]xfade=transition=${xfadeType}:duration=${td.toFixed(3)}:offset=${timeOffset.toFixed(3)}${outLabel};`;
        lastLabel = `[v${i}]`;
      }
      if (n === 1) filterStr = "[0:v]copy[vout];";
      filterStr = filterStr.replace(/;$/, "");

      let audioFilter = "";
      const audioInputs = inputPaths.map((_, i) => `[${i}:a]`).join("");
      if (bgMusicPath) {
        const bgIdx = n;
        audioFilter = `;${audioInputs}concat=n=${n}:v=0:a=1[acat];[acat][${bgIdx}:a]amix=inputs=2:weights=1|${bgVol.toFixed(4)}[aout]`;
      } else {
        audioFilter = `;${audioInputs}concat=n=${n}:v=0:a=1[aout]`;
      }

      args.push("-filter_complex", filterStr + audioFilter);
      args.push("-map", "[vout]", "-map", "[aout]");
      args.push("-c:v", "libx264", "-preset", "fast", "-c:a", "aac");
      args.push("-movflags", "+faststart", "-y", outPath);

      try {
        await execFileAsync("ffmpeg", args);
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        throw new Error(`FFmpeg xfade merge failed:\n${e.stderr || e.message || String(err)}`);
      }

      totalDuration = durations.reduce((s, d) => s + d, 0) - td * (n - 1);
    }

    const outBuffer = await fs.readFile(outPath);
    const { url } = await storagePut(`generated/merge-${Date.now()}.mp4`, outBuffer, "video/mp4");
    return { url, duration: Math.max(0, totalDuration) };
  } finally {
    await Promise.all(inputPaths.map((p) => fs.unlink(p).catch(() => undefined)));
    await fs.unlink(outPath).catch(() => undefined);
    if (bgMusicPath) await fs.unlink(bgMusicPath).catch(() => undefined);
  }
}

// ── Subtitles ─────────────────────────────────────────────────────────────────

export interface SubtitleEntry {
  start: number;
  end: number;
  text: string;
}

export interface BurnSubtitleOptions {
  fontSize?: number;
  fontColor?: string;
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function generateSRT(entries: SubtitleEntry[]): string {
  return entries
    .map((e, i) => `${i + 1}\n${formatSRTTime(e.start)} --> ${formatSRTTime(e.end)}\n${e.text}`)
    .join("\n\n");
}

export async function burnSubtitles(
  videoUrl: string,
  entries: SubtitleEntry[],
  opts?: BurnSubtitleOptions,
): Promise<{ url: string }> {
  const fontSize = opts?.fontSize ?? 22;
  const fontColor = opts?.fontColor ?? "white";

  const videoPath = await downloadToTemp(videoUrl, "mp4");
  const srtName = `subs-${Date.now()}-${Math.random().toString(36).slice(2)}.srt`;
  const srtPath = path.join(os.tmpdir(), srtName);
  const outName = `ffmpeg-subs-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const outPath = path.join(os.tmpdir(), outName);

  try {
    await fs.writeFile(srtPath, generateSRT(entries), "utf8");

    // FFmpeg filtergraph escaping: backslash → \\, colon → \:, comma → \,, single-quote → \'
    const escapedSrtPath = srtPath
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/,/g, "\\,")
      .replace(/'/g, "\\'");
    const subsFilter = `subtitles='${escapedSrtPath}':force_style='FontSize=${fontSize},PrimaryColour=&H${cssColorToASSHex(fontColor)}&'`;
    const args = [
      "-i", videoPath,
      "-vf", subsFilter,
      "-c:v", "libx264", "-preset", "fast",
      "-c:a", "copy",
      "-movflags", "+faststart",
      "-y", outPath,
    ];

    try {
      await execFileAsync("ffmpeg", args);
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`FFmpeg subtitle burn failed:\n${e.stderr || e.message || String(err)}`);
    }

    const outBuffer = await fs.readFile(outPath);
    const { url } = await storagePut(`generated/subtitled-${Date.now()}.mp4`, outBuffer, "video/mp4");
    return { url };
  } finally {
    await fs.unlink(videoPath).catch(() => undefined);
    await fs.unlink(srtPath).catch(() => undefined);
    await fs.unlink(outPath).catch(() => undefined);
  }
}

function cssColorToASSHex(color: string): string {
  const MAP: Record<string, string> = {
    white: "FFFFFF", yellow: "00FFFF", red: "0000FF", blue: "FF0000",
    green: "00FF00", black: "000000", orange: "0080FF",
  };
  return MAP[color.toLowerCase()] ?? "FFFFFF";
}

// ── ASS Motion Subtitles ──────────────────────────────────────────────────────

export type SubtitleMotionStyle = "fade" | "roll" | "karaoke" | "bounce";

function formatASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeASSText(raw: string): string {
  // In ASS Dialogue text fields, { } delimit override tag blocks.
  // Escape { and } so user text cannot inject ASS control tags.
  return raw.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\N");
}

function buildASSDialogue(entry: SubtitleEntry, style: SubtitleMotionStyle): string {
  const text = escapeASSText(entry.text);
  let effectTags: string;
  switch (style) {
    case "fade":
      effectTags = "{\\fad(250,250)}";
      break;
    case "roll":
      // Slide in from right (off-screen) to resting position in 400ms, fade out
      effectTags = "{\\an2\\move(1920,1050,960,1050,0,400)\\fad(0,300)}";
      break;
    case "karaoke": {
      const words = text.split(/\s+/).filter(Boolean);
      if (words.length === 0) { effectTags = "{\\fad(200,200)}"; break; }
      const durMs = (entry.end - entry.start) * 1000;
      const csPerWord = Math.max(1, Math.round((durMs / 10) / words.length));
      // text is already escaped; karaoke tags are inside {}, not user content
      return `Dialogue: 0,${formatASSTime(entry.start)},${formatASSTime(entry.end)},Default,,0,0,0,,${words.map((w) => `{\\kf${csPerWord}}${w}`).join(" ")}`;
    }
    case "bounce":
      // Pop in with scale bounce then fade out
      effectTags = "{\\fad(0,200)\\t(0,200,\\fscx120\\fscy120)\\t(200,400,\\fscx100\\fscy100)}";
      break;
    default:
      effectTags = "{\\fad(200,200)}";
  }
  return `Dialogue: 0,${formatASSTime(entry.start)},${formatASSTime(entry.end)},Default,,0,0,0,,${effectTags}${text}`;
}

function generateASS(entries: SubtitleEntry[], style: SubtitleMotionStyle, fontSize: number, fontColor: string): string {
  const assHex = cssColorToASSHex(fontColor);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${fontSize},&H00${assHex},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1.5,2,10,10,40,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
  return header + "\n" + entries.map((e) => buildASSDialogue(e, style)).join("\n");
}

export interface BurnMotionSubtitleOptions {
  motionStyle?: SubtitleMotionStyle;
  fontSize?: number;
  fontColor?: string;
}

export async function burnAssSubtitles(
  videoUrl: string,
  entries: SubtitleEntry[],
  opts?: BurnMotionSubtitleOptions,
): Promise<{ url: string }> {
  const style = opts?.motionStyle ?? "fade";
  const fontSize = opts?.fontSize ?? 22;
  const fontColor = opts?.fontColor ?? "white";

  const videoPath = await downloadToTemp(videoUrl, "mp4");
  const assName = `subs-ass-${Date.now()}-${Math.random().toString(36).slice(2)}.ass`;
  const assPath = path.join(os.tmpdir(), assName);
  const outName = `ffmpeg-motion-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const outPath = path.join(os.tmpdir(), outName);

  try {
    await fs.writeFile(assPath, generateASS(entries, style, fontSize, fontColor), "utf8");

    const escapedAssPath = assPath
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/,/g, "\\,")
      .replace(/'/g, "\\'");
    const args = [
      "-i", videoPath,
      "-vf", `ass='${escapedAssPath}'`,
      "-c:v", "libx264", "-preset", "fast",
      "-c:a", "copy",
      "-movflags", "+faststart",
      "-y", outPath,
    ];

    try {
      await execFileAsync("ffmpeg", args);
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`FFmpeg ASS burn failed:\n${e.stderr || e.message || String(err)}`);
    }

    const outBuffer = await fs.readFile(outPath);
    const { url } = await storagePut(`generated/motion-sub-${Date.now()}.mp4`, outBuffer, "video/mp4");
    return { url };
  } finally {
    await fs.unlink(videoPath).catch(() => undefined);
    await fs.unlink(assPath).catch(() => undefined);
    await fs.unlink(outPath).catch(() => undefined);
  }
}

// ── Smart Cut (multi-segment extraction) ──────────────────────────────────────

export interface SmartCutOptions {
  inputUrl: string;
  keepSegments: Array<{ start: number; end: number }>;
}

export interface SmartCutResult {
  url: string;
  outputDuration: number;
}

async function hasAudioTrack(videoPath: string): Promise<boolean> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_streams",
      "-select_streams", "a", videoPath,
    ]));
  } catch {
    // ffprobe unavailable or crashed — assume audio exists so the audio
    // filter path is attempted; FFmpeg will fail with a clear error if the
    // video truly has no audio track, which is preferable to silently
    // dropping the audio track when probing fails.
    return true;
  }
  try {
    const probe = JSON.parse(stdout) as { streams?: unknown[] };
    return Array.isArray(probe.streams) && probe.streams.length > 0;
  } catch {
    return true;
  }
}

export async function smartCutVideo(opts: SmartCutOptions): Promise<SmartCutResult> {
  if (opts.keepSegments.length === 0) throw new Error("keepSegments 不能为空");

  const videoPath = await downloadToTemp(opts.inputUrl, "mp4");
  const outName = `ffmpeg-smartcut-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const outPath = path.join(os.tmpdir(), outName);

  try {
    const hasAudio = await hasAudioTrack(videoPath);
    const n = opts.keepSegments.length;
    const filterParts: string[] = [];

    // FFmpeg stream labels can only be used as filter input once.
    // Use split/asplit to create N independent copies before trimming.
    const vSplitOutputs = Array.from({ length: n }, (_, i) => `[vs${i}]`).join("");
    filterParts.push(`[0:v]split=${n}${vSplitOutputs}`);
    if (hasAudio) {
      const aSplitOutputs = Array.from({ length: n }, (_, i) => `[as${i}]`).join("");
      filterParts.push(`[0:a]asplit=${n}${aSplitOutputs}`);
    }

    let concatInputs = "";
    for (let i = 0; i < n; i++) {
      const { start, end } = opts.keepSegments[i];
      filterParts.push(`[vs${i}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
      if (hasAudio) {
        filterParts.push(`[as${i}]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);
        concatInputs += `[v${i}][a${i}]`;
      } else {
        concatInputs += `[v${i}]`;
      }
    }
    if (hasAudio) {
      filterParts.push(`${concatInputs}concat=n=${n}:v=1:a=1[outv][outa]`);
    } else {
      filterParts.push(`${concatInputs}concat=n=${n}:v=1:a=0[outv]`);
    }

    const args = [
      "-i", videoPath,
      "-filter_complex", filterParts.join(";"),
      "-map", "[outv]",
      ...(hasAudio ? ["-map", "[outa]", "-c:a", "aac"] : []),
      "-c:v", "libx264", "-preset", "fast",
      "-movflags", "+faststart",
      "-y", outPath,
    ];

    try {
      await execFileAsync("ffmpeg", args);
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`FFmpeg smart cut failed:\n${e.stderr || e.message || String(err)}`);
    }

    const outBuffer = await fs.readFile(outPath);
    const { url } = await storagePut(`generated/smartcut-${Date.now()}.mp4`, outBuffer, "video/mp4");
    const outputDuration = opts.keepSegments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
    return { url, outputDuration };
  } finally {
    await fs.unlink(videoPath).catch(() => undefined);
    await fs.unlink(outPath).catch(() => undefined);
  }
}

// ── Overlay ───────────────────────────────────────────────────────────────────

type OverlayMode = "watermark" | "pip" | "color_correction";

export interface OverlayOptions {
  inputUrl: string;
  mode: OverlayMode;
  // Watermark
  overlayImageUrl?: string;
  overlayPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  overlayScale?: number;
  overlayOpacity?: number;
  // PiP
  pipVideoUrl?: string;
  pipPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  pipScale?: number;
  // Color correction
  brightness?: number;
  contrast?: number;
  saturation?: number;
}

export async function overlayVideo(opts: OverlayOptions): Promise<{ url: string }> {
  const inputPath = await downloadToTemp(opts.inputUrl, "mp4");
  const outputPath = path.join(os.tmpdir(), `overlay-out-${Date.now()}.mp4`);
  const tempFiles = [inputPath, outputPath];

  try {
    if (opts.mode === "watermark" && opts.overlayImageUrl) {
      const overlayPath = await downloadToTemp(opts.overlayImageUrl, "png");
      tempFiles.push(overlayPath);

      const posMap: Record<string, string> = {
        "top-left": "10:10",
        "top-right": "W-w-10:10",
        "bottom-left": "10:H-h-10",
        "bottom-right": "W-w-10:H-h-10",
        "center": "(W-w)/2:(H-h)/2",
      };
      const xy = posMap[opts.overlayPosition ?? "bottom-right"];
      const scale = opts.overlayScale ?? 0.2;
      const opacity = opts.overlayOpacity ?? 1.0;

      // -2 ensures even dimensions required by libx264; -map 0:a? passes audio only if present
      const overlayFilter = opacity < 1.0
        ? `[1:v]scale=iw*${scale}:-2,format=rgba,colorchannelmixer=aa=${opacity}[ovr];[0:v][ovr]overlay=${xy}`
        : `[1:v]scale=iw*${scale}:-2[ovr];[0:v][ovr]overlay=${xy}`;

      try {
        await execFileAsync("ffmpeg", [
          "-i", inputPath, "-i", overlayPath,
          "-filter_complex", overlayFilter,
          "-map", "0:v", "-map", "0:a?", "-codec:a", "copy",
          "-y", outputPath,
        ]);
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        throw new Error(`FFmpeg watermark overlay failed:\n${e.stderr || e.message || String(err)}`);
      }
    } else if (opts.mode === "pip" && opts.pipVideoUrl) {
      const pipPath = await downloadToTemp(opts.pipVideoUrl, "mp4");
      tempFiles.push(pipPath);

      const posMap: Record<string, string> = {
        "top-left": "10:10",
        "top-right": "W-w-10:10",
        "bottom-left": "10:H-h-10",
        "bottom-right": "W-w-10:H-h-10",
      };
      const xy = posMap[opts.pipPosition ?? "bottom-right"];
      const scale = opts.pipScale ?? 0.25;

      try {
        await execFileAsync("ffmpeg", [
          "-i", inputPath, "-i", pipPath,
          "-filter_complex", `[1:v]scale=iw*${scale}:-2[pip];[0:v][pip]overlay=${xy}`,
          "-map", "0:v", "-map", "0:a?", "-codec:a", "copy",
          "-y", outputPath,
        ]);
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        throw new Error(`FFmpeg PiP overlay failed:\n${e.stderr || e.message || String(err)}`);
      }
    } else if (opts.mode === "color_correction") {
      const brightness = opts.brightness ?? 0;
      const contrast = opts.contrast ?? 1.0;
      const saturation = opts.saturation ?? 1.0;

      try {
        await execFileAsync("ffmpeg", [
          "-i", inputPath,
          "-vf", `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`,
          "-map", "0:v", "-map", "0:a?", "-codec:a", "copy",
          "-y", outputPath,
        ]);
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        throw new Error(`FFmpeg color correction failed:\n${e.stderr || e.message || String(err)}`);
      }
    } else {
      throw new Error("无效的叠加模式或缺少参数");
    }

    const buf = await fs.readFile(outputPath);
    const key = `overlay-${Date.now()}.mp4`;
    const { url } = await storagePut(key, buf, "video/mp4");
    return { url };
  } finally {
    await Promise.all(tempFiles.map((f) => fs.unlink(f).catch(() => {})));
  }
}

export async function getVideoDuration(url: string): Promise<number> {
  let tmpPath: string | null = null;

  try {
    tmpPath = await downloadToTemp(url, "mp4");

    const args = [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      tmpPath,
    ];

    let stdout = "";
    try {
      const result = await execFileAsync("ffprobe", args);
      stdout = result.stdout ?? "";
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; message?: string };
      throw new Error(
        `ffprobe failed: ${execErr.stderr ?? execErr.message ?? String(err)}`
      );
    }

    const duration = parseFloat(stdout.trim());
    if (isNaN(duration)) {
      throw new Error(`ffprobe returned non-numeric duration: ${stdout.trim()}`);
    }

    return duration;
  } finally {
    if (tmpPath) {
      await fs.unlink(tmpPath).catch(() => undefined);
    }
  }
}
