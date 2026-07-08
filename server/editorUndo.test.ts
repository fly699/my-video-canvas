import { describe, expect, it, beforeEach, vi } from "vitest";
import { useEditorStore } from "../client/src/components/editor/editorStore";
import { emptyEditorDoc } from "../shared/editorTypes";

const st = () => useEditorStore.getState();
const v1Clips = () => st().doc!.tracks.find((t) => t.id === "v1")!.clips;

beforeEach(() => {
  st().load(emptyEditorDoc(1920, 1080, 30));
});

describe("editor undo/redo", () => {
  it("records, undoes and redoes a clip add", () => {
    expect(st().past.length).toBe(0);
    st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 3 });
    expect(v1Clips().length).toBe(1);
    expect(st().past.length).toBe(1);
    expect(st().future.length).toBe(0);

    st().undo();
    expect(v1Clips().length).toBe(0);
    expect(st().future.length).toBe(1);

    st().redo();
    expect(v1Clips().length).toBe(1);
    expect(st().future.length).toBe(0);
  });

  it("clears the redo stack when a new edit happens after undo", () => {
    const id = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 3 });
    st().undo();
    expect(st().future.length).toBe(1);
    st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 2 });
    expect(st().future.length).toBe(0); // future discarded by the new branch
    void id;
  });

  it("coalesces a rapid burst into one step but separates spaced edits", () => {
    let now = 1000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const id = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 3 }); // push pre-add
      now = 1100; st().updateClip(id, { start: 1 }); // <450ms → coalesce
      now = 1200; st().updateClip(id, { start: 2 }); // coalesce
      expect(st().past.length).toBe(1);

      now = 2000; st().updateClip(id, { start: 5 }); // >450ms → new step (snapshots start=2)
      expect(st().past.length).toBe(2);
      expect(v1Clips()[0].start).toBe(5);

      st().undo(); // back to the start=2 snapshot
      expect(v1Clips()[0].start).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("#89 破坏性操作(删除)不与紧邻的连续编辑(滑块)合并成同一撤销步", () => {
    let now = 1000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const id = st().addClip("v1", { kind: "video", start: 0, trimIn: 0, trimOut: 3 });
      now = 5000; st().updateClip(id, { volume: 0.5 }); // 距上次>450ms → 独立步（音量微调）
      const afterSlider = st().past.length;
      now = 5100; st().removeClip(id);                  // <450ms，但删除是破坏性操作 → 仍独立步
      expect(st().past.length).toBe(afterSlider + 1);   // 不与滑块合并
      expect(st().doc!.tracks.find((t) => t.id === "v1")!.clips.length).toBe(0);

      st().undo(); // 只回退删除 → 片段回来，音量仍是 0.5（未被一并回退）
      const clips = st().doc!.tracks.find((t) => t.id === "v1")!.clips;
      expect(clips.length).toBe(1);
      expect(clips[0].volume).toBe(0.5);
    } finally {
      spy.mockRestore();
    }
  });

  it("drops a stale selection after undo removes the clip", () => {
    const id = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 3 });
    expect(st().selectedClipId).toBe(id);
    st().undo();
    expect(st().selectedClipId).toBeNull();
  });
});
