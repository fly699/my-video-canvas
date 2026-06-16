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
    expect(mk("contain")).toContain(":flags=lanczos"); // 高质量缩放算法（下采样更锐）
    expect(mk("cover")).toContain("force_original_aspect_ratio=increase");
    expect(mk("cover")).toContain("crop=1920:1080");
    const s = mk("stretch");
    expect(s).toContain("scale=1920:1080:flags=lanczos,"); // exact, no ratio flag（lanczos 高质量缩放）
    expect(s).not.toContain("force_original_aspect_ratio");
  });

  it("fit mode: blur emits split + blurred cover background overlaid by contain foreground", () => {
    const g = buildFilterGraph([{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 2, speed: 1, fit: "blur" }], OPTS).filterComplex;
    expect(g).toContain("split[bg0][fg0]");
    // background: cover-scale + crop + blur
    expect(g).toContain("[bg0]scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,boxblur=20:2");
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

  it("主轨片段不透明度：op<1 时 RGB 朝黑乘 op（与预览一致）；op=1/缺省时零回归", () => {
    const mk = (opacity?: number): Segment[] => [{ isImage: false, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1, transform: opacity != null ? { opacity } : undefined }];
    const fc = (opacity?: number) => buildFilterGraph(mk(opacity), OPTS).filterComplex;
    expect(fc(0.5)).toContain("colorchannelmixer=rr=0.500:gg=0.500:bb=0.500");
    expect(fc(0.25)).toContain("colorchannelmixer=rr=0.250:gg=0.250:bb=0.250");
    // op=1 / 缺省 → 完全不插入（链路逐字节不变）
    expect(fc(1)).not.toContain("colorchannelmixer");
    expect(fc(undefined)).not.toContain("colorchannelmixer");
  });

  it("原声音量：主轨视频片段的 volume 增益作用于其原声（1/缺省时不出现 → 零回归）", () => {
    const mk = (volume?: number): Segment[] => [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 2, speed: 1, volume }];
    const fc = (volume?: number) => buildFilterGraph(mk(volume), OPTS).filterComplex;
    // 半音量 → [0:a] 链含 volume=0.500
    expect(fc(0.5)).toContain("[0:a]");
    expect(fc(0.5)).toContain("volume=0.500");
    expect(fc(1.6)).toContain("volume=1.600"); // 可增益超过 100%
    // 1 / 缺省 → 不出现 volume= 滤镜
    expect(fc(1)).not.toContain("volume=");
    expect(fc(undefined)).not.toContain("volume=");
    // 静音片段（hasAudio=false）走 anullsrc，无 volume
    const silent = buildFilterGraph([{ isImage: true, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1, volume: 0.5 }], OPTS).filterComplex;
    expect(silent).not.toContain("volume=");
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

  it("画质质感：暗角 vignette + 锐化 unsharp（叠加在调色预设之后，0/缺省时零回归）", () => {
    const mk = (effects: Segment["effects"]): Segment[] => [{ isImage: true, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1, effects } as Segment];
    const fc = (effects: Segment["effects"]) => buildFilterGraph(mk(effects), OPTS).filterComplex;
    // 暗角强度 1 → 角度 = PI/2.2 ≈ 1.4280
    expect(fc({ vignette: 1 })).toContain("vignette=a=1.4280");
    expect(fc({ vignette: 0.5 })).toContain("vignette=a=0.7140");
    // 锐化强度 1 → unsharp 亮度增益 1.8（仅亮度通道，色度 0）
    expect(fc({ sharpen: 1 })).toContain("unsharp=5:5:1.800:5:5:0");
    expect(fc({ sharpen: 0.5 })).toContain("unsharp=5:5:0.900:5:5:0");
    // 叠加在预设之后：cinematic 的 curves 在前，vignette 在其后
    const stacked = fc({ filter: "cinematic", vignette: 0.5, sharpen: 0.5 });
    expect(stacked.indexOf("curves=preset=increase_contrast")).toBeLessThan(stacked.indexOf("vignette="));
    // 0 / 缺省 → 完全不出现（零回归）
    expect(fc({ vignette: 0, sharpen: 0 })).not.toContain("vignette=");
    expect(fc({ vignette: 0, sharpen: 0 })).not.toContain("unsharp=");
    expect(fc({ filter: "warm" })).not.toContain("vignette=");
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
    const clips: TextInput[] = [{ start: 1, end: 3, text: { content: "中文字幕", size: 60, color: "#ffff00", motionStyle: "fade", align: "left" }, x: 0.1, y: 0.8 }];
    const ass = buildEditorASS(clips, { width: 1920, height: 1080 });
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("\\an7\\pos(192,864)"); // 左对齐：锚点=框左缘 0.1*1920, 0.8*1080
    expect(ass).toContain("\\fs60");
    expect(ass).toContain("\\fad(300,300)");
    expect(ass).toContain("中文字幕");
  });

  it("buildEditorASS 文字对齐：左/中/右 → \\an7/8/9 + 盒模型锚点（与预览一致）", () => {
    const mk = (align: "left" | "center" | "right" | undefined) =>
      buildEditorASS([{ start: 0, end: 2, text: { content: "对齐", size: 48, align }, x: 0.1, y: 0.8, boxW: 0.4 }], { width: 1920, height: 1080 });
    // 左：锚点=框左缘 0.1 → 192；\an7
    expect(mk("left")).toContain("\\an7\\pos(192,864)");
    // 中（也是默认）：锚点=框中心 0.1+0.4/2=0.3 → 576；\an8
    expect(mk("center")).toContain("\\an8\\pos(576,864)");
    expect(mk(undefined)).toContain("\\an8\\pos(576,864)"); // 缺省=居中，与预览默认一致
    // 右：锚点=框右缘 0.1+0.4=0.5 → 960；\an9
    expect(mk("right")).toContain("\\an9\\pos(960,864)");
  });

  it("buildEditorASS 文字入场动效：滑入(\\move+\\fad)/弹入(\\fscx\\t)/滚动(\\move 全屏)", () => {
    const mk = (m: string) => buildEditorASS([{ start: 1, end: 3, text: { content: "字", size: 60, motionStyle: m as never, align: "left" }, x: 0.1, y: 0.8 }], { width: 1920, height: 1080 });
    // off = round(1080*0.06)=65 → 上滑入从 864+65=929 归位到 864
    expect(mk("slideup")).toContain("\\move(192,929,192,864,0,350)");
    expect(mk("slideup")).toContain("\\fad(350,0)");
    expect(mk("slidedown")).toContain("\\move(192,799,192,864,0,350)"); // 864-65=799
    expect(mk("pop")).toContain("\\fscx40\\fscy40\\t(0,350,\\fscx100\\fscy100)");
    expect(mk("pop")).toContain("\\fad(150,0)");
    expect(mk("roll")).toContain("\\move(192,1080,192,864)");           // 从画面底部滚入（不变）
    expect(mk("credits")).toContain("\\move(192,1080,192,-1080)");      // 片尾滚动：底部下方→顶部上方贯穿全程
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

  it("buildEditorASS 文字底色 bgColor → 用 Box 样式画不透明背景框（与预览的底框一致）", () => {
    const ass = buildEditorASS([{ start: 0, end: 2, x: 0.1, y: 0.8, text: {
      content: "底色", size: 50, color: "#ffffff", bgColor: "#0000ff",
    } }], { width: 1920, height: 1080 });
    expect(ass).toContain("Style: Box,");                 // 头部声明了 BorderStyle=3 的 Box 样式
    expect(ass).toContain(",Box,,0,0,0,,");                // 该字幕事件引用 Box 样式
    expect(ass).toContain("\\3c&HFF0000&");               // 框色 = bgColor 蓝(#0000ff → ASS BBGGRR=FF0000)
    expect(ass).toMatch(/\\bord\d+/);                      // 内边距
    // 无底色时仍走 Default、不出现 Box 引用
    const plain = buildEditorASS([{ start: 0, end: 2, x: 0.1, y: 0.8, text: { content: "无", size: 50 } }], { width: 1920, height: 1080 });
    expect(plain).toContain(",Default,,0,0,0,,");
    expect(plain).not.toContain(",Box,,0,0,0,,");
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

describe("音频淡变曲线（afade curve=）", () => {
  it("curve 透传 / 未知曲线白名单拒绝 / 无曲线与 tri 逐字不变（零回归）", () => {
    const mk = (curve?: string) => buildFilterGraph(
      [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 5, speed: 1 }], OPTS, [],
      { audioClips: [{ trimIn: 0, trimOut: 4, speed: 1, start: 0, volume: 1, fadeIn: 0.5, fadeOut: 0.5, fadeCurve: curve }] },
    ).filterComplex;
    expect(mk("log")).toContain("afade=t=in:st=0:d=0.500:curve=log");
    expect(mk("exp")).toContain("afade=t=out:st=3.500:d=0.500:curve=exp");
    expect(mk("evil;rm -rf /")).not.toContain("curve=");  // 注入防护：白名单外拒绝
    expect(mk(undefined)).toContain("afade=t=in:st=0:d=0.500");
    expect(mk(undefined)).not.toContain("curve=");
    expect(mk("tri")).not.toContain("curve=");            // 线性默认不加 :curve=
  });

  it("主轨片段的 fadeCurve 也作用到其音频", () => {
    const g = buildFilterGraph([{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 4, speed: 1, fadeIn: 0.5, fadeCurve: "qsin" }], OPTS).filterComplex;
    expect(g).toContain("afade=t=in:st=0:d=0.500:curve=qsin");
  });
});

describe("响度归一化（loudnorm -14 LUFS，导出最终音轨）", () => {
  it("开启时在最终音轨加 loudnorm 并改 outA；关闭时零回归", () => {
    const seg: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 3, speed: 1 }];
    const on = buildFilterGraph(seg, { ...OPTS, normalizeAudio: true });
    expect(on.filterComplex).toContain("[outa]loudnorm=I=-14:TP=-1.5:LRA=11[outan]");
    expect(on.outA).toBe("[outan]");
    const off = buildFilterGraph(seg, OPTS);
    expect(off.filterComplex).not.toContain("loudnorm");
    expect(off.outA).toBe("[outa]");
  });

  it("通用路径（有音频轨）也在混音后归一化", () => {
    const seg: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 5, speed: 1 }];
    const g = buildFilterGraph(seg, { ...OPTS, normalizeAudio: true }, [], { audioClips: [{ trimIn: 0, trimOut: 4, speed: 1, start: 0, volume: 1, fadeIn: 0, fadeOut: 0 }] });
    expect(g.filterComplex).toContain("loudnorm=I=-14:TP=-1.5:LRA=11[outan]");
    expect(g.outA).toBe("[outan]");
    expect(g.filterComplex.indexOf("amix")).toBeLessThan(g.filterComplex.indexOf("loudnorm")); // 先混音后归一化
  });
});

describe("整片首尾淡入淡出（master fade，最终视频+音频总线）", () => {
  it("开启 → 最终视频 fade、音频 afade，outV/outA 指向 finalize 标签", () => {
    const seg: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 4, speed: 1 }];
    const g = buildFilterGraph(seg, { ...OPTS, masterFadeIn: 1, masterFadeOut: 1 });
    expect(g.filterComplex).toContain("[outv]fade=t=in:st=0:d=1.000,fade=t=out:st=3.000:d=1.000[outvf]");
    expect(g.filterComplex).toContain("[outa]afade=t=in:st=0:d=1.000,afade=t=out:st=3.000:d=1.000[outan]");
    expect(g.outV).toBe("[outvf]");
    expect(g.outA).toBe("[outan]");
  });

  it("关闭 → 零回归（无 fade=t= / afade，outV=[outv]）", () => {
    const g = buildFilterGraph([{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 3, speed: 1 }], OPTS);
    expect(g.filterComplex).not.toContain("fade=t=in");
    expect(g.outV).toBe("[outv]");
    expect(g.outA).toBe("[outa]");
  });

  it("与响度归一化并用：loudnorm 在前、首尾 afade 在后", () => {
    const g = buildFilterGraph([{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 4, speed: 1 }], { ...OPTS, normalizeAudio: true, masterFadeIn: 0.5, masterFadeOut: 0.5 });
    expect(g.filterComplex).toContain("[outa]loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.500,afade=t=out:st=3.500:d=0.500[outan]");
  });
});

import { shapeDrawbox, type ShapeInput } from "./_core/videoComposer";

describe("形状叠加（shapeDrawbox + buildFilterGraph shapes）", () => {
  const base: ShapeInput = { start: 1, end: 4, type: "rect", x: 0.1, y: 0.2, w: 0.4, h: 0.3 };
  it("矩形几何/颜色/时间门控正确；填充 vs 描边", () => {
    const fill = shapeDrawbox({ ...base, fill: true, color: "#FF0000", opacity: 0.5 }, 1920, 1080);
    expect(fill).toBe("drawbox=x=192:y=216:w=768:h=324:color=0xFF0000@0.500:t=fill:enable='between(t,1.000,4.000)'");
    const line = shapeDrawbox({ ...base, fill: false, color: "#00FF00", lineWidth: 6 }, 1920, 1080);
    expect(line).toContain("color=0x00FF00@1.000:t=6:");
  });
  it("非法颜色/注入串被白名单拒绝为默认色", () => {
    const s = shapeDrawbox({ ...base, color: "red;drawtext=evil" }, 1920, 1080);
    expect(s).toContain("color=0xFFD400@");   // 默认黄
    expect(s).not.toContain("drawtext");
  });
  it("buildFilterGraph：shapes 在最终视频上 drawbox，且禁用快路径", () => {
    const seg: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 5, speed: 1 }];
    const g = buildFilterGraph(seg, OPTS, [], { shapes: [{ ...base, fill: true, color: "#3366FF" }] });
    expect(g.filterComplex).toContain("drawbox=");
    expect(g.filterComplex).toContain("[shp0]");
    expect(g.filterComplex).not.toContain("concat=n=1:v=1:a=1[outv][outa]"); // 快路径被禁用
  });
});

describe("画面镜像/翻转（hflip/vflip）", () => {
  it("主轨片段 flipH→hflip、flipV→vflip；无翻转不出现", () => {
    const h = buildFilterGraph([{ isImage: false, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1, flipH: true }], OPTS).filterComplex;
    expect(h).toContain("hflip");
    expect(h).not.toContain("vflip");
    const v = buildFilterGraph([{ isImage: true, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1, flipV: true }], OPTS).filterComplex;
    expect(v).toContain("vflip");
    expect(buildFilterGraph([{ isImage: false, hasAudio: false, trimIn: 0, trimOut: 2, speed: 1 }], OPTS).filterComplex).not.toContain("hflip");
  });
  it("叠加层 flipH 进入 overlay 链", () => {
    const seg: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 4, speed: 1 }];
    const g = buildFilterGraph(seg, OPTS, [{ isImage: true, trimIn: 0, trimOut: 2, speed: 1, start: 0, duration: 2, transform: { scale: 0.3 }, flipH: true }]).filterComplex;
    expect(g).toContain("format=rgba,hflip");
  });
});

describe("旋转 / 缩放 关键帧动画导出", () => {
  it("主轨旋转关键帧 → rotate=a='expr'（仅靠旋转也触发动画路径）", () => {
    const s = segmentZoomPanChain(undefined, [{ t: 0, rotation: 0 }, { t: 1, rotation: 90 }], 1280, 720).join(",");
    expect(s).toContain("rotate=a='if(lt(t,");
    expect(s).toContain("scale=w='1280*(");           // 动画链（缩放静态 1×，旋转动画）
    // 无旋转关键帧时仍是静态 rotate（或无）
    const s2 = segmentZoomPanChain({ rotation: 30 }, [{ t: 0, scale: 1 }, { t: 1, scale: 2 }], 1280, 720).join(",");
    expect(s2).toContain("rotate=0.52360:ow=iw:oh=ih"); // 30° 静态
  });
  it("叠加层 scale 关键帧 → scale=w='expr':h=-2:eval=frame（PiP 推拉）", () => {
    const seg: Segment[] = [{ isImage: false, hasAudio: true, trimIn: 0, trimOut: 4, speed: 1 }];
    const g = buildFilterGraph(seg, OPTS, [{ isImage: true, trimIn: 0, trimOut: 3, speed: 1, start: 0, duration: 3, transform: { scale: 0.3 }, keyframes: [{ t: 0, scale: 0.2 }, { t: 3, scale: 0.5 }] }]).filterComplex;
    expect(g).toContain("scale=w='if(lt(t,");
    expect(g).toContain(":h=-2:eval=frame");
    // 无 scale 关键帧 → 静态 scale=NNN:-2
    const g2 = buildFilterGraph(seg, OPTS, [{ isImage: true, trimIn: 0, trimOut: 3, speed: 1, start: 0, duration: 3, transform: { scale: 0.3 } }]).filterComplex;
    expect(g2).toContain("scale=576:-2");
  });
});

import { typewriterText } from "./_core/videoComposer";

describe("打字机字幕（typewriter，逐字 \\alpha 显现）", () => {
  it("typewriterText：每字一个 \\alpha+\\t 块，时刻递增；空串→空", () => {
    expect(typewriterText("", 5000)).toBe("");
    // 默认 ~16 字/秒 → 62.5ms/字（充裕时长不压缩）；第2字 round(62.5)=63
    expect(typewriterText("AB", 10000)).toBe("{\\alpha&HFF&\\t(0,1,\\alpha&H00&)}A{\\alpha&HFF&\\t(63,64,\\alpha&H00&)}B");
    // 显式速度 cps=10 → 100ms/字
    expect(typewriterText("AB", 10000, 10)).toBe("{\\alpha&HFF&\\t(0,1,\\alpha&H00&)}A{\\alpha&HFF&\\t(100,101,\\alpha&H00&)}B");
    // 短片段压缩节奏（5字、300ms → per=min(62.5, 270/5=54)=54；第5字 4*54=216）
    const s = typewriterText("ABCDE", 300);
    expect(s).toContain("\\t(0,1,");
    expect(s).toContain("\\t(216,217,");
    expect((s.match(/\\alpha&HFF&/g) || []).length).toBe(5);
  });
  it("buildEditorASS 用 typewriter 时正文走逐字块（且仍带定位/样式）", () => {
    const ass = buildEditorASS([{ start: 0, end: 2, text: { content: "你好", size: 60, motionStyle: "typewriter", align: "left" }, x: 0.1, y: 0.8 }], { width: 1920, height: 1080 });
    expect(ass).toContain("\\an7\\pos(192,864)");
    expect(ass).toContain("\\alpha&HFF&\\t(0,1,\\alpha&H00&)}你");
    expect(ass).not.toContain("\\fad"); // 打字机不淡入
  });
});
