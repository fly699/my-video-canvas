import { describe, it, expect } from "vitest";
import { buildClipVideoFilters, buildClipAudioFilters, type ClipEdit } from "./_core/videoEditor";

const dur = 10; // trimmed clip duration (seconds)

describe("buildClipVideoFilters", () => {
  it("returns nothing for a neutral edit at 1x speed", () => {
    expect(buildClipVideoFilters({}, 1, dur)).toEqual([]);
  });

  it("orders reverse → rotate → flip → crop → eq → setpts → fade", () => {
    const o: ClipEdit = { reverse: true, rotate: 90, flipH: true, aspect: "1:1", brightness: 0.2, fadeIn: 1, fadeOut: 2 };
    const f = buildClipVideoFilters(o, 2, dur);
    expect(f[0]).toBe("reverse");
    expect(f[1]).toBe("transpose=1");
    expect(f[2]).toBe("hflip");
    expect(f[3]).toMatch(/^crop=/);
    expect(f.find((x) => x.startsWith("eq="))).toMatch(/brightness=0.200/);
    expect(f.find((x) => x.startsWith("setpts="))).toBe("setpts=0.500000*PTS");
    expect(f).toContain("fade=t=in:st=0:d=1.000");
    // fade-out anchored at clipDuration - fadeOut
    expect(f).toContain("fade=t=out:st=8.000:d=2.000");
  });

  it("180° rotation uses a double transpose", () => {
    expect(buildClipVideoFilters({ rotate: 180 }, 1, dur)).toEqual(["transpose=2,transpose=2"]);
  });

  it("crops to the requested aspect ratio with even dimensions", () => {
    const f = buildClipVideoFilters({ aspect: "9:16" }, 1, dur);
    expect(f[0]).toContain("crop=");
    expect(f[0]).toContain("0.562500"); // 9/16
  });

  it("omits eq when all picture values are neutral", () => {
    expect(buildClipVideoFilters({ brightness: 0, contrast: 1, saturation: 1 }, 1, dur)).toEqual([]);
  });
});

describe("buildClipAudioFilters", () => {
  it("is empty for neutral original audio at 1x", () => {
    expect(buildClipAudioFilters({}, 1, dur, 1.0, true)).toEqual([]);
  });

  it("applies areverse + volume + atempo + afade for the source track", () => {
    const f = buildClipAudioFilters({ reverse: true, fadeIn: 1, fadeOut: 2 }, 2, dur, 0.5, true);
    expect(f[0]).toBe("areverse");
    expect(f).toContain("volume=0.5000");
    expect(f.some((x) => x.startsWith("atempo="))).toBe(true);
    expect(f).toContain("afade=t=in:st=0:d=1.000");
    expect(f).toContain("afade=t=out:st=8.000:d=2.000");
  });

  it("does NOT time-stretch or reverse an external track (applySpeed=false)", () => {
    const f = buildClipAudioFilters({ reverse: true }, 2, dur, 0.8, false);
    expect(f).not.toContain("areverse");
    expect(f.some((x) => x.startsWith("atempo="))).toBe(false);
    expect(f).toContain("volume=0.8000");
  });
});
