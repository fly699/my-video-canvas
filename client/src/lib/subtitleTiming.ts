import type { SubtitleEntry } from "../../../shared/types";

// #334 字幕时间微调（补偿 Whisper「时间戳提前」偏差）。
//
// Whisper 段级 start 时间戳存在系统性【anticipation（提前）】：模型倾向在实际发声
// 前就标记该段起点，典型偏早 0.2–0.4s（用户实报「单个文字识别总是超前」）。这与
// #333 修的「容器音频流起始偏移」是两码事——那是整条轴的固定平移（抽音丢偏移），
// 这是【每段】叠加的模型侧偏早，两者可共存。
//
// 补偿采用「烘焙进条目 + 记录已套偏移」模型：payload.entries 始终是最终显示/编辑/
// 烧录/导出用的值，payload.timingOffsetSec 记录当前已套偏移量；调整时按【增量】平移。
// 好处：烧录/导出直接用 entries（零改动）、所见即所得、用户手改单条自然生效；且默认
// 补偿只在 ASR 转录成功时套，从镜头表确定性生成/手动添加的条目不套（那些无 ASR 偏差）。

/** ASR 转录默认时间补偿（秒，正=延后字幕出现以对齐语音）。用户可在节点上调整。 */
export const DEFAULT_ASR_TIMING_OFFSET = 0.3;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 把字幕条目整体平移 offset 秒（正=延后 / 负=提前）。clamp start≥0 且保持 end>start。
 *  纯函数、不改入参；offset=0 时原样返回同一引用（零成本、可作快照对比）。 */
export function shiftSubtitleEntries(entries: SubtitleEntry[], offset: number): SubtitleEntry[] {
  if (!offset) return entries;
  return entries.map((e) => {
    const start = Math.max(0, e.start + offset);
    // end 至少比 start 大 0.01（防越界导致 ffmpeg ASS/SRT 计时非法被静默剔除）。
    const end = Math.max(start + 0.01, e.end + offset);
    return { start: round2(start), end: round2(end), text: e.text };
  });
}
