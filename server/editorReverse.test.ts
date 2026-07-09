import { describe, expect, it } from "vitest";
import { clipSplitTrims, trimRightSource, canMergeClips, mergeClips } from "../client/src/components/editor/editorStore";
import { sourceTimeAt, type Clip } from "../shared/editorTypes";

// A reverse video clip: source [2,8], speed 1, played backwards → timeline [0,6] shows
// source 8→2. These tests lock in that split/merge/trim map to the SWAPPED source side
// for reverse (the same class as sliceEditorDoc's reverse fix).
const base = (over: Partial<Clip> = {}): Clip => ({
  id: "r", kind: "video", assetUrl: "x", start: 0, trimIn: 2, trimOut: 8, speed: 1, reverse: true, ...over,
} as Clip);

describe("reverse clip split", () => {
  it("cuts at the swapped source point and keeps the correct trim ends", () => {
    const c = base();
    const { left, right } = clipSplitTrims(c, 2); // 2s into the clip
    // cut source = trimOut - offset*speed = 8 - 2 = 6
    expect(left).toEqual({ trimIn: 6 });   // left keeps trimOut=8, plays 8→6
    expect(right).toEqual({ trimOut: 6 }); // right keeps trimIn=2, plays 6→2
  });

  it("produces halves that are continuous at the cut (sourceTimeAt matches)", () => {
    const c = base();
    const { left: lp, right: rp } = clipSplitTrims(c, 2);
    const left: Clip = { ...c, ...lp };
    const right: Clip = { ...c, id: "r2", start: 2, ...rp };
    // left's end and right's start must land on the same source frame (6)
    expect(sourceTimeAt(left, 2)).toBeCloseTo(6, 6);
    expect(sourceTimeAt(right, 2)).toBeCloseTo(6, 6);
    // endpoints unchanged: left starts at source 8, right ends at source 2
    expect(sourceTimeAt(left, 0)).toBeCloseTo(8, 6);
    expect(sourceTimeAt(right, 6)).toBeCloseTo(2, 6);
  });

  it("merges the split halves back into the original clip", () => {
    const c = base();
    const { left: lp, right: rp } = clipSplitTrims(c, 2);
    const left: Clip = { ...c, ...lp };
    const right: Clip = { ...c, id: "r2", start: 2, ...rp };
    expect(canMergeClips(left, right)).toBe(true);
    const merged = mergeClips(left, right);
    expect(merged.trimIn).toBe(2);   // extended back down to b's in-point
    expect(merged.trimOut).toBe(8);  // a's out-point preserved
    expect(merged.reverse).toBe(true);
  });

  it("does NOT merge a forward-contiguous pair as if reverse (guards the swapped check)", () => {
    // Two reverse clips whose FORWARD contiguity holds (b.trimIn≈a.trimOut) but reverse
    // contiguity (a.trimIn≈b.trimOut) does not → must be rejected.
    const a = base({ trimIn: 2, trimOut: 5 });
    const b = base({ id: "b", start: clipDur(a), trimIn: 5, trimOut: 9 });
    expect(canMergeClips(a, b)).toBe(false);
  });
});

describe("reverse clip trim-right source", () => {
  it("shrinks the trimIn side (not trimOut) when the right edge is trimmed", () => {
    const c = base(); // source [2,8], newDur 4 → keep trimOut=8, trimIn = 8 - 4 = 4
    expect(trimRightSource(c, 4)).toEqual({ trimIn: 4 });
  });
  it("forward clips still trim the trimOut side", () => {
    const c = base({ reverse: false });
    expect(trimRightSource(c, 4)).toEqual({ trimOut: 6 }); // trimIn 2 + 4
  });
});

function clipDur(c: Clip): number {
  return Math.max(0.05, (c.trimOut - c.trimIn) / (c.speed ?? 1));
}
