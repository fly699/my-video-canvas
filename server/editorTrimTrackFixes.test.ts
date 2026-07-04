import { describe, expect, it, beforeEach } from "vitest";
import { useEditorStore, rebaseKeyframesForLeftTrim } from "../client/src/components/editor/editorStore";
import { emptyEditorDoc, sourceTimeAt, type Clip } from "../shared/editorTypes";

const st = () => useEditorStore.getState();
const clipsOf = (trackId: string) => st().doc!.tracks.find((t) => t.id === trackId)!.clips;
const mk = (over: Partial<Clip>): Clip => ({ id: "c", kind: "image", start: 0, trimIn: 0, trimOut: 10, ...over });

beforeEach(() => { st().load(emptyEditorDoc(1920, 1080, 30)); });

describe("rebaseKeyframesForLeftTrim（左裁重基准，纯函数）", () => {
  const kfs = [{ t: 0, scale: 1 }, { t: 4, scale: 2 }, { t: 8, scale: 1 }];
  it("裁进（shift>0）：丢掉裁掉段、其余按新起点重基准（含边界）", () => {
    expect(rebaseKeyframesForLeftTrim(kfs, 3)).toEqual([{ t: 1, scale: 2 }, { t: 5, scale: 1 }]);
  });
  it("向左扩展（shift<0）：整体右移、全部保留", () => {
    expect(rebaseKeyframesForLeftTrim(kfs, -2)).toEqual([{ t: 2, scale: 1 }, { t: 6, scale: 2 }, { t: 10, scale: 1 }]);
  });
  it("无位移 / 空关键帧 → 原样", () => {
    expect(rebaseKeyframesForLeftTrim(kfs, 0)).toBe(kfs);
    expect(rebaseKeyframesForLeftTrim(undefined, 3)).toBeUndefined();
  });
});

describe("trimClip 左裁：同步重基准关键帧（回归）", () => {
  it("左边缘裁进 → 关键帧随片段起点重基准、裁掉部分丢弃", () => {
    const id = st().addClip("v1", { kind: "video", start: 2, trimIn: 0, trimOut: 10, keyframes: [{ t: 0, scale: 1 }, { t: 4, scale: 2 }, { t: 8, scale: 1 }] });
    st().trimClip(id, { trimIn: 3, start: 5 }); // 左缘 2→5，shift=3
    const c = clipsOf("v1").find((x) => x.id === id)!;
    expect(c.start).toBe(5);
    expect(c.trimIn).toBe(3);
    expect(c.keyframes).toEqual([{ t: 1, scale: 2 }, { t: 5, scale: 1 }]);
  });
  it("右裁（只改 trimOut）不动关键帧（不是左裁）", () => {
    const id = st().addClip("v1", { kind: "video", start: 0, trimIn: 0, trimOut: 10, keyframes: [{ t: 0, scale: 1 }, { t: 4, scale: 2 }] });
    st().trimClip(id, { trimOut: 6 });
    expect(clipsOf("v1").find((x) => x.id === id)!.keyframes).toEqual([{ t: 0, scale: 1 }, { t: 4, scale: 2 }]);
  });
});

describe("removeTrack：从 selectedClipIds 剔除删掉轨道的片段（回归）", () => {
  it("删掉某轨后，存活选中片段保留且获得 primary，悬空 id 被剔除", () => {
    const x = st().addClip("v1", { kind: "image", start: 0, trimIn: 0, trimOut: 3 });
    const y = st().addClip("ov1", { kind: "image", start: 0, trimIn: 0, trimOut: 3 });
    st().setSelection([x, y]);
    st().removeTrack("ov1"); // y 所在轨被删
    expect(st().selectedClipIds).toEqual([x]); // 悬空的 y 被剔除
    expect(st().selectedClipId).toBe(x);       // 存活的 x 成为 primary（不再是 null）
  });
});

describe("sourceTimeAt：时间轴时间 → 源媒体时间（含倒放）", () => {
  it("正放：trimIn + 偏移×速度", () => {
    expect(sourceTimeAt(mk({ start: 0, trimIn: 1, trimOut: 10, speed: 2 }), 3)).toBe(7); // 1 + 3*2
  });
  it("倒放：从 trimOut 往回走", () => {
    const c = mk({ start: 0, trimIn: 0, trimOut: 10, reverse: true });
    expect(sourceTimeAt(c, 0)).toBe(10); // 片头显示源结尾
    expect(sourceTimeAt(c, 2)).toBe(8);
  });
});
