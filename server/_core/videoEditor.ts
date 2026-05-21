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
