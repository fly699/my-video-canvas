import type { WhisperSegment, WhisperWord } from "./voiceTranscription";

// #335 段级字幕起点收紧（用词级时间戳消除「段内前导静音」）。
//
// Whisper 段是连续平铺时间轴的：短促台词（如单字「妈」）若前面有停顿，Whisper 会把
// 停顿也算进该段，于是段起点 = 上一段结束点，远早于真正开口（实测「妈」段 3.55→7.86，
// 一个字横跨 4.3s，字幕提前 ~3s 就出现——用户实报）。全局微调（#334）无法修：整体后移
// 会连累其它段。正解是用词级时间戳把每段【起点】收紧到该段第一个词的真实开口时刻，
// 【结束】保留段尾（维持阅读时长、与下一段无缝衔接）。
//
// 词级时间戳需模型返回 words[]（whisper-1 支持；gpt-4o-transcribe 等不返回）——无 words
// 时原样退回段级起点（当前行为），并置 wordAligned=false 供上层决定默认时间补偿。

export interface AlignedEntry { start: number; end: number; text: string }

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 用词级时间戳把每段起点收紧到「段内首词开口」。end 保留段尾。
 *  wordAligned=true 表示确实用词数据收紧了至少一段（供上层选默认补偿）。 */
export function alignSegmentsToWords(
  segments: WhisperSegment[],
  words: WhisperWord[] | undefined,
): { entries: AlignedEntry[]; wordAligned: boolean } {
  const hasWords = Array.isArray(words) && words.length > 0;
  let tightenedAny = false;
  const entries = segments.map((seg) => {
    const segStart = seg.start;
    const segEnd = seg.end;
    const text = seg.text.trim();
    if (!hasWords) return { start: round2(segStart), end: round2(segEnd), text };
    // 该段第一个词：start 落在 [segStart, segEnd) 内、最早的那个（words 已按时间有序，
    // 取首个命中即可）。用 start 判定归属，边界词归属靠后的段（与连续平铺一致）。
    const firstWord = words!.find((w) => w.start >= segStart - 1e-3 && w.start < segEnd - 1e-3);
    if (!firstWord) return { start: round2(segStart), end: round2(segEnd), text }; // 纯音乐/无词段
    // 收紧起点到首词开口；clamp 在 [segStart, segEnd-0.3] 保证至少 0.3s 可读、不越段。
    const newStart = Math.min(Math.max(firstWord.start, segStart), Math.max(segStart, segEnd - 0.3));
    if (newStart > segStart + 1e-3) tightenedAny = true;
    return { start: round2(newStart), end: round2(segEnd), text };
  });
  return { entries, wordAligned: hasWords && tightenedAny };
}
