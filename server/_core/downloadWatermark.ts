import type { Response } from "express";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { execFileAsync, downloadToTemp } from "./videoEditor";

/**
 * Burn a traceable identity watermark (downloader email/id + timestamp) into an
 * image/video at DOWNLOAD time, so the leaked original file itself is traceable.
 *
 * Hard safety contract (so downloads NEVER break): every failure path — no font,
 * can't fetch source, ffmpeg error — degrades gracefully. ffmpeg failures still
 * serve the already-fetched ORIGINAL file; only a failure to even fetch the
 * source returns false, letting the caller serve via its own normal path.
 *
 * Only used on the explicit `?download=1` path of the media proxies, and only
 * when the admin enabled it. Viewing/streaming is never touched.
 */

// drawtext needs an explicit fontfile to work without system fontconfig.
let _fontPath: string | null | undefined;
function resolveFont(): string | null {
  if (_fontPath !== undefined) return _fontPath;
  const candidates = [
    process.env.WATERMARK_FONT_PATH || "",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/Library/Fonts/Arial.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) { _fontPath = c; return c; } } catch { /* ignore */ } }
  _fontPath = null;
  return null;
}

export type WatermarkKind = "video" | "image";

/** Infer whether a storage key / filename / url is a watermarkable image or video. */
export function watermarkKindFromName(name: string): WatermarkKind | null {
  const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(name);
  const ext = m?.[1]?.toLowerCase();
  if (!ext) return null;
  if (["mp4", "webm", "mov", "mkv", "m4v"].includes(ext)) return "video";
  if (["png", "jpg", "jpeg", "webp", "bmp"].includes(ext)) return "image";
  return null;
}

/** Best-effort source extension for the temp file. */
export function extFromName(name: string, kind: WatermarkKind): string {
  const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(name);
  const ext = m?.[1]?.toLowerCase();
  if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
  return kind === "video" ? "mp4" : "png";
}

/** Identity label burned into the file: email/id + local timestamp. */
export function buildDownloadWatermarkLabel(user: { email?: string | null; id?: number | string } | null): string {
  const who = user?.email || (user?.id != null ? `uid:${user.id}` : "unknown");
  const t = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  return `${who}  ${stamp}`.slice(0, 96);
}

// Escape a filesystem path for embedding inside an ffmpeg filter value
// (fontfile=/textfile=). Backslashes → forward slashes; `:` (Windows drive) escaped.
function ffPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function cleanup(...paths: (string | undefined)[]) {
  for (const p of paths) { if (p) fsp.unlink(p).catch(() => {}); }
}

function streamFile(
  res: Response,
  filePath: string,
  kind: WatermarkKind,
  watermarked: boolean,
  fallbackExt: string,
  downloadName: string,
  done: () => void,
): boolean {
  let size = 0;
  try { size = fs.statSync(filePath).size; } catch { done(); return false; }

  const isVideo = kind === "video";
  const outExt = (path.extname(filePath).replace(/^\./, "") || (watermarked && isVideo ? "mp4" : fallbackExt) || (isVideo ? "mp4" : "png")).toLowerCase();
  const ctype = isVideo
    ? (outExt === "webm" ? "video/webm" : "video/mp4")
    : (outExt === "jpg" || outExt === "jpeg" ? "image/jpeg" : outExt === "webp" ? "image/webp" : "image/png");
  const base = downloadName.replace(/\.[^.]+$/, "") || "download";
  const filename = `${base}.${outExt}`;

  res.status(200);
  res.set("Content-Type", ctype);
  res.set("Content-Length", String(size));
  res.set("Cache-Control", "no-store");
  res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);

  const rs = fs.createReadStream(filePath);
  rs.on("error", () => { if (!res.headersSent) res.status(502).end(); else res.destroy(); done(); });
  res.on("close", () => { rs.destroy(); done(); });
  rs.on("end", done);
  rs.pipe(res);
  return true;
}

export async function serveWatermarkedDownload(
  res: Response,
  opts: { sourceUrl: string; kind: WatermarkKind; srcExt: string; downloadName: string; label: string },
): Promise<boolean> {
  const font = resolveFont();
  if (!font) return false; // no usable font → caller serves the original unchanged

  let inPath: string | undefined;
  let txtPath: string | undefined;
  let outPath: string | undefined;
  const finish = () => cleanup(inPath, txtPath, outPath);

  try {
    inPath = await downloadToTemp(opts.sourceUrl, opts.srcExt || (opts.kind === "video" ? "mp4" : "png"));
  } catch {
    return false; // couldn't even fetch → caller serves via its own normal path
  }

  // Label via textfile= so we never have to escape arbitrary user text into the filter.
  txtPath = `${inPath}.wm.txt`;
  try { await fsp.writeFile(txtPath, opts.label, "utf8"); } catch { finish(); return false; }

  const fp = ffPath(font), tp = ffPath(txtPath);
  const filter =
    `drawtext=textfile='${tp}':fontfile='${fp}':fontcolor=white@0.20:fontsize=h/16:` +
      `x=(w-text_w)/2:y=(h-text_h)/2,` +
    `drawtext=textfile='${tp}':fontfile='${fp}':fontcolor=white@0.55:fontsize=h/30:` +
      `box=1:boxcolor=black@0.35:boxborderw=6:x=w-text_w-16:y=h-text_h-16`;

  try {
    if (opts.kind === "video") {
      outPath = `${inPath}.wm.mp4`;
      await execFileAsync("ffmpeg", [
        "-y", "-i", inPath, "-vf", filter,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-movflags", "+faststart", outPath,
      ], { timeoutMs: 900_000 });
    } else {
      const ext = /^(png|jpg|jpeg|webp)$/i.test(opts.srcExt) ? opts.srcExt.toLowerCase() : "png";
      outPath = `${inPath}.wm.${ext}`;
      await execFileAsync("ffmpeg", ["-y", "-i", inPath, "-vf", filter, outPath], { timeoutMs: 120_000 });
    }
  } catch {
    // ffmpeg failed → serve the ORIGINAL we already have (never break the download).
    return streamFile(res, inPath, opts.kind, false, opts.srcExt, opts.downloadName, finish);
  }

  return streamFile(res, outPath, opts.kind, true, opts.srcExt, opts.downloadName, finish);
}
