import { describe, it, expect } from "vitest";
import { audioWaveBars } from "./audioWaveform";

describe("audioWaveBars", () => {
  it("是确定性的：同一 seed 得到同一波形", () => {
    expect(audioWaveBars("https://x/a.mp3")).toEqual(audioWaveBars("https://x/a.mp3"));
  });
  it("不同 seed 通常得到不同波形", () => {
    expect(audioWaveBars("a.mp3")).not.toEqual(audioWaveBars("b.mp3"));
  });
  it("返回 n 条柱，默认 18", () => {
    expect(audioWaveBars("x")).toHaveLength(18);
    expect(audioWaveBars("x", 8)).toHaveLength(8);
  });
  it("所有柱高在 [0.15, 1.0] 区间", () => {
    for (const v of audioWaveBars("some-audio-url-12345", 64)) {
      expect(v).toBeGreaterThanOrEqual(0.15);
      expect(v).toBeLessThanOrEqual(1.0);
    }
  });
  it("空字符串也安全", () => {
    expect(audioWaveBars("")).toHaveLength(18);
  });
});
