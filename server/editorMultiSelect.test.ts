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
