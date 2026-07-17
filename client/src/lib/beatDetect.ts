// 批4 卡点剪辑：音频节拍/重音检测（纯能量峰值法，本地计算、免 AI 调用）。
// 纯数学部分与 WebAudio 解码解耦，便于 vitest 单测。

/** 把单声道 PCM 切帧求能量（均方值）。hopSec 为帧步长（秒）。 */
export function energyEnvelope(ch: Float32Array, sampleRate: number, hopSec = 0.02): number[] {
  const hop = Math.max(1, Math.round(sampleRate * hopSec));
  const out: number[] = [];
  for (let i = 0; i + hop <= ch.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < hop; j++) { const v = ch[i + j]; sum += v * v; }
    out.push(sum / hop);
  }
  return out;
}

/**
 * 能量峰值节拍检测：帧能量显著高于局部窗口均值（ratio 倍）且为局部极大时记为一拍；
 * 相邻两拍最小间隔 minGapSec（防抖）。返回秒（相对素材开头）。经典轻量算法，
 * 强节奏音乐（BGM/鼓点）效果好；轻音乐/人声检出偏少属预期。
 */
export function detectBeats(
  energies: number[],
  hopSec: number,
  opts: { windowSec?: number; ratio?: number; minGapSec?: number; maxBeats?: number } = {},
): number[] {
  const windowSec = opts.windowSec ?? 1.0;
  const ratio = opts.ratio ?? 1.5;
  const minGap = opts.minGapSec ?? 0.3;
  const maxBeats = opts.maxBeats ?? 200;
  const n = energies.length;
  if (n < 3) return [];
  const half = Math.max(1, Math.round(windowSec / hopSec / 2));
  // 全局噪声底：低于全局均值 5% 的帧不算拍（防全静音段误检）。
  const globalAvg = energies.reduce((a, b) => a + b, 0) / n;
  const floor = globalAvg * 0.05;
  const beats: number[] = [];
  let lastBeat = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const e = energies[i];
    if (e <= floor) continue;
    if (e < energies[i - 1] || e < energies[i + 1]) continue; // 需为局部极大
    const a = Math.max(0, i - half), b = Math.min(n, i + half + 1);
    let sum = 0;
    for (let j = a; j < b; j++) sum += energies[j];
    const localAvg = sum / (b - a);
    if (e < localAvg * ratio) continue;
    const t = i * hopSec;
    if (t - lastBeat < minGap) continue;
    beats.push(Math.round(t * 100) / 100);
    lastBeat = t;
    if (beats.length >= maxBeats) break;
  }
  return beats;
}
