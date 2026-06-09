/**
 * 由字符串（通常是音频 URL）确定性生成 n 条伪波形柱的高度（0.15~1.0）。
 * 用于吸附框里音频项的「波形缩略图」展示——音频没有真实缩略图，且解码真实波形太重，
 * 故用稳定的伪随机波形作占位：同一 URL 始终得到同一形状，看起来像声音波形。
 */
export function audioWaveBars(seed: string, n = 18): number[] {
  // FNV-1a 起始 + 线性同余推进，纯整数运算，跨平台稳定。
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    out.push(0.15 + (h % 1000) / 1000 * 0.85);
  }
  return out;
}
