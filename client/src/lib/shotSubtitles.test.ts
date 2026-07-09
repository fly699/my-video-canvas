import { describe, it, expect } from "vitest";
import { buildShotSubtitles } from "./shotSubtitles";

describe("buildShotSubtitles", () => {
  it("never overlaps adjacent entries even with short lines (0.3s floor doesn't bleed into the next)", () => {
    // One shot [0, 0.8] with 3 short lines → each wants ~0.266s (< the 0.3s floor). Flooring must not
    // make a line's displayed end exceed the next line's start (overlap), nor cross the shot boundary.
    const entries = buildShotSubtitles({
      segStarts: [0],
      segDialogues: ["甲：好\n乙：走\n丙：来"],
      totalDuration: 0.8,
    });
    expect(entries.length).toBe(3);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].start).toBeGreaterThanOrEqual(entries[i - 1].end - 1e-9); // no overlap
    }
    for (const e of entries) {
      expect(e.end).toBeLessThanOrEqual(0.8 + 1e-9); // never crosses the shot/video boundary
      expect(e.end).toBeGreaterThan(e.start);        // positive duration
    }
  });

  it("aligns one entry per dialogue line, strips role prefixes, uses segStarts/totalDuration", () => {
    const entries = buildShotSubtitles({
      segStarts: [0, 5],
      segDialogues: ["阿明：你来了。", "夜色渐深。"],
      totalDuration: 10,
    });
    expect(entries).toEqual([
      { start: 0, end: 5, text: "你来了。" },
      { start: 5, end: 10, text: "夜色渐深。" },
    ]);
  });

  it("splits multi-line dialogue proportionally to char length within the segment", () => {
    const entries = buildShotSubtitles({
      segStarts: [0],
      segDialogues: ["阿明：四个字呀\n小红：这里是八个字台词"], // 5 vs 8... lengths 4 and 8 chars
      totalDuration: 12,
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].start).toBe(0);
    // 第一行 4 字 / 共 12 字 → 4s 处切换
    expect(entries[0].end).toBeCloseTo(4, 1);
    expect(entries[1].start).toBeCloseTo(4, 1);
    expect(entries[1].end).toBe(12); // 末行铺满段尾
    expect(entries[0].text).toBe("四个字呀");
    expect(entries[1].text).toBe("这里是八个字台词");
  });

  it("clamps to voice duration when shorter than the segment", () => {
    const entries = buildShotSubtitles({
      segStarts: [0, 8],
      segDialogues: ["旁白很长但配音只有三秒", null],
      totalDuration: 16,
      voiceDurations: [3, null],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].end).toBe(3); // 字幕在配音结束处收口，不挂满 8s 段
  });

  it("skips shots without dialogue and survives missing totalDuration", () => {
    const entries = buildShotSubtitles({
      segStarts: [0, 4],
      segDialogues: [null, "收尾词"],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].start).toBe(4);
    expect(entries[0].end).toBe(9); // 末段无总时长 → 起点+5s 兜底
  });
});
