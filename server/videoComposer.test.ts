import { describe, expect, it } from "vitest";
import { buildFilterGraph, segmentDuration, collectVideoSegments, type Segment } from "./_core/videoComposer";
import { emptyEditorDoc } from "@shared/editorTypes";

const OPTS = { width: 1920, height: 1080, fps: 30 };

describe("buildFilterGraph (single-pass composer)", () => {
  it("normalizes + concatenates a video + image segment in one graph", () => {
    const segs: Segment[] = [
      { isImage: false, hasAudio: true, trimIn: 1, trimOut: 4, speed: 1 },
      { isImage: true, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1 },
    ];
    const g = buildFilterGraph(segs, OPTS);
    // video chains
    expect(g.filterComplex).toContain("[0:v]");
    expect(g.filterComplex).toContain("trim=start=1.000:end=4.000");
    expect(g.filterComplex).toContain("scale=1920:1080:force_original_aspect_ratio=decrease");
    expect(g.filterComplex).toContain("pad=1920:1080");
    expect(g.filterComplex).toContain("fps=30");
    // real audio for clip 0, silence for the image clip 1
    expect(g.filterComplex).toContain("[0:a]atrim=start=1.000:end=4.000");
    expect(g.filterComplex).toContain("anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:2.000");
    // concat of both with interleaved labels
    expect(g.filterComplex).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]");
    expect(g.outV).toBe("[outv]");
    expect(g.outA).toBe("[outa]");
  });

  it("injects setpts speed change for sped-up clips", () => {
    const segs: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 10, speed: 2 }];
    const g = buildFilterGraph(segs, OPTS);
    expect(g.filterComplex).toContain("setpts=0.500000*PTS"); // 1/2
    expect(g.filterComplex).toContain("atempo=2.000000");
  });

  it("segmentDuration accounts for speed (video) and raw length (image)", () => {
    expect(segmentDuration({ isImage: false, hasAudio: true, trimIn: 0, trimOut: 10, speed: 2 })).toBe(5);
    expect(segmentDuration({ isImage: true, hasAudio: false, trimIn: 0, trimOut: 3, speed: 1 })).toBe(3);
  });

  it("folds with xfade when a segment has a transition, and acrossfade for audio", () => {
    const segs: Segment[] = [
      { isImage: false, hasAudio: true, trimIn: 0, trimOut: 3, speed: 1 },
      { isImage: false, hasAudio: true, trimIn: 0, trimOut: 3, speed: 1, transition: { type: "dissolve", duration: 1 } },
    ];
    const g = buildFilterGraph(segs, OPTS);
    expect(g.filterComplex).toContain("xfade=transition=dissolve:duration=1.000:offset=2.000");
    expect(g.filterComplex).toContain("acrossfade=d=1.000");
    expect(g.duration).toBeCloseTo(5, 3); // 3 + 3 - 1
  });

  it("inserts color eq + preset filter into the clip chain", () => {
    const segs: Segment[] = [{ isImage: false, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1, effects: { brightness: 0.1, contrast: 1.2, saturation: 1.3, filter: "warm" } }];
    const g = buildFilterGraph(segs, OPTS);
    expect(g.filterComplex).toContain("eq=brightness=0.1:contrast=1.2:saturation=1.3");
    expect(g.filterComplex).toContain("colorbalance=");
  });

  it("composites an overlay with position/scale/opacity and time-gated enable", () => {
    const segs: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 4, speed: 1 }];
    const overlays = [{ isImage: true, trimIn: 0, trimOut: 2, speed: 1, start: 1, duration: 2, transform: { x: 0.5, y: 0.25, scale: 0.3, opacity: 0.8 } }];
    const g = buildFilterGraph(segs, OPTS, overlays);
    expect(g.filterComplex).toContain("[1:v]"); // overlay input index = main count
    expect(g.filterComplex).toContain("scale=576:-2"); // 0.3 * 1920
    expect(g.filterComplex).toContain("colorchannelmixer=aa=0.800");
    expect(g.filterComplex).toContain("overlay=x=960:y=270:enable='between(t,1.000,3.000)'");
    expect(g.outV).toBe("[ob0]");
  });

  it("collectVideoSegments sorts video/image clips by start and ignores audio/text", () => {
    const doc = emptyEditorDoc();
    doc.tracks[0].clips.push({ id: "b", kind: "video", start: 5, trimIn: 0, trimOut: 2, assetUrl: "x" });
    doc.tracks[0].clips.push({ id: "a", kind: "image", start: 1, trimIn: 0, trimOut: 2, assetUrl: "y" });
    doc.tracks[1].clips.push({ id: "aud", kind: "audio", start: 0, trimIn: 0, trimOut: 2, assetUrl: "z" });
    doc.tracks[2].clips.push({ id: "txt", kind: "text", start: 0, trimIn: 0, trimOut: 2, text: { content: "hi" } });
    const got = collectVideoSegments(doc);
    expect(got.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
