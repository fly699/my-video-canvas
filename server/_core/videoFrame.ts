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

/**
 * #245 链式衔接：抽视频「最后一帧」为高清 JPEG。`-sseof -0.5` 从末尾倒数解码 +
 * `-update 1` 持续覆盖同一输出——写完即真尾帧（`-frames:v 1` 只会拿到倒数窗口的
 * 第一帧，不是尾帧）。极短片（<0.5s）-sseof 可能空输出，回退整片解码取尾帧。
 * 保留原始分辨率（上限 1920 宽防超大）——尾帧要喂下一镜作首帧参考，480 缩略图不够用。
 */
export async function extractTailFrameFromFile(srcPath: string): Promise<Buffer> {
  const out = path.join(os.tmpdir(), `vtail-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  const vf = "scale='min(1920,iw)':-2";
  try {
    const grab = (pre: string[]) =>
      execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...pre, "-i", srcPath, "-update", "1", "-vf", vf, "-q:v", "2", "-y", out], { timeoutMs: 120_000 });
    try {
      await grab(["-sseof", "-0.5"]);
      await fs.access(out);
    } catch { await grab([]); } // 极短片回退：整片解码，-update 1 仍落尾帧
    return await fs.readFile(out);
  } finally {
    void fs.unlink(out).catch(() => { /* 临时文件清理失败无妨 */ });
  }
}

/** 按 URL 抽尾帧（SSRF 守卫同 extractVideoFrameJpeg）。另支持 data:video;base64 内联
 *  （dev 无对象存储时上传素材即此形态；无网络请求、无 SSRF 面，直接解码落临时文件）。 */
export async function extractVideoTailFrameJpeg(videoUrl: string): Promise<Buffer> {
  let src: string;
  if (/^data:video\//i.test(videoUrl)) {
    const comma = videoUrl.indexOf(",");
    if (comma < 0) throw new Error("非法的 data: 视频 URL");
    src = path.join(os.tmpdir(), `vtailsrc-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
    await fs.writeFile(src, Buffer.from(videoUrl.slice(comma + 1), "base64"));
  } else {
    src = await downloadToTemp(videoUrl, "mp4");
  }
  try { return await extractTailFrameFromFile(src); }
  finally { void fs.unlink(src).catch(() => { /* 同上 */ }); }
}
