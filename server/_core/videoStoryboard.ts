import { readFile, unlink } from "node:fs/promises";
import { execFileAsync, downloadToTemp } from "./videoEditor";
import { storagePut } from "../storage";

// ── Video → storyboard frame extraction ───────────────────────────────────────
// Reverse a reference video into N evenly-spaced keyframes (one per shot beat),
// each persisted to storage. The client then drops each frame onto a storyboard
// node. Downloads the source once, then ffmpeg fast-seeks each frame. No 3rd-party
// AI — pure local ffmpeg.

export interface StoryboardFrame {
  url: string;
  time: number; // seconds into the source video
}

export async function extractStoryboardFrames(
  videoUrl: string,
  count: number,
): Promise<{ frames: StoryboardFrame[]; duration: number }> {
  if (!Number.isInteger(count) || count < 1 || count > 24) throw new Error("非法的抽帧数量（1-24）");
  const inputPath = await downloadToTemp(videoUrl, "mp4");
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ]);
    const duration = parseFloat(stdout.trim()) || 0;
    const frames: StoryboardFrame[] = [];
    const stamp = Date.now();
    for (let i = 0; i < count; i++) {
      // Centre each frame within its even segment; avoids the black 0s frame and
      // the final-frame freeze, and spreads evenly when duration is unknown (t=0).
      const t = duration > 0 ? ((i + 0.5) / count) * duration : 0;
      const outPath = `${inputPath}.f${i}.png`;
      // -ss before -i = fast seek; one high-quality frame.
      await execFileAsync("ffmpeg", ["-ss", String(t), "-i", inputPath, "-frames:v", "1", "-q:v", "2", "-y", outPath]);
      const buf = await readFile(outPath);
      const { url } = await storagePut(`storyboard-frames/${stamp}-${i}.png`, buf, "image/png");
      frames.push({ url, time: Math.round(t * 100) / 100 });
      await unlink(outPath).catch(() => undefined);
    }
    return { frames, duration };
  } finally {
    await unlink(inputPath).catch(() => undefined);
  }
}
