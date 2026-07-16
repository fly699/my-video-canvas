// 导出质量（百分比 → CRF）与文件大小预估。纯函数，前后端共用。
// 说明：CRF 是恒定质量因子，码率随画面内容浮动，故文件大小为「预估」量级，仅供参考。

export type ExportFormat = "mp4" | "hevc" | "webm" | "mov" | "mp3";
export type VideoCodec = "h264" | "hevc" | "vp9";

/** MP3（仅音频导出）：质量百分比 → 码率 kbps（1%≈96k，100%=320k，与导出实际编码一致）。 */
export function mp3KbpsOf(pct: number): number {
  const p = Math.min(100, Math.max(1, Math.round(pct))) / 100;
  return Math.round(96 + p * (320 - 96));
}

/** 每种编码的 CRF 与码率基准：
 *  best/worst = 100%/1% 对应的 CRF；ref/refKbps = 基准 CRF 下 1080p30 的典型码率(kbps)。 */
const CODEC: Record<VideoCodec, { best: number; worst: number; ref: number; refKbps: number }> = {
  h264: { best: 16, worst: 30, ref: 23, refKbps: 5000 },
  hevc: { best: 18, worst: 32, ref: 28, refKbps: 3000 }, // HEVC 同观感码率约为 H.264 六成
  vp9:  { best: 24, worst: 40, ref: 32, refKbps: 3000 },
};

export function codecOf(format: ExportFormat): VideoCodec {
  return format === "hevc" ? "hevc" : format === "webm" ? "vp9" : "h264";
}

export function audioKbpsOf(format: ExportFormat): number {
  return format === "webm" ? 160 : 192; // opus 160k / aac 192k（与导出实际编码一致）
}

/** 质量百分比(1..100) → CRF。100% = 最清晰(最小 CRF)，1% = 最小文件(最大 CRF)。 */
export function qualityPctToCrf(format: ExportFormat, pct: number): number {
  const { best, worst } = CODEC[codecOf(format)];
  const p = Math.min(100, Math.max(1, Math.round(pct))) / 100;
  return Math.round(worst - p * (worst - best));
}

/** 预估导出文件大小（字节）。以 1080p30 为基准按像素数/帧率线性缩放，CRF 每 −6 码率翻倍。
 *  内容相关，故仅为量级预估。 */
export function estimateExportBytes(o: {
  width: number; height: number; fps: number; durationSec: number; format: ExportFormat; qualityPct: number;
}): number {
  if (o.durationSec <= 0) return 0;
  // MP3 仅音频：大小 = 码率 × 时长，与画面尺寸无关。
  if (o.format === "mp3") return Math.round((mp3KbpsOf(o.qualityPct) * 1000 / 8) * o.durationSec);
  if (o.width <= 0 || o.height <= 0) return 0;
  const codec = codecOf(o.format);
  const { ref, refKbps } = CODEC[codec];
  const crf = qualityPctToCrf(o.format, o.qualityPct);
  const pixelScale = (o.width * o.height) / (1920 * 1080);
  const fpsScale = Math.max(0.1, o.fps) / 30;
  const videoKbps = refKbps * pixelScale * fpsScale * Math.pow(2, (ref - crf) / 6);
  const totalKbps = videoKbps + audioKbpsOf(o.format);
  return Math.round((totalKbps * 1000 / 8) * o.durationSec);
}

/** 人类可读的字节大小（B/KB/MB/GB）。 */
export function formatBytes(b: number): string {
  if (b <= 0) return "0 B";
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
