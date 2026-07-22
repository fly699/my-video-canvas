import { describe, it, expect } from "vitest";
import { alignSegmentsToWords } from "./_core/subtitleWordAlign";
import type { WhisperSegment, WhisperWord } from "./_core/voiceTranscription";

// 造一个最小的 WhisperSegment（只有 start/end/text 参与对齐，其余字段填占位）。
function seg(start: number, end: number, text: string): WhisperSegment {
  return { id: 0, seek: 0, start, end, text, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 };
}
function word(w: string, start: number, end: number): WhisperWord {
  return { word: w, start, end };
}

describe("#335 alignSegmentsToWords（用词级时间戳收紧段起点）", () => {
  it("段内前导静音：起点收紧到首词开口、结束保留段尾（用户实报「妈」）", () => {
    const segs = [seg(3.55, 7.86, "妈"), seg(7.86, 10.04, "我会常回来的")];
    const words = [
      word("妈", 6.2, 6.5),
      word("我", 7.9, 8.1), word("会", 8.1, 8.3), word("常", 8.3, 8.6),
      word("回", 8.6, 8.9), word("来", 8.9, 9.2), word("的", 9.2, 9.5),
    ];
    const { entries, wordAligned } = alignSegmentsToWords(segs, words);
    expect(wordAligned).toBe(true);
    expect(entries[0]).toEqual({ start: 6.2, end: 7.86, text: "妈" }); // 起点由 3.55 收紧到 6.2
    expect(entries[1]).toEqual({ start: 7.9, end: 10.04, text: "我会常回来的" });
  });

  it("无 words：原样退回段级起点、wordAligned=false（非 whisper 模型兜底）", () => {
    const segs = [seg(3.55, 7.86, "妈")];
    const { entries, wordAligned } = alignSegmentsToWords(segs, undefined);
    expect(wordAligned).toBe(false);
    expect(entries[0]).toEqual({ start: 3.55, end: 7.86, text: "妈" });
  });

  it("空 words 数组：同样退回段级、wordAligned=false", () => {
    const segs = [seg(1, 3, "abc")];
    const { entries, wordAligned } = alignSegmentsToWords(segs, []);
    expect(wordAligned).toBe(false);
    expect(entries[0].start).toBe(1);
  });

  it("首词几乎贴段尾：clamp 到 segEnd-0.3 保证至少 0.3s 可读、不越段", () => {
    // 段 [5, 6]，首词开口 5.95（离段尾仅 0.05s）→ 起点夹到 6-0.3=5.7。
    const segs = [seg(5, 6, "嗯")];
    const words = [word("嗯", 5.95, 6.0)];
    const { entries } = alignSegmentsToWords(segs, words);
    expect(entries[0]).toEqual({ start: 5.7, end: 6, text: "嗯" });
  });

  it("段无对应词（纯音乐/停顿段）：不收紧、保留段级起点", () => {
    // words 都落在段 [2,4) 外 → 该段 firstWord 未命中，起点不动。
    const segs = [seg(2, 4, "（音乐）")];
    const words = [word("你好", 5.0, 5.4)];
    const { entries, wordAligned } = alignSegmentsToWords(segs, words);
    expect(entries[0]).toEqual({ start: 2, end: 4, text: "（音乐）" });
    expect(wordAligned).toBe(false); // 没有任何一段被收紧
  });

  it("首词早于段起（边界毛刺）：不把起点提前到段外、维持段起", () => {
    // 首词 start 3.5 略早于段起 3.55（浮点/边界）→ Math.max 夹回 3.55，不提前。
    const segs = [seg(3.55, 7.86, "妈")];
    const words = [word("妈", 3.5, 3.9)];
    const { entries, wordAligned } = alignSegmentsToWords(segs, words);
    expect(entries[0].start).toBe(3.55);
    expect(wordAligned).toBe(false); // 未实际收紧（起点等于段起）
  });

  it("多段部分收紧：只要有一段被收紧 wordAligned 即为 true", () => {
    const segs = [seg(0, 2, "第一句"), seg(2, 6, "第二句")];
    const words = [
      word("第一句", 0.0, 1.9),   // 段1 首词贴段起 → 不收紧
      word("第二句", 4.0, 5.8),   // 段2 前导 2s 静音 → 收紧到 4.0
    ];
    const { entries, wordAligned } = alignSegmentsToWords(segs, words);
    expect(wordAligned).toBe(true);
    expect(entries[0].start).toBe(0); // 段1 起点不动
    expect(entries[1].start).toBe(4.0);
  });
});
