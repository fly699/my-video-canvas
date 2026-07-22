import { describe, it, expect } from "vitest";
import { shiftSubtitleEntries, DEFAULT_ASR_TIMING_OFFSET } from "./subtitleTiming";

describe("#334 shiftSubtitleEntries（字幕时间微调补偿）", () => {
  const base = [
    { start: 1, end: 3, text: "有你在" },
    { start: 3, end: 5.5, text: "妈就安心了" },
  ];

  it("正向偏移整体延后 start/end（补偿 Whisper 提前）", () => {
    expect(shiftSubtitleEntries(base, 0.3)).toEqual([
      { start: 1.3, end: 3.3, text: "有你在" },
      { start: 3.3, end: 5.8, text: "妈就安心了" },
    ]);
  });

  it("负向偏移整体提前，start clamp 到 ≥0（不越到负时间）", () => {
    expect(shiftSubtitleEntries([{ start: 0.2, end: 2, text: "a" }], -0.5)).toEqual([
      { start: 0, end: 1.5, text: "a" },
    ]);
  });

  it("offset=0 原样返回同一引用（零成本快照对比）", () => {
    expect(shiftSubtitleEntries(base, 0)).toBe(base);
  });

  it("增量往返：套 +0.3 再套 −0.3 回到原值（可逆，非近 0 段无损）", () => {
    const fwd = shiftSubtitleEntries(base, 0.3);
    const back = shiftSubtitleEntries(fwd, -0.3);
    expect(back).toEqual(base);
  });

  it("保持 end>start（大负偏移压到 start 时 end 仍抬升 0.01）", () => {
    const r = shiftSubtitleEntries([{ start: 0, end: 0.05, text: "x" }], -1);
    expect(r[0].start).toBe(0);
    expect(r[0].end).toBeGreaterThan(r[0].start);
  });

  it("默认 ASR 补偿为正向小值（延后对齐语音）", () => {
    expect(DEFAULT_ASR_TIMING_OFFSET).toBeGreaterThan(0);
    expect(DEFAULT_ASR_TIMING_OFFSET).toBeLessThanOrEqual(0.5);
  });
});
