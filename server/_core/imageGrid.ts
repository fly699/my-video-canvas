import { readFile } from "node:fs/promises";
import { execFileAsync, downloadToTemp } from "./videoEditor";
import { storagePut } from "../storage";

// ── Grid image slicer ─────────────────────────────────────────────────────────
// Splits one grid-sheet image into rows×cols cell images (row-major) using ffmpeg
// crop, then persists each cell to storage. Reuses the same ffmpeg/download/storage
// primitives the video editor uses. Pure server-side; no third-party AI.

export interface SliceGridResult {
  urls: string[];
  keys: string[];
  rows: number;
  cols: number;
}

/** Read an image's pixel dimensions via ffprobe. */
async function probeImageSize(path: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x",
    path,
  ]);
  const m = stdout.trim().match(/^(\d+)x(\d+)/);
  if (!m) throw new Error(`无法解析图像尺寸：${stdout.trim().slice(0, 60)}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Slice a grid-sheet image into rows×cols cells (row-major), persisting each.
 * Cells are floored to even-ish integer sizes; any remainder pixels on the right/
 * bottom edge are dropped (negligible vs. the per-panel content).
 */
export async function sliceGridImage(
  imageUrl: string,
  rows: number,
  cols: number,
): Promise<SliceGridResult> {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows * cols > 64) {
    throw new Error("非法的网格行列数");
  }
  const inputPath = await downloadToTemp(imageUrl, "png");
  const { width, height } = await probeImageSize(inputPath);
  const cellW = Math.floor(width / cols);
  const cellH = Math.floor(height / rows);
  if (cellW < 8 || cellH < 8) throw new Error("图像太小，无法按该网格切分");

  const urls: string[] = [];
  const keys: string[] = [];
  const stamp = Date.now();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellW;
      const y = r * cellH;
      const outPath = `${inputPath}.cell_${r}_${c}.png`;
      await execFileAsync("ffmpeg", [
        "-i", inputPath,
        "-vf", `crop=${cellW}:${cellH}:${x}:${y}`,
        "-frames:v", "1",
        "-y", outPath,
      ]);
      const buf = await readFile(outPath);
      const key = `grid-cells/${stamp}-${r}_${c}.png`;
      const { url } = await storagePut(key, buf, "image/png");
      urls.push(url);
      keys.push(key);
    }
  }
  return { urls, keys, rows, cols };
}
