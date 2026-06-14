import { describe, expect, it, beforeEach } from "vitest";
import { useEditorStore } from "../client/src/components/editor/editorStore";
import { emptyEditorDoc } from "../shared/editorTypes";

const st = () => useEditorStore.getState();
const clipsOf = (trackId: string) => st().doc!.tracks.find((t) => t.id === trackId)!.clips;

beforeEach(() => {
  st().load(emptyEditorDoc(1920, 1080, 30));
  useEditorStore.setState({ clipboard: null });
});

describe("selection model", () => {
  it("selectClip is single-select and mirrors the primary", () => {
    const a = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2 });
    const b = st().addClip("v1", { kind: "image", start: 2, trimIn: 0, trimOut: 2 });
    st().selectClip(a);
    expect(st().selectedClipIds).toEqual([a]);
    expect(st().selectedClipId).toBe(a);
    st().selectClip(b);
    expect(st().selectedClipIds).toEqual([b]);
    expect(st().selectedClipId).toBe(b);
  });

  it("toggleClipSelection adds and removes, keeping primary = last", () => {
    const a = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2 });
    const b = st().addClip("v1", { kind: "image", start: 2, trimIn: 0, trimOut: 2 });
    st().selectClip(a);
    st().toggleClipSelection(b);
    expect(st().selectedClipIds).toEqual([a, b]);
    expect(st().selectedClipId).toBe(b);
    st().toggleClipSelection(b);
    expect(st().selectedClipIds).toEqual([a]);
    expect(st().selectedClipId).toBe(a);
  });

  it("setSelection / clearSelection / selectedClips", () => {
    const a = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2 });
    const b = st().addClip("a1", { kind: "audio", start: 1, trimIn: 0, trimOut: 2, assetUrl: "x" });
    st().setSelection([a, b]);
    expect(st().selectedClips().map((c) => c.id).sort()).toEqual([a, b].sort());
    st().clearSelection();
    expect(st().selectedClipIds).toEqual([]);
    expect(st().selectedClipId).toBeNull();
  });

  it("selectAll selects every clip across tracks", () => {
    const a = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2 });
    const b = st().addClip("a1", { kind: "audio", start: 0, trimIn: 0, trimOut: 2, assetUrl: "x" });
    const c = st().addClip("t1", { kind: "text", start: 0, trimIn: 0, trimOut: 2, text: { content: "hi" } });
    st().selectAll();
    expect(st().selectedClipIds.sort()).toEqual([a, b, c].sort());
  });
});

describe("nudge selection", () => {
  it("nudgeSelected shifts every selected clip by the delta", () => {
    const a = st().addClip("v1", { kind: "image", start: 2, trimIn: 0, trimOut: 2 });
    const b = st().addClip("a1", { kind: "audio", start: 5, trimIn: 0, trimOut: 2, assetUrl: "x" });
    st().setSelection([a, b]);
    st().nudgeSelected(0.5);
    expect(clipsOf("v1").find((c) => c.id === a)!.start).toBeCloseTo(2.5, 6);
    expect(clipsOf("a1").find((c) => c.id === b)!.start).toBeCloseTo(5.5, 6);
  });

  it("nudgeSelected clamps so the earliest clip never goes below 0", () => {
    const a = st().addClip("v1", { kind: "image", start: 1, trimIn: 0, trimOut: 2 });
    const b = st().addClip("a1", { kind: "audio", start: 0.3, trimIn: 0, trimOut: 2, assetUrl: "x" }); // earliest
    st().setSelection([a, b]);
    st().nudgeSelected(-1); // wants -1 but earliest is 0.3 → clamp to -0.3
    expect(clipsOf("a1").find((c) => c.id === b)!.start).toBeCloseTo(0, 6);
    expect(clipsOf("v1").find((c) => c.id === a)!.start).toBeCloseTo(0.7, 6);
  });
});

describe("multi-clip ops", () => {
  it("removeSelected deletes the whole selection across tracks in one step", () => {
    const a = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2 });
    const b = st().addClip("a1", { kind: "audio", start: 0, trimIn: 0, trimOut: 2, assetUrl: "x" });
    st().addClip("v1", { kind: "image", start: 4, trimIn: 0, trimOut: 2 }); // survivor
    st().setSelection([a, b]);
    st().removeSelected();
    expect(clipsOf("v1").length).toBe(1);
    expect(clipsOf("a1").length).toBe(0);
    expect(st().selectedClipIds).toEqual([]);
  });

  it("duplicateSelected copies each selected clip and selects the copies", () => {
    const a = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2 });
    const b = st().addClip("v1", { kind: "image", start: 2, trimIn: 0, trimOut: 2 });
    st().setSelection([a, b]);
    st().duplicateSelected();
    expect(clipsOf("v1").length).toBe(4);
    expect(st().selectedClipIds.length).toBe(2);
    expect(st().selectedClipIds).not.toContain(a);
    expect(st().selectedClipIds).not.toContain(b);
  });

  it("moveSelectedTo shifts the whole group by the primary's delta", () => {
    const a = st().addClip("v1", { kind: "image", start: 2, trimIn: 0, trimOut: 2 }); // primary
    const b = st().addClip("a1", { kind: "audio", start: 5, trimIn: 0, trimOut: 2, assetUrl: "x" });
    st().setSelection([a, b]);
    st().moveSelectedTo(a, 6); // primary 2 -> 6, dx = +4
    expect(clipsOf("v1").find((c) => c.id === a)!.start).toBe(6);
    expect(clipsOf("a1").find((c) => c.id === b)!.start).toBe(9);
  });

  it("moveSelectedTo clamps so the earliest selected clip never goes below 0", () => {
    const a = st().addClip("v1", { kind: "image", start: 3, trimIn: 0, trimOut: 2 }); // primary
    const b = st().addClip("a1", { kind: "audio", start: 1, trimIn: 0, trimOut: 2, assetUrl: "x" }); // earliest
    st().setSelection([a, b]);
    st().moveSelectedTo(a, 0); // wants dx = -3, but b is at 1 → clamp dx to -1
    expect(clipsOf("a1").find((c) => c.id === b)!.start).toBe(0);
    expect(clipsOf("v1").find((c) => c.id === a)!.start).toBe(2);
  });
});

describe("arrange selection", () => {
  it("closeGapsSelected packs selected clips end-to-end from the earliest, per track", () => {
    const a = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2 }); // [0,2]
    const b = st().addClip("v1", { kind: "image", start: 5, trimIn: 0, trimOut: 2 }); // gap → should move to 2
    const c = st().addClip("v1", { kind: "image", start: 9, trimIn: 0, trimOut: 2 }); // → 4
    st().setSelection([a, b, c]);
    st().closeGapsSelected();
    const clips = clipsOf("v1");
    expect(clips.find((x) => x.id === a)!.start).toBe(0);
    expect(clips.find((x) => x.id === b)!.start).toBe(2);
    expect(clips.find((x) => x.id === c)!.start).toBe(4);
  });

  it("closeGapsSelected leaves unselected clips alone", () => {
    const a = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2 });
    const b = st().addClip("v1", { kind: "image", start: 5, trimIn: 0, trimOut: 2 });
    const other = st().addClip("v1", { kind: "image", start: 20, trimIn: 0, trimOut: 2 }); // not selected
    st().setSelection([a, b]);
    st().closeGapsSelected();
    expect(clipsOf("v1").find((x) => x.id === other)!.start).toBe(20);
  });

  it("alignSelectedStartTo shifts the group so its earliest clip lands on the time", () => {
    const a = st().addClip("v1", { kind: "image", start: 4, trimIn: 0, trimOut: 2 }); // earliest
    const b = st().addClip("a1", { kind: "audio", start: 7, trimIn: 0, trimOut: 2, assetUrl: "x" });
    st().setSelection([a, b]);
    st().alignSelectedStartTo(1); // earliest 4 → 1, dx = -3
    expect(clipsOf("v1").find((x) => x.id === a)!.start).toBe(1);
    expect(clipsOf("a1").find((x) => x.id === b)!.start).toBe(4);
  });
});

describe("bulk property edit", () => {
  it("updateSelected applies a scalar patch to every selected clip", () => {
    const a = st().addClip("v1", { kind: "video", start: 0, trimIn: 0, trimOut: 2, assetUrl: "x", volume: 1 });
    const b = st().addClip("a1", { kind: "audio", start: 0, trimIn: 0, trimOut: 2, assetUrl: "y", volume: 1 });
    const other = st().addClip("v1", { kind: "video", start: 5, trimIn: 0, trimOut: 2, assetUrl: "z", volume: 1 });
    st().setSelection([a, b]);
    st().updateSelected({ volume: 0.5 });
    expect(clipsOf("v1").find((c) => c.id === a)!.volume).toBe(0.5);
    expect(clipsOf("a1").find((c) => c.id === b)!.volume).toBe(0.5);
    expect(clipsOf("v1").find((c) => c.id === other)!.volume).toBe(1); // unselected untouched
  });

  it("updateSelected merges nested transform/effects per clip without wiping siblings", () => {
    const a = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2, transform: { scale: 0.5, opacity: 1 } });
    const b = st().addClip("v1", { kind: "image", start: 2, trimIn: 0, trimOut: 2, transform: { rotation: 30 } });
    st().setSelection([a, b]);
    st().updateSelected({ transform: { opacity: 0.3 } });
    const ca = clipsOf("v1").find((c) => c.id === a)!;
    const cb = clipsOf("v1").find((c) => c.id === b)!;
    expect(ca.transform!.opacity).toBe(0.3);
    expect(ca.transform!.scale).toBe(0.5);   // sibling field preserved
    expect(cb.transform!.opacity).toBe(0.3);
    expect(cb.transform!.rotation).toBe(30);  // sibling field preserved
  });
});

describe("multi copy / paste", () => {
  it("copySelected + pasteClip preserves relative offsets and re-targets by track type", () => {
    const a = st().addClip("v1", { kind: "image", start: 2, trimIn: 0, trimOut: 2 });
    const b = st().addClip("a1", { kind: "audio", start: 5, trimIn: 0, trimOut: 2, assetUrl: "x" }); // +3 vs earliest
    st().setSelection([a, b]);
    st().copySelected();
    expect(st().clipboard!.clips.length).toBe(2);

    st().pasteClip(10);
    // video paste at 10, audio paste at 13 (offset preserved)
    expect(clipsOf("v1").some((c) => c.id !== a && Math.abs(c.start - 10) < 1e-6)).toBe(true);
    expect(clipsOf("a1").some((c) => c.id !== b && Math.abs(c.start - 13) < 1e-6)).toBe(true);
    expect(st().selectedClipIds.length).toBe(2); // the pasted pair
  });
});

describe("selection survives history", () => {
  it("undo prunes selection ids that no longer exist", () => {
    const a = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2 });
    st().selectClip(a);
    st().undo(); // removes the add → clip a gone
    expect(st().selectedClipIds).toEqual([]);
    expect(st().selectedClipId).toBeNull();
  });
});
