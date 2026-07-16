// E2 批2：视频素材抽首帧作缩略图——无封面的视频素材由此纳入 AI 打标与语义搜索。
// 复用 videoEditor 的 ffmpeg 基建：downloadToTemp（含 SSRF 守卫/自有存储直通）与
// execFileAsync（跨平台 ffmpeg 定位 + 超时）。
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileAsync, downloadToTemp } from "./videoEditor";

/**
 * 从本地视频文件抽一帧为 JPEG Buffer：先取 0.5s 处（避开纯黑首帧），失败回退 0s；
 * 宽缩至 480（保持比例，-2 保证偶数高）。视频损坏/无视频流时抛错由调用方兜底。
 */
export async function extractFrameFromFile(srcPath: string): Promise<Buffer> {
  const out = path.join(os.tmpdir(), `vthumb-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    const grab = (ss: string) =>
      execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", ss, "-i", srcPath, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", "-y", out], { timeoutMs: 60_000 });
    try { await grab("0.5"); } catch { await grab("0"); }
    return await fs.readFile(out);
  } finally {
    void fs.unlink(out).catch(() => { /* 临时文件清理失败无妨 */ });
  }
}

/** 按 URL 抽帧：先经 downloadToTemp（自有存储直通 + 外链 SSRF 守卫）落地临时文件再抽。 */
export async function extractVideoFrameJpeg(videoUrl: string): Promise<Buffer> {
  const src = await downloadToTemp(videoUrl, "mp4");
  try { return await extractFrameFromFile(src); }
  finally { void fs.unlink(src).catch(() => { /* 同上 */ }); }
}
