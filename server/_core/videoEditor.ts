import { execFile } from "child_process";
import { promisify } from "util";
import { storagePut } from "../storage";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const execFileAsync = promisify(execFile);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function downloadToTemp(url: string, ext: string): Promise<string> {
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

  const inputPaths = await Promise.all(opts.inputUrls.map((u) => downloadToTemp(u, "mp4")));
  const outName = `ffmpeg-merge-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const outPath = path.join(os.tmpdir(), outName);
  let bgMusicPath: string | null = null;

  try {
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
        timeOffset += durations[i - 1] - td;
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
        audioFilter = `;${audioInputs}concat=n=${n}:v=0:a=1[acat];[acat][${bgIdx}:a]amix=inputs=2:weights=1 ${bgVol.toFixed(4)}[aout]`;
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
  const srtName = `subs-${Date.now()}.srt`;
  const srtPath = path.join(os.tmpdir(), srtName);
  const outName = `ffmpeg-subs-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const outPath = path.join(os.tmpdir(), outName);

  try {
    await fs.writeFile(srtPath, generateSRT(entries), "utf8");

    const subsFilter = `subtitles='${srtPath.replace(/'/g, "\\'")}':force_style='FontSize=${fontSize},PrimaryColour=&H${cssColorToASSHex(fontColor)}&'`;
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
