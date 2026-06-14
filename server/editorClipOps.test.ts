import { describe, expect, it, beforeEach } from "vitest";
import { useEditorStore, clipDuration } from "../client/src/components/editor/editorStore";
import { emptyEditorDoc } from "../shared/editorTypes";

const st = () => useEditorStore.getState();
const clipsOf = (trackId: string) => st().doc!.tracks.find((t) => t.id === trackId)!.clips;

beforeEach(() => {
  st().load(emptyEditorDoc(1920, 1080, 30));
  // clipboard intentionally survives `load` (cross-session paste) — clear it
  // between tests so each starts from a known empty clipboard.
  useEditorStore.setState({ clipboard: null });
});

describe("copy / paste clip", () => {
  it("copies a clip then pastes a fresh, independent clip at the playhead on the same track type", () => {
    const id = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 3, transform: { scale: 0.5 } });
    st().copyClip(id);
    expect(st().clipboard).not.toBeNull();
    expect(st().clipboard!.trackType).toBe("video");

    st().setPlayhead(10);
    st().pasteClip(st().playhead);

    const clips = clipsOf("v1");
    expect(clips.length).toBe(2);
    const pasted = clips.find((c) => c.id !== id)!;
    expect(pasted.start).toBe(10);
    expect(pasted.id).not.toBe(id);                       // new id
    expect(pasted.transform?.scale).toBe(0.5);            // payload carried over
    expect(st().selectedClipId).toBe(pasted.id);          // selection follows the paste
  });

  it("paste is a no-op with an empty clipboard", () => {
    st().pasteClip(5);
    expect(clipsOf("v1").length).toBe(0);
  });

  it("pasted clip does not alias the original (deep clone)", () => {
    const id = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 3, transform: { scale: 1 } });
    st().copyClip(id);
    st().pasteClip(8);
    const pasted = clipsOf("v1").find((c) => c.id !== id)!;
    st().updateClip(pasted.id, { transform: { scale: 0.2 } });
    // original is untouched
    expect(clipsOf("v1").find((c) => c.id === id)!.transform?.scale).toBe(1);
  });
});

describe("ripple delete", () => {
  it("removes the clip and pulls later same-track clips left to close the gap", () => {
    const a = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2 }); // dur 2 → [0,2]
    const b = st().addClip("v1", { kind: "image", start: 2, trimIn: 0, trimOut: 2 }); // [2,4]
    const c = st().addClip("v1", { kind: "image", start: 4, trimIn: 0, trimOut: 2 }); // [4,6]
    const bDur = clipDuration(st().doc!.tracks[0].clips.find((x) => x.id === b)!);

    st().rippleDeleteClip(b);

    const clips = clipsOf("v1");
    expect(clips.length).toBe(2);
    expect(clips.find((x) => x.id === a)!.start).toBe(0);      // before — unchanged
    expect(clips.find((x) => x.id === c)!.start).toBe(4 - bDur); // after — pulled left by b's duration
  });

  it("clears the selection if the rippled clip was selected", () => {
    const id = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2 });
    st().selectClip(id);
    st().rippleDeleteClip(id);
    expect(st().selectedClipId).toBeNull();
  });
});

describe("split all at playhead", () => {
  it("cuts clips on every track that the playhead passes through", () => {
    st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 6 }); // [0,6]
    st().addClip("a1", { kind: "audio", start: 0, trimIn: 0, trimOut: 6, assetUrl: "x" }); // [0,6]
    st().splitAllAtPlayhead(3);
    expect(clipsOf("v1").length).toBe(2);
    expect(clipsOf("a1").length).toBe(2);
    // the right halves start exactly at the cut
    expect(clipsOf("v1").some((c) => Math.abs(c.start - 3) < 1e-6)).toBe(true);
  });

  it("leaves clips untouched when the playhead is outside them, and skips locked tracks", () => {
    st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2 }); // [0,2] — playhead 5 is outside
    const locked = st().doc!.tracks.find((t) => t.id === "ov1")!;
    st().updateTrack(locked.id, { locked: true });
    st().addClip("ov1", { kind: "image", start: 0, trimIn: 0, trimOut: 6 }); // would be cut, but track is locked
    const before = st().doc;
    st().splitAllAtPlayhead(5);
    // v1 clip ends at 2 (outside), ov1 is locked → nothing changes → same doc reference
    expect(st().doc).toBe(before);
  });
});
