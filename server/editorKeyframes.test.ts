import { describe, expect, it, beforeEach, vi } from "vitest";
import { transformAt, emptyEditorDoc, type Clip } from "../shared/editorTypes";
import { useEditorStore } from "../client/src/components/editor/editorStore";

const mk = (over: Partial<Clip>): Clip => ({ id: "c", kind: "image", start: 0, trimIn: 0, trimOut: 10, ...over });

describe("transformAt interpolation", () => {
  it("returns the base transform when there are no keyframes", () => {
    const c = mk({ transform: { x: 0.2, scale: 0.5 } });
    expect(transformAt(c, 3)).toEqual({ x: 0.2, scale: 0.5 });
  });

  it("linearly interpolates a field between keyframes and clamps outside", () => {
    const c = mk({ transform: { x: 0 }, keyframes: [{ t: 0, x: 0 }, { t: 2, x: 1 }] });
    expect(transformAt(c, 0).x).toBe(0);
    expect(transformAt(c, 1).x).toBeCloseTo(0.5, 5);
    expect(transformAt(c, 2).x).toBe(1);
    expect(transformAt(c, 5).x).toBe(1);   // clamp after last
    expect(transformAt(c, -1).x).toBe(0);  // clamp before first
  });

  it("interpolates each field independently", () => {
    const c = mk({ keyframes: [{ t: 0, scale: 1, opacity: 1 }, { t: 4, scale: 2, opacity: 0 }] });
    const at2 = transformAt(c, 2);
    expect(at2.scale).toBeCloseTo(1.5, 5);
    expect(at2.opacity).toBeCloseTo(0.5, 5);
  });
});

describe("editor keyframe store ops", () => {
  const st = () => useEditorStore.getState();
  const v1 = () => st().doc!.tracks.find((t) => t.id === "v1")!.clips[0];
  beforeEach(() => { st().load(emptyEditorDoc()); });

  it("adds a keyframe snapshotting the current transform, dedupes by time, removes", () => {
    const id = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 5, transform: { scale: 0.5, x: 0.1 } });
    st().addKeyframe(id, 0);
    expect(v1().keyframes).toHaveLength(1);
    expect(v1().keyframes![0]).toMatchObject({ t: 0, scale: 0.5, x: 0.1 });
    st().addKeyframe(id, 2);
    expect(v1().keyframes).toHaveLength(2);
    st().addKeyframe(id, 2.0); // same instant → replaces, not duplicates
    expect(v1().keyframes).toHaveLength(2);
    st().removeKeyframe(id, 0);
    expect(v1().keyframes).toHaveLength(1);
    st().clearKeyframes(id);
    expect(v1().keyframes).toBeUndefined();
  });

  it("keyframe ops are undoable", () => {
    let now = 1000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const id = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 5, transform: { scale: 1 } });
      now = 2000; // separate undo step (beyond the coalesce window)
      st().addKeyframe(id, 1);
      expect(v1().keyframes).toHaveLength(1);
      st().undo(); // reverts only the keyframe add — the clip remains
      expect(v1()).toBeDefined();
      expect(v1().keyframes).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("setKeyframeField (#88 有关键帧时写入播放头处的关键帧)", () => {
  const st = () => useEditorStore.getState();
  const clip = () => st().doc!.tracks.find((t) => t.id === "v1")!.clips.find((c) => c.id === "c1")!;
  beforeEach(() => {
    const doc = emptyEditorDoc(1920, 1080, 30);
    doc.tracks.find((t) => t.id === "v1")!.clips.push({
      id: "c1", kind: "image", start: 0, trimIn: 0, trimOut: 4,
      keyframes: [{ t: 0, x: 0, scale: 1 }, { t: 2, x: 1, scale: 2 }],
    });
    st().load(doc);
  });
  it("命中已存在关键帧则改其字段", () => {
    st().setKeyframeField("c1", 0, "x", 0.5);
    expect(clip().keyframes!.find((k) => k.t === 0)!.x).toBe(0.5);
    expect(clip().keyframes!.length).toBe(2); // 不新增
  });
  it("播放头不在关键帧上则以当前插值姿态为底新建一帧再改", () => {
    st().setKeyframeField("c1", 1, "scale", 3); // t=1 无关键帧
    const kf = clip().keyframes!.find((k) => Math.abs(k.t - 1) < 0.06)!;
    expect(kf).toBeTruthy();
    expect(kf.scale).toBe(3);            // 显式设的
    expect(kf.x).toBeCloseTo(0.5, 5);    // 插值姿态：t=1 在 x:0→1 之间 = 0.5
    expect(clip().keyframes!.length).toBe(3);
  });
});
