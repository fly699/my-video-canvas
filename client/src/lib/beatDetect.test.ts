import { describe, it, expect } from "vitest";
import { energyEnvelope, detectBeats } from "./beatDetect";

/** 合成 PCM：每 beatEverySec 一个短促响段（脉冲），其余近静音。 */
function synthPulses(durationSec: number, beatEverySec: number, sampleRate = 8000): Float32Array {
  const ch = new Float32Array(Math.round(durationSec * sampleRate));
  for (let t = beatEverySec; t < durationSec; t += beatEverySec) {
    const base = Math.round(t * sampleRate);
    for (let j = 0; j < sampleRate * 0.05 && base + j < ch.length; j++) ch[base + j] = 0.8;
  }
  return ch;
}

describe("beatDetect（能量峰值踩点）", () => {
  it("周期性脉冲被逐一检出，时刻与合成节拍对齐（±0.06s）", () => {
    const sr = 8000;
    const ch = synthPulses(6, 1.0, sr); // 1s/2s/.../5s 处各一拍
    const beats = detectBeats(energyEnvelope(ch, sr, 0.02), 0.02);
    expect(beats.length).toBe(5);
    beats.forEach((b, i) => expect(Math.abs(b - (i + 1))).toBeLessThan(0.06));
  });
  it("minGapSec 防抖：密集双击只保留首拍", () => {
    const sr = 8000;
    const ch = new Float32Array(sr * 3);
    for (const t of [1.0, 1.1, 2.0]) { const base = Math.round(t * sr); for (let j = 0; j < sr * 0.04; j++) ch[base + j] = 0.8; }
    const beats = detectBeats(energyEnvelope(ch, sr, 0.02), 0.02, { minGapSec: 0.3 });
    expect(beats.length).toBe(2); // 1.1s 距 1.0s 不足 0.3s 被抖掉
  });
  it("全静音无误检；maxBeats 封顶", () => {
    expect(detectBeats(energyEnvelope(new Float32Array(8000 * 2), 8000, 0.02), 0.02)).toEqual([]);
    const ch = synthPulses(30, 0.5);
    const beats = detectBeats(energyEnvelope(ch, 8000, 0.02), 0.02, { maxBeats: 10 });
    expect(beats.length).toBe(10);
  });
});
