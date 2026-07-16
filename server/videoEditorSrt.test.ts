import { describe, expect, it } from "vitest";
import { generateSRT, parseSilenceDetect } from "./_core/videoEditor";

// Guards the SRT millisecond-carry fix: values whose fractional part rounds to 1000ms must
// carry into seconds/minutes/hours instead of emitting an illegal 4-digit ",1000" time code.
describe("generateSRT time codes", () => {
  it("carries 59.9997s to 00:01:00,000 (not 00:00:59,1000)", () => {
    const srt = generateSRT([{ start: 59.9997, end: 61, text: "hi" }]);
    expect(srt).toContain("00:01:00,000 --> 00:01:01,000");
    expect(srt).not.toMatch(/,\d{4}/); // never a 4-digit millisecond field
  });

  it("carries across minute and hour boundaries", () => {
    expect(generateSRT([{ start: 3599.9999, end: 3600, text: "x" }])).toContain("01:00:00,000 --> 01:00:00,000");
  });

  it("formats a normal mid-range time correctly", () => {
    expect(generateSRT([{ start: 5.25, end: 7.5, text: "y" }])).toContain("00:00:05,250 --> 00:00:07,500");
  });

  it("clamps negatives to zero", () => {
    expect(generateSRT([{ start: -0.001, end: 1, text: "z" }])).toContain("00:00:00,000 --> 00:00:01,000");
  });
});

describe("parseSilenceDetect（ffmpeg silencedetect stderr 解析）", () => {
  const STDERR = [
    "[silencedetect @ 0x55] silence_start: 2.048",
    "[silencedetect @ 0x55] silence_end: 4.096 | silence_duration: 2.048",
    "frame= 100 fps= 50 ...",
    "[silencedetect @ 0x55] silence_start: 8.5",
  ].join("\n");
  it("成对 start/end 解析为区间；未闭合的尾段按 durationSec 闭合", () => {
    expect(parseSilenceDetect(STDERR, 10)).toEqual([{ start: 2.048, end: 4.096 }, { start: 8.5, end: 10 }]);
  });
  it("不传 durationSec 时丢弃未闭合尾段；空输入 → []", () => {
    expect(parseSilenceDetect(STDERR)).toEqual([{ start: 2.048, end: 4.096 }]);
    expect(parseSilenceDetect("")).toEqual([]);
  });
  it("负数 start 夹到 0（silencedetect 偶发 -0.00x）", () => {
    const r = parseSilenceDetect("silence_start: -0.011\nsilence_end: 1.5 | ...");
    expect(r).toEqual([{ start: 0, end: 1.5 }]);
  });
});
