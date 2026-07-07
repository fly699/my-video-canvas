import { describe, it, expect } from "vitest";
import { parseAiCutPlan, sanitizeRanges, snapToWordBoundaries, buildAiCutDoc, aiCutStats, buildSubtitleClips, type CutWord } from "./_core/aiCut";

const SRC = { assetId: 7, assetUrl: "https://x/v.mp4", width: 1920, height: 1080, fps: 30, durationSec: 30 };

describe("parseAiCutPlan（从 LLM 文本抠剪辑方案）", () => {
  it("带 Markdown 围栏/解释文字也能抠出 keep + grade", () => {
    const t = "好的，方案如下：\n```json\n{\"keep\":[{\"start\":1,\"end\":5},{\"start\":8,\"end\":12}],\"grade\":\"warm_cinematic\"}\n```\n完成。";
    const p = parseAiCutPlan(t)!;
    expect(p.keep).toEqual([{ start: 1, end: 5 }, { start: 8, end: 12 }]);
    expect(p.grade).toBe("warm_cinematic");
  });
  it("非法 grade 丢弃、非法区间(end<=start/NaN)过滤", () => {
    const p = parseAiCutPlan('{"keep":[{"start":2,"end":1},{"start":3,"end":4},{"start":"x","end":9}],"grade":"lol"}')!;
    expect(p.keep).toEqual([{ start: 3, end: 4 }]);
    expect(p.grade).toBeUndefined();
  });
  it("无 keep / 坏 JSON → null", () => {
    expect(parseAiCutPlan("no json here")).toBeNull();
    expect(parseAiCutPlan('{"foo":1}')).toBeNull();
  });
});

describe("sanitizeRanges（夹取/排序/合并）", () => {
  it("夹到时长内、去极短、合并重叠与相邻", () => {
    const out = sanitizeRanges([{ start: 5, end: 8 }, { start: 7, end: 9 }, { start: 9.005, end: 10 }, { start: 20, end: 999 }, { start: 1, end: 1.01 }], 30);
    expect(out).toEqual([{ start: 5, end: 10 }, { start: 20, end: 30 }]);
  });
});

describe("snapToWordBoundaries（吸附词边界，避免切词中间）", () => {
  const words: CutWord[] = [{ word: "你", start: 1.0, end: 1.4 }, { word: "好", start: 1.4, end: 1.9 }, { word: "世界", start: 5.1, end: 5.8 }];
  it("边界吸到最近词起止（容差内）", () => {
    const out = snapToWordBoundaries([{ start: 1.05, end: 5.7 }], words, 0.3);
    expect(out[0].start).toBeCloseTo(1.0, 5);
    expect(out[0].end).toBeCloseTo(5.8, 5);
  });
  it("无词表 → 原样", () => {
    expect(snapToWordBoundaries([{ start: 2, end: 4 }], [])).toEqual([{ start: 2, end: 4 }]);
  });
});

describe("buildAiCutDoc（保留区间 → EditorDoc）", () => {
  it("视频轨按区间切片、start 累积、30ms 淡入淡出、调色写到 effects", () => {
    const doc = buildAiCutDoc(SRC, { keep: [{ start: 2, end: 6 }, { start: 10, end: 13 }], grade: "neutral_punch" }, [], {});
    expect(doc.normalizeAudio).toBe(true);
    const v = doc.tracks.find((t) => t.type === "video")!;
    expect(v.clips.length).toBe(2);
    expect(v.clips[0]).toMatchObject({ kind: "video", assetId: 7, assetUrl: "https://x/v.mp4", start: 0, trimIn: 2, trimOut: 6, fadeIn: 0.03, fadeOut: 0.03, effects: { filter: "neutral_punch" } });
    expect(v.clips[1].start).toBe(4); // 第一段 4s 后接第二段
    expect(v.clips[1]).toMatchObject({ trimIn: 10, trimOut: 13 });
  });
  it("grade=none / 未给 → 不写 effects；opts.grade 覆盖 plan.grade", () => {
    const a = buildAiCutDoc(SRC, { keep: [{ start: 0, end: 5 }], grade: "warm_cinematic" }, [], { grade: "none" });
    expect(a.tracks[0].clips[0].effects).toBeUndefined();
  });
  it("极短片段淡入淡出不超过半段时长", () => {
    const doc = buildAiCutDoc(SRC, { keep: [{ start: 0, end: 0.04 }] }, [], { fadeSec: 0.03 });
    expect(doc.tracks[0].clips[0].fadeIn).toBeCloseTo(0.02, 5);
  });
  it("subtitles + 词表 → 文字轨生成字幕；无词表则不生成", () => {
    const words: CutWord[] = [{ word: "一", start: 2.1, end: 2.4 }, { word: "二", start: 2.4, end: 2.8 }, { word: "三", start: 11, end: 11.4 }];
    const doc = buildAiCutDoc(SRC, { keep: [{ start: 2, end: 3 }, { start: 10, end: 13 }] }, words, { subtitles: true });
    const t = doc.tracks.find((t) => t.type === "text")!;
    expect(t.clips.length).toBeGreaterThan(0);
    expect(t.clips[0].kind).toBe("text");
    // 边界吸附把保留段起点吸到首词(2.1)，故首字幕映射到输出时间轴 ~0。
    expect(t.clips[0].start).toBeCloseTo(0, 2);
    const doc2 = buildAiCutDoc(SRC, { keep: [{ start: 2, end: 3 }] }, [], { subtitles: true });
    expect(doc2.tracks.find((t) => t.type === "text")!.clips.length).toBe(0);
  });
});

describe("buildSubtitleClips 跨删除段断句 + aiCutStats", () => {
  it("跨保留段的词不并入同一句", () => {
    const words: CutWord[] = [{ word: "A", start: 2.1, end: 2.4 }, { word: "B", start: 11.0, end: 11.4 }];
    const clips = buildSubtitleClips(words, [{ start: 2, end: 3 }, { start: 10, end: 12 }], { subtitleMaxWords: 5 }, 48);
    expect(clips.length).toBe(2); // A 与 B 分属两段，断成两句
  });
  it("aiCutStats 统计保留/删除时长", () => {
    const doc = buildAiCutDoc(SRC, { keep: [{ start: 0, end: 4 }, { start: 10, end: 16 }] }, [], {});
    expect(aiCutStats(doc, 30)).toMatchObject({ keptSec: 10, removedSec: 20, clips: 2 });
  });
});
