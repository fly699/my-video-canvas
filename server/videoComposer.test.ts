import { describe, expect, it } from "vitest";
import { buildFilterGraph, segmentDuration, collectVideoSegments, buildEditorASS, type Segment, type AudioInput, type TextInput } from "./_core/videoComposer";
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

  it("applies fit mode: contain (pad), cover (crop), stretch (exact scale)", () => {
    const mk = (fit: "contain" | "cover" | "stretch") => buildFilterGraph(
      [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 2, speed: 1, fit }], OPTS).filterComplex;
    expect(mk("contain")).toContain("force_original_aspect_ratio=decrease");
    expect(mk("contain")).toContain("pad=1920:1080");
    expect(mk("cover")).toContain("force_original_aspect_ratio=increase");
    expect(mk("cover")).toContain("crop=1920:1080");
    const s = mk("stretch");
    expect(s).toContain("scale=1920:1080,"); // exact, no ratio flag
    expect(s).not.toContain("force_original_aspect_ratio");
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

  it("mixes audio-track clips with delay/volume/fades + the ass filter for text", () => {
    const segs: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 5, speed: 1 }];
    const audioClips: AudioInput[] = [{ trimIn: 0, trimOut: 4, speed: 1, start: 0.5, volume: 0.8, fadeIn: 0.5, fadeOut: 0.5 }];
    const g = buildFilterGraph(segs, OPTS, [], { audioClips, assPath: "/tmp/x.ass" });
    expect(g.filterComplex).toContain("adelay=delays=500:all=1");
    expect(g.filterComplex).toContain("volume=0.800");
    expect(g.filterComplex).toContain("afade=t=in:st=0:d=0.500");
    expect(g.filterComplex).toContain("amix=inputs=2:normalize=0");
    expect(g.filterComplex).toContain("ass='/tmp/x.ass'");
    expect(g.outA).toBe("[outa]");
    expect(g.outV).toBe("[sv]");
  });

  it("buildEditorASS emits positioned, faded CJK-capable dialogue", () => {
    const clips: TextInput[] = [{ start: 1, end: 3, text: { content: "中文字幕", size: 60, color: "#ffff00", motionStyle: "fade" }, x: 0.1, y: 0.8 }];
    const ass = buildEditorASS(clips, { width: 1920, height: 1080 });
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("\\pos(192,864)"); // 0.1*1920, 0.8*1080
    expect(ass).toContain("\\fs60");
    expect(ass).toContain("\\fad(300,300)");
    expect(ass).toContain("中文字幕");
  });

  it("buildEditorASS applies bold/italic/stroke/shadow styling", () => {
    const clips: TextInput[] = [{ start: 0, end: 2, x: 0.1, y: 0.8, text: {
      content: "样式", size: 50, color: "#ffffff", bold: true, italic: true,
      strokeWidth: 5, strokeColor: "#ff0000", shadow: true, shadowColor: "#000000",
    } }];
    const ass = buildEditorASS(clips, { width: 1920, height: 1080 });
    expect(ass).toContain("\\b1");      // bold
    expect(ass).toContain("\\i1");      // italic
    expect(ass).toContain("\\bord5");   // stroke width
    expect(ass).toContain("\\3c");      // stroke colour
    expect(ass).toContain("\\shad3");   // shadow depth
    expect(ass).toContain("\\4c");      // shadow colour
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
