import { describe, expect, it } from "vitest";
import { sliceEditorDoc, emptyEditorDoc, clipVisibleDuration } from "../shared/editorTypes";

const docWith = (clips: { id: string; kind: "video" | "image" | "audio" | "text"; start: number; trimIn: number; trimOut: number; speed?: number }[]) => {
  const d = emptyEditorDoc(1920, 1080, 30);
  for (const c of clips) d.tracks[0].clips.push({ ...c, assetUrl: c.kind === "text" ? undefined : "x", text: c.kind === "text" ? { content: "hi" } : undefined } as never);
  return d;
};
const v1 = (d: ReturnType<typeof docWith>) => d.tracks.find((t) => t.id === "v1")!.clips;

describe("sliceEditorDoc (export range)", () => {
  it("drops clips fully outside the range and keeps inside ones (shifted to 0)", () => {
    const d = docWith([
      { id: "a", kind: "image", start: 0, trimIn: 0, trimOut: 2 },  // [0,2] before
      { id: "b", kind: "image", start: 4, trimIn: 0, trimOut: 3 },  // [4,7] inside [4,9]
      { id: "c", kind: "image", start: 10, trimIn: 0, trimOut: 2 }, // [10,12] after
    ]);
    const out = sliceEditorDoc(d, 4, 9);
    const clips = v1(out);
    expect(clips.map((c) => c.id)).toEqual(["b"]);
    expect(clips[0].start).toBe(0); // shifted: was at 4, range starts at 4
  });

  it("trims a video clip crossing the left boundary back into source time", () => {
    // video [2,10] (trimIn 1, trimOut 9, speed 1, dur 8). slice [5,10] → cut 3s off left
    const d = docWith([{ id: "v", kind: "video", start: 2, trimIn: 1, trimOut: 9 }]);
    const out = sliceEditorDoc(d, 5, 10);
    const c = v1(out)[0];
    expect(c.start).toBe(0);          // 5 → 0
    expect(c.trimIn).toBe(1 + 3);     // 3s into the clip (speed 1) → source +3
    expect(c.trimOut).toBe(9);        // right edge unchanged (clip ends at 10 = range end)
  });

  it("trims an image clip crossing the right boundary by shortening its duration", () => {
    // image [0,6] (dur 6). slice [0,4] → image should display 4s
    const d = docWith([{ id: "img", kind: "image", start: 0, trimIn: 0, trimOut: 6 }]);
    const out = sliceEditorDoc(d, 0, 4);
    const c = v1(out)[0];
    expect(c.start).toBe(0);
    expect(c.trimIn).toBe(0);
    expect(clipVisibleDuration(c)).toBeCloseTo(4, 6);
  });

  it("respects speed when mapping a left-boundary cut to source time", () => {
    // video at 2x: trimIn 0, trimOut 8, speed 2 → visible dur 4, [0,4]. slice [1,4] → cut 1s timeline
    const d = docWith([{ id: "v", kind: "video", start: 0, trimIn: 0, trimOut: 8, speed: 2 }]);
    const out = sliceEditorDoc(d, 1, 4);
    const c = v1(out)[0];
    expect(c.start).toBe(0);
    expect(c.trimIn).toBe(0 + 1 * 2); // 1 timeline-sec × speed 2 = 2 source-secs
  });

  it("clamps a negative or inverted range", () => {
    const d = docWith([{ id: "a", kind: "image", start: 0, trimIn: 0, trimOut: 5 }]);
    const out = sliceEditorDoc(d, 9, 2); // inverted → [2,9]
    expect(v1(out)[0]).toBeTruthy();
    expect(clipVisibleDuration(v1(out)[0])).toBeCloseTo(3, 6); // [2,5] of the clip
  });
});
