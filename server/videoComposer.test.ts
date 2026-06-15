import { describe, expect, it } from "vitest";
import { buildFilterGraph, buildKeyframeExpr, segmentTransformChain, segmentZoomPanChain, chromaKeyFilter, segmentDuration, collectVideoSegments, buildEditorASS, type Segment, type AudioInput, type TextInput, type OverlayInput } from "./_core/videoComposer";
import { emptyEditorDoc, applyEase, transformAt, type Clip } from "@shared/editorTypes";

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

  it("fit mode: blur emits split + blurred cover background overlaid by contain foreground", () => {
    const g = buildFilterGraph([{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 2, speed: 1, fit: "blur" }], OPTS).filterComplex;
    expect(g).toContain("split[bg0][fg0]");
    // background: cover-scale + crop + blur
    expect(g).toContain("[bg0]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=20:2");
    // foreground: contain-scale, then centered overlay → normalized output [v0]
    expect(g).toContain("[fg0]scale=1920:1080:force_original_aspect_ratio=decrease");
    expect(g).toContain("overlay=(W-w)/2:(H-h)/2");
    expect(g).toContain("[v0]");
  });

  it("reverse: adds reverse (video) + areverse (audio) before setpts/atempo", () => {
    const g = buildFilterGraph([{ isImage: false, hasAudio: true, trimIn: 1, trimOut: 4, speed: 2, reverse: true }], OPTS).filterComplex;
    // video: trim → reverse → setpts → speed
    expect(g).toMatch(/trim=start=1\.000:end=4\.000,reverse,setpts=PTS-STARTPTS,setpts=0\.500000\*PTS/);
    // audio: atrim → areverse → asetpts → atempo
    expect(g).toMatch(/atrim=start=1\.000:end=4\.000,areverse,asetpts=PTS-STARTPTS,atempo/);
    // an image segment (no reverse semantics) must NOT get a reverse filter
    const gi = buildFilterGraph([{ isImage: true, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1, reverse: true }], OPTS).filterComplex;
    expect(gi).not.toContain("reverse");
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

  it("maps transition names to xfade ids: new types pass through, legacy/unknown map safely", () => {
    const mk = (type: string): Segment[] => [
      { isImage: true, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1 },
      { isImage: true, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1, transition: { type, duration: 0.5 } },
    ];
    const fc = (type: string) => buildFilterGraph(mk(type), OPTS).filterComplex;
    expect(fc("circleopen")).toContain("xfade=transition=circleopen:");   // new value, verified valid in ffmpeg
    expect(fc("pixelize")).toContain("xfade=transition=pixelize:");
    expect(fc("slide")).toContain("xfade=transition=slideleft:");          // legacy alias
    expect(fc("wipe")).toContain("xfade=transition=wipeleft:");            // legacy alias
    expect(fc("bogus")).toContain("xfade=transition=fade:");               // unknown → safe default
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

  it("ducking music: sidechaincompress against the voice bus, key split back into the mix", () => {
    const segs: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 5, speed: 1 }];
    const audioClips: AudioInput[] = [
      { trimIn: 0, trimOut: 5, speed: 1, start: 0, volume: 1, fadeIn: 0, fadeOut: 0, ducking: true }, // music
      { trimIn: 0, trimOut: 5, speed: 1, start: 0, volume: 1, fadeIn: 0, fadeOut: 0 },                // voiceover
    ];
    const g = buildFilterGraph(segs, OPTS, [], { audioClips }).filterComplex;
    expect(g).toContain("asplit=2[keyout][keysc]");
    expect(g).toContain("[musicfmt][keysc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[ducked]");
    expect(g).toContain("[keyout][ducked]amix=inputs=2:normalize=0");
    // the voice bus = base audio + the non-ducking clip, amixed into the key
    expect(g).toContain("[keyraw]");
  });

  it("color-grade presets emit their filter chains into the segment", () => {
    const mk = (filter: string): Segment[] => [{ isImage: true, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1, effects: { filter } } as Segment];
    const fc = (filter: string) => buildFilterGraph(mk(filter), OPTS).filterComplex;
    expect(fc("teal_orange")).toContain("colorbalance=rs=-0.08:bs=0.08:rh=0.10:bh=-0.08");
    expect(fc("sepia")).toContain("colorchannelmixer=.393:.769:.189:0");
    expect(fc("cyberpunk")).toContain("eq=saturation=1.30:contrast=1.05");
    expect(fc("noir")).toContain("hue=s=0");
  });

  it("chromaKeyFilter sanitizes colour to 0xRRGGBB and clamps params (injection-safe)", () => {
    expect(chromaKeyFilter(undefined)).toBeNull();
    expect(chromaKeyFilter({ color: "#00ff00", similarity: 0.3, blend: 0.1 })).toBe("chromakey=0x00ff00:0.300:0.100");
    expect(chromaKeyFilter({ color: "0x123ABC" })).toBe("chromakey=0x123ABC:0.300:0.100"); // defaults applied
    // malicious / malformed colour never reaches the filter string → safe default
    expect(chromaKeyFilter({ color: "green'):crop=1:1:0:0" })).toBe("chromakey=0x00D000:0.300:0.100");
    // params clamped into range
    expect(chromaKeyFilter({ color: "#00ff00", similarity: 9, blend: -5 })).toBe("chromakey=0x00ff00:1.000:0.000");
  });

  it("overlay chromaKey injects chromakey after format=rgba", () => {
    const segs: Segment[] = [{ isImage: true, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1 }];
    const overlays: OverlayInput[] = [{ isImage: true, trimIn: 0, trimOut: 2, speed: 1, start: 0, duration: 2, chromaKey: { color: "#00ff00", similarity: 0.3, blend: 0.1 } }];
    const g = buildFilterGraph(segs, OPTS, overlays).filterComplex;
    expect(g).toContain("format=rgba,chromakey=0x00ff00:0.300:0.100");
  });

  it("denoise flag inserts afftdn on the audio clip; absent → no afftdn", () => {
    const segs: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 5, speed: 1 }];
    const on = buildFilterGraph(segs, OPTS, [], { audioClips: [{ trimIn: 0, trimOut: 5, speed: 1, start: 0, volume: 1, fadeIn: 0, fadeOut: 0, denoise: true }] }).filterComplex;
    expect(on).toContain("afftdn=nr=20:nf=-30");
    const off = buildFilterGraph(segs, OPTS, [], { audioClips: [{ trimIn: 0, trimOut: 5, speed: 1, start: 0, volume: 1, fadeIn: 0, fadeOut: 0 }] }).filterComplex;
    expect(off).not.toContain("afftdn");
  });

  it("no ducking flag → original plain amix (no sidechaincompress)", () => {
    const segs: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 5, speed: 1 }];
    const g = buildFilterGraph(segs, OPTS, [], { audioClips: [{ trimIn: 0, trimOut: 5, speed: 1, start: 0, volume: 1, fadeIn: 0, fadeOut: 0 }] }).filterComplex;
    expect(g).not.toContain("sidechaincompress");
    expect(g).toContain("amix=inputs=2:normalize=0");
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

  it("buildEditorASS 文字入场动效：滑入(\\move+\\fad)/弹入(\\fscx\\t)/滚动(\\move 全屏)", () => {
    const mk = (m: string) => buildEditorASS([{ start: 1, end: 3, text: { content: "字", size: 60, motionStyle: m as never }, x: 0.1, y: 0.8 }], { width: 1920, height: 1080 });
    // off = round(1080*0.06)=65 → 上滑入从 864+65=929 归位到 864
    expect(mk("slideup")).toContain("\\move(192,929,192,864,0,350)");
    expect(mk("slideup")).toContain("\\fad(350,0)");
    expect(mk("slidedown")).toContain("\\move(192,799,192,864,0,350)"); // 864-65=799
    expect(mk("pop")).toContain("\\fscx40\\fscy40\\t(0,350,\\fscx100\\fscy100)");
    expect(mk("pop")).toContain("\\fad(150,0)");
    expect(mk("roll")).toContain("\\move(192,1080,192,864)");           // 从画面底部滚入（不变）
    expect(mk("none")).toContain("\\pos(192,864)");                     // 无动效仅定位
    expect(mk("none")).not.toContain("\\move");
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

describe("segmentTransformChain (main-track zoom/pan export)", () => {
  it("no transform / no zoom → empty (no-op)", () => {
    expect(segmentTransformChain(undefined, 1920, 1080)).toEqual([]);
    expect(segmentTransformChain({}, 1920, 1080)).toEqual([]);
    expect(segmentTransformChain({ scale: 1 }, 1920, 1080)).toEqual([]);
    expect(segmentTransformChain({ scale: 0.5 }, 1920, 1080)).toEqual([]); // <1 ignored (no shrink-to-black)
    expect(segmentTransformChain({ x: 0.2 }, 1920, 1080)).toEqual([]); // pan w/o zoom → nothing to reveal
  });

  it("zoom 2x centered → scale up then center-crop back to frame", () => {
    expect(segmentTransformChain({ scale: 2 }, 1920, 1080)).toEqual([
      "scale=3840:2160",
      "crop=1920:1080:960:540", // maxFrac 0.5 → cropX 0.5*1920, cropY 0.5*1080
    ]);
  });

  it("zoom 2x + pan → crop offset reduced by the (clamped) pan", () => {
    expect(segmentTransformChain({ scale: 2, x: 0.25, y: -0.25 }, 1920, 1080)).toEqual([
      "scale=3840:2160",
      "crop=1920:1080:480:810", // x:(0.5-0.25)*1920=480 ; y:(0.5+0.25)*1080=810
    ]);
  });

  it("pan beyond the available room is clamped so the crop stays in-bounds", () => {
    // scale 2 → maxFrac 0.5. x=5 clamps to 0.5 → cropX (0.5-0.5)*1920 = 0 (valid, not negative)
    const out = segmentTransformChain({ scale: 2, x: 5 }, 1920, 1080);
    expect(out[1]).toBe("crop=1920:1080:0:540");
  });

  it("rotation emits a frame-size-preserving rotate", () => {
    expect(segmentTransformChain({ rotation: 90 }, 1920, 1080)[0]).toBe("rotate=1.57080:ow=iw:oh=ih");
  });
});

describe("segmentZoomPanChain (main-track Ken-Burns export)", () => {
  it("no / single keyframe → falls back to the static transform chain", () => {
    expect(segmentZoomPanChain({ scale: 2 }, undefined, 1920, 1080)).toEqual(segmentTransformChain({ scale: 2 }, 1920, 1080));
    expect(segmentZoomPanChain({ scale: 2 }, [{ t: 0, scale: 2, x: 0, y: 0 }], 1920, 1080)).toEqual(segmentTransformChain({ scale: 2 }, 1920, 1080));
  });

  it("animated zoom/pan → per-frame scale + clip()-clamped crop expressions", () => {
    const out = segmentZoomPanChain(undefined, [
      { t: 0, scale: 1, x: 0, y: 0 },
      { t: 2, scale: 2, x: 0.2, y: -0.1 },
    ], 1920, 1080);
    // scale grows over t via a piecewise-linear expr, evaluated per frame
    expect(out[0]).toMatch(/^scale=w='1920\*\(if\(lt\(t,/);
    expect(out[0]).toContain(":eval=frame");
    // crop stays w×h, offset clamped in-bounds so it can never leave the zoomed
    // frame. NO eval=frame on crop — the crop filter has no such option (it errors
    // "Option not found"); crop's x/y are evaluated per-frame by default.
    expect(out[1]).toContain("crop=1920:1080:x='clip((iw-1920)/2-(");
    expect(out[1]).toContain("),0,iw-1920)'");
    expect(out[1]).not.toContain("eval=frame");
  });

  it("clamps animated scale to ≥1 (no shrink-to-black)", () => {
    const out = segmentZoomPanChain(undefined, [
      { t: 0, scale: 0.5 },
      { t: 1, scale: 0.8 },
    ], 1920, 1080);
    // both keyframes clamp to 1 → the raw 0.5 / 0.8 never reach the expression
    expect(out[0]).toContain("scale=w='1920*(");
    expect(out[0]).not.toContain("0.5");
    expect(out[0]).not.toContain("0.8");
  });

  it("appears in the full graph for a segment carrying animation keyframes", () => {
    const seg: Segment = { isImage: true, hasAudio: false, trimIn: 0, trimOut: 3, speed: 1, fit: "cover", keyframes: [{ t: 0, scale: 1, x: 0, y: 0 }, { t: 3, scale: 1.5, x: 0.1, y: 0 }] } as Segment;
    const g = buildFilterGraph([seg], OPTS).filterComplex;
    expect(g).toContain("eval=frame");
    expect(g).toContain("scale=w='1920*(");
  });
});

describe("fit modes incl. 1:1 原始 (none) + blur honours transform", () => {
  const base = (fit: "none" | "blur", transform?: object): Segment[] =>
    [{ isImage: true, hasAudio: false, trimIn: 0, trimOut: 3, speed: 1, fit, ...(transform ? { transform } : {}) } as Segment];

  it("fit=none renders the source 1:1, centered, padded-or-cropped to the canvas", () => {
    const g = buildFilterGraph(base("none"), OPTS).filterComplex;
    expect(g).toContain("pad=w='max(1920,iw)':h='max(1080,ih)':x=(ow-iw)/2:y=(oh-ih)/2:color=black");
    expect(g).toContain("crop=1920:1080");
    expect(g).not.toContain("scale=1920:1080"); // 1:1 = no scaling
  });

  it("fit=blur with a zoom transform now applies the zoom in export (preview/export parity)", () => {
    const g = buildFilterGraph(base("blur", { scale: 2 }), OPTS).filterComplex;
    expect(g).toContain("boxblur"); // blur path still active
    expect(g).toContain("scale=3840:2160"); // the transform zoom is applied
    expect(g).toContain("crop=1920:1080:960:540");
  });

  it("fit=blur without a transform is unchanged (no zoom filter)", () => {
    const g = buildFilterGraph(base("blur"), OPTS).filterComplex;
    expect(g).toContain("boxblur");
    expect(g).not.toContain("scale=3840"); // no zoom
  });
});

describe("overlay position keyframes (export animation)", () => {
  const baseSeg: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 5, speed: 1 }];

  it("buildKeyframeExpr: empty → null, single → constant, two → clamped linear", () => {
    expect(buildKeyframeExpr([])).toBeNull();
    expect(buildKeyframeExpr([{ t: 1, v: 5 }])).toBe("5");
    const e = buildKeyframeExpr([{ t: 0, v: 0 }, { t: 2, v: 10 }])!;
    expect(e.startsWith("if(lt(t,0),0,")).toBe(true);     // hold first value before t=0
    expect(e).toContain("if(lt(t,2),(0+(t-0)*5)");        // segment with slope 5
    expect(e.endsWith(",10))")).toBe(true);               // hold last value after t=2
  });

  it("buildKeyframeExpr: 缓动曲线（ease）改区间插值，linear 仍逐字不变", () => {
    // linear 与无 ease 字节一致（零回归）
    expect(buildKeyframeExpr([{ t: 0, v: 0, ease: "linear" }, { t: 2, v: 10 }]))
      .toBe(buildKeyframeExpr([{ t: 0, v: 0 }, { t: 2, v: 10 }]));
    // 缓入：区间用 R*R 多项式（R=(t-at)/dt），不再是线性 slope
    const ein = buildKeyframeExpr([{ t: 0, v: 0, ease: "in" }, { t: 2, v: 10 }])!;
    expect(ein).toContain("((t-0)/2)*((t-0)/2)");          // R*R
    expect(ein).toContain("(0+(10-0)*");                   // a + (b-a)*ease
    expect(ein).not.toContain("(t-0)*5");                  // 不是线性段
    // 缓出 / 缓入缓出 各自的多项式
    expect(buildKeyframeExpr([{ t: 0, v: 0, ease: "out" }, { t: 2, v: 10 }])!).toContain("(2-((t-0)/2))");
    expect(buildKeyframeExpr([{ t: 0, v: 0, ease: "inout" }, { t: 2, v: 10 }])!).toContain("(3-2*((t-0)/2))");
  });

  it("animates overlay x/y from keyframes via per-frame expr in absolute time", () => {
    const overlays = [{
      isImage: true, trimIn: 0, trimOut: 3, speed: 1, start: 2, duration: 3,
      transform: { x: 0.1, y: 0.5 },
      keyframes: [{ t: 0, x: 0.1, y: 0.5 }, { t: 3, x: 0.8, y: 0.5 }],
    }];
    const g = buildFilterGraph(baseSeg, OPTS, overlays);
    expect(g.filterComplex).toContain("eval=frame");
    expect(g.filterComplex).toContain("overlay=x='if(lt(t,");
    expect(g.filterComplex).toContain("192");             // first kf: 0.1 * 1920
    expect(g.filterComplex).toContain("1536");            // last kf: 0.8 * 1920
    expect(g.filterComplex).toContain("if(lt(t,5)");      // boundary at absolute time 2 + 3
  });

  it("keeps overlay x/y static numeric when there are no keyframes", () => {
    const overlays = [{ isImage: true, trimIn: 0, trimOut: 3, speed: 1, start: 0, duration: 3, transform: { x: 0.25, y: 0.25 } }];
    const g = buildFilterGraph(baseSeg, OPTS, overlays);
    expect(g.filterComplex).not.toContain("eval=frame");
    expect(g.filterComplex).toContain("overlay=x=480:y=270"); // 0.25*1920, 0.25*1080
  });
});

describe("applyEase / transformAt — 关键帧补间缓动（预览与导出同曲线）", () => {
  it("applyEase 各曲线在 r=0/0.5/1 的取值", () => {
    for (const e of ["linear", "in", "out", "inout"] as const) {
      expect(applyEase(0, e)).toBeCloseTo(0, 6);
      expect(applyEase(1, e)).toBeCloseTo(1, 6);
    }
    expect(applyEase(0.5, "linear")).toBeCloseTo(0.5, 6);
    expect(applyEase(0.5, "in")).toBeCloseTo(0.25, 6);    // r*r
    expect(applyEase(0.5, "out")).toBeCloseTo(0.75, 6);   // r*(2-r)
    expect(applyEase(0.5, "inout")).toBeCloseTo(0.5, 6);  // smoothstep 对称
    expect(applyEase(0.25, "inout")).toBeCloseTo(0.15625, 6);
    expect(applyEase(-1, "in")).toBe(0); expect(applyEase(2, "in")).toBe(1); // 夹紧
  });

  it("transformAt 用起始关键帧的 ease 做补间", () => {
    const mk = (ease?: "linear" | "in" | "out" | "inout"): Clip => ({
      id: "c", kind: "image", start: 0, trimIn: 0, trimOut: 2,
      keyframes: [{ t: 0, scale: 1, ease }, { t: 1, scale: 2 }],
    });
    expect(transformAt(mk("linear"), 0.5).scale).toBeCloseTo(1.5, 6);
    expect(transformAt(mk("in"), 0.5).scale).toBeCloseTo(1.25, 6);
    expect(transformAt(mk("out"), 0.5).scale).toBeCloseTo(1.75, 6);
    expect(transformAt(mk("inout"), 0.5).scale).toBeCloseTo(1.5, 6);
    // 端点不受曲线影响
    expect(transformAt(mk("in"), 0).scale).toBeCloseTo(1, 6);
    expect(transformAt(mk("in"), 1).scale).toBeCloseTo(2, 6);
  });
});

describe("片段画面淡入淡出（visual fade：video fade / overlay alpha / 同步音频 afade）", () => {
  it("主轨视频片段：画面 fade=t=in/out + 音频 afade", () => {
    const segs: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 4, speed: 1, fadeIn: 0.5, fadeOut: 0.5 }];
    const g = buildFilterGraph(segs, OPTS).filterComplex;
    expect(g).toContain("fade=t=in:st=0:d=0.500");
    expect(g).toContain("fade=t=out:st=3.500:d=0.500");   // dur 4 - 0.5
    expect(g).toContain("afade=t=in:st=0:d=0.500");        // 音频同步淡入
    expect(g).toContain("afade=t=out:st=3.500:d=0.500");
  });

  it("无淡入淡出 → 不产生 fade=t= / afade（且不误伤 xfade transition=fade）", () => {
    const g = buildFilterGraph([{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 3, speed: 1 }], OPTS).filterComplex;
    expect(g).not.toContain("fade=t=in");
    expect(g).not.toContain("afade=t=");
  });

  it("淡入时长被夹到片段时长，st 不为负", () => {
    const g = buildFilterGraph([{ isImage: true, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1, fadeOut: 5 }], OPTS).filterComplex;
    expect(g).toContain("fade=t=out:st=0.000:d=2.000"); // 5 夹到 2，st=2-2=0
  });

  it("叠加层：alpha 淡入淡出（fade=...:alpha=1，在时间轴位移前的本地时基）", () => {
    const segs: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 5, speed: 1 }];
    const overlays: OverlayInput[] = [{ isImage: true, trimIn: 0, trimOut: 3, speed: 1, start: 1, duration: 3, transform: { x: 0.2, y: 0.2, scale: 0.3 }, fadeIn: 0.4, fadeOut: 0.6 }];
    const g = buildFilterGraph(segs, OPTS, overlays).filterComplex;
    expect(g).toContain("fade=t=in:st=0:d=0.400:alpha=1");
    expect(g).toContain("fade=t=out:st=2.400:d=0.600:alpha=1"); // duration 3 - 0.6
  });
});
