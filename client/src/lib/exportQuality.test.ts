import { describe, it, expect } from "vitest";
import { qualityPctToCrf, estimateExportBytes, codecOf, formatBytes } from "@shared/exportQuality";

describe("exportQuality — 百分比质量与文件大小预估", () => {
  it("codecOf 按格式映射编码", () => {
    expect(codecOf("mp4")).toBe("h264");
    expect(codecOf("mov")).toBe("h264");
    expect(codecOf("hevc")).toBe("hevc");
    expect(codecOf("webm")).toBe("vp9");
  });

  it("qualityPctToCrf：100% 最清晰(最小 CRF)、1% 最小文件(最大 CRF)、单调", () => {
    expect(qualityPctToCrf("mp4", 100)).toBe(16); // best
    expect(qualityPctToCrf("mp4", 1)).toBe(30);   // worst
    // 单调：质量越高 CRF 越低
    expect(qualityPctToCrf("mp4", 80)).toBeLessThan(qualityPctToCrf("mp4", 40));
    // 越界 clamp
    expect(qualityPctToCrf("mp4", 0)).toBe(qualityPctToCrf("mp4", 1));
    expect(qualityPctToCrf("mp4", 999)).toBe(16);
    // HEVC / VP9 用各自区间
    expect(qualityPctToCrf("hevc", 100)).toBe(18);
    expect(qualityPctToCrf("webm", 100)).toBe(24);
  });

  it("estimateExportBytes：随质量、像素、时长、帧率单调增；HEVC 比 H.264 小", () => {
    const base = { width: 1920, height: 1080, fps: 30, durationSec: 60, format: "mp4" as const, qualityPct: 80 };
    const sz = estimateExportBytes(base);
    expect(sz).toBeGreaterThan(0);
    // 质量更高 → 更大
    expect(estimateExportBytes({ ...base, qualityPct: 100 })).toBeGreaterThan(sz);
    // 时长翻倍 → 约翻倍
    expect(estimateExportBytes({ ...base, durationSec: 120 })).toBeCloseTo(sz * 2, -4);
    // 分辨率减半像素 → 更小
    expect(estimateExportBytes({ ...base, width: 1280, height: 720 })).toBeLessThan(sz);
    // 同质量百分比下 HEVC 比 H.264 文件更小（更高效）
    expect(estimateExportBytes({ ...base, format: "hevc" })).toBeLessThan(sz);
    // 0 时长 → 0
    expect(estimateExportBytes({ ...base, durationSec: 0 })).toBe(0);
  });

  it("formatBytes 单位换算", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.00 GB");
  });
});
