// #327 导演台动画层批1：时间线纯函数单测（缓动/插值/样条/合成/预设/导出）。
import { describe, it, expect } from "vitest";
import {
  LINEAR,
  EASING_PRESETS,
  bezierEase,
  sampleKeyframes,
  sampleChannel,
  samplePath,
  pathTangent,
  lookAtEuler,
  sampleTransformAt,
  addKeyframe,
  removeKeyframeAt,
  moveKeyframe,
  scaleKeyframes,
  retimeTimeline,
  presetMoveToKeyframes,
  applyPreset,
  timelineToExportData,
  makeDefaultTimeline,
  makeTrack,
  timelineTicks,
  trackKeyframeTimes,
  fmtTime,
} from "./directorTimeline";
import type {
  DirectorChannel,
  DirectorKeyframe,
  DirectorPath,
  DirectorScene,
  DirectorTimeline,
  DirectorTrack,
  Vec3,
} from "../../../shared/types";

const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;
const nearVec = (a: Vec3, b: Vec3, eps = 1e-3) =>
  near(a[0], b[0], eps) && near(a[1], b[1], eps) && near(a[2], b[2], eps);

// ── bezierEase ──────────────────────────────────────────────────────────────
describe("bezierEase", () => {
  it("线性缓动 = 恒等", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(near(bezierEase(t, LINEAR), t)).toBe(true);
  });
  it("端点恒为 0/1（任意缓动）", () => {
    expect(near(bezierEase(0, EASING_PRESETS.easeInOut), 0)).toBe(true);
    expect(near(bezierEase(1, EASING_PRESETS.easeInOut), 1)).toBe(true);
  });
  it("ease-in 前段慢（输出 < 输入）", () => {
    expect(bezierEase(0.5, EASING_PRESETS.easeIn)).toBeLessThan(0.5);
  });
  it("ease-out 前段快（输出 > 输入）", () => {
    expect(bezierEase(0.5, EASING_PRESETS.easeOut)).toBeGreaterThan(0.5);
  });
  it("easeInOut 中点 = 0.5（对称）", () => {
    expect(near(bezierEase(0.5, EASING_PRESETS.easeInOut), 0.5, 1e-3)).toBe(true);
  });
  it("输入越界被夹取到 [0,1]", () => {
    expect(near(bezierEase(-1, LINEAR), 0)).toBe(true);
    expect(near(bezierEase(2, LINEAR), 1)).toBe(true);
  });
});

// ── sampleKeyframes / sampleChannel ─────────────────────────────────────────
describe("sampleKeyframes", () => {
  const kfs: DirectorKeyframe[] = [
    { time: 0, value: 0 },
    { time: 2, value: 10 },
  ];
  it("无帧 → null；单帧 → 该值", () => {
    expect(sampleKeyframes([], 1)).toBeNull();
    expect(sampleKeyframes([{ time: 5, value: 7 }], 1)).toBe(7);
  });
  it("端点夹取（早于首帧/晚于末帧）", () => {
    expect(sampleKeyframes(kfs, -1)).toBe(0);
    expect(sampleKeyframes(kfs, 99)).toBe(10);
  });
  it("线性段中点插值", () => {
    expect(near(sampleKeyframes(kfs, 1)!, 5)).toBe(true);
  });
  it("段缓动生效（easeIn 段中点 < 线性中点）", () => {
    const eased: DirectorKeyframe[] = [
      { time: 0, value: 0, easing: EASING_PRESETS.easeIn },
      { time: 2, value: 10 },
    ];
    expect(sampleKeyframes(eased, 1)!).toBeLessThan(5);
  });
  it("三帧序列分段正确", () => {
    const three: DirectorKeyframe[] = [
      { time: 0, value: 0 },
      { time: 1, value: 4 },
      { time: 3, value: 4 },
    ];
    expect(near(sampleKeyframes(three, 0.5)!, 2)).toBe(true); // 第一段中点
    expect(near(sampleKeyframes(three, 2)!, 4)).toBe(true); // 第二段常值
  });
  it("sampleChannel 包裹 keyframes", () => {
    const ch: DirectorChannel = { prop: "fov", keyframes: kfs };
    expect(near(sampleChannel(ch, 1)!, 5)).toBe(true);
  });
});

// ── samplePath / pathTangent ────────────────────────────────────────────────
describe("samplePath", () => {
  it("linear 两点：端点与中点", () => {
    const p: DirectorPath = { points: [[0, 0, 0], [10, 0, 0]], kind: "linear", orient: "free" };
    expect(nearVec(samplePath(p, 0), [0, 0, 0])).toBe(true);
    expect(nearVec(samplePath(p, 1), [10, 0, 0])).toBe(true);
    expect(nearVec(samplePath(p, 0.5), [5, 0, 0])).toBe(true);
  });
  it("linear 三点：段映射（u=0.5 落在第二段起点）", () => {
    const p: DirectorPath = { points: [[0, 0, 0], [10, 0, 0], [10, 10, 0]], kind: "linear", orient: "free" };
    expect(nearVec(samplePath(p, 0.5), [10, 0, 0])).toBe(true);
    expect(nearVec(samplePath(p, 0.75), [10, 5, 0])).toBe(true);
  });
  it("catmullrom 过控制点（端点、内部点）", () => {
    const p: DirectorPath = {
      points: [[0, 0, 0], [1, 2, 0], [2, 0, 0], [3, 2, 0]],
      kind: "catmullrom",
      orient: "free",
    };
    expect(nearVec(samplePath(p, 0), [0, 0, 0])).toBe(true);
    expect(nearVec(samplePath(p, 1), [3, 2, 0])).toBe(true);
    // u=1/3 恰好第二个控制点
    expect(nearVec(samplePath(p, 1 / 3), [1, 2, 0], 1e-2)).toBe(true);
  });
  it("bezier 折线段：起终点为锚点", () => {
    const p: DirectorPath = {
      points: [[0, 0, 0], [0, 5, 0], [10, 5, 0], [10, 0, 0]],
      kind: "bezier",
      orient: "free",
    };
    expect(nearVec(samplePath(p, 0), [0, 0, 0])).toBe(true);
    expect(nearVec(samplePath(p, 1), [10, 0, 0])).toBe(true);
    // 对称控制 → 中点 x=5
    expect(near(samplePath(p, 0.5)[0], 5)).toBe(true);
  });
  it("空/单点回退", () => {
    expect(nearVec(samplePath({ points: [], kind: "linear", orient: "free" }, 0.5), [0, 0, 0])).toBe(true);
    expect(nearVec(samplePath({ points: [[3, 3, 3]], kind: "linear", orient: "free" }, 0.5), [3, 3, 3])).toBe(true);
  });
  it("pathTangent linear 沿 +X → [1,0,0]", () => {
    const p: DirectorPath = { points: [[0, 0, 0], [10, 0, 0]], kind: "linear", orient: "free" };
    expect(nearVec(pathTangent(p, 0.5), [1, 0, 0])).toBe(true);
  });
  it("closed catmullrom 环路：u=0 与 u=1 同点", () => {
    const p: DirectorPath = {
      points: [[0, 0, 0], [5, 0, 0], [5, 0, 5], [0, 0, 5]],
      kind: "catmullrom",
      orient: "free",
      closed: true,
    };
    expect(nearVec(samplePath(p, 0), samplePath(p, 1), 1e-2)).toBe(true);
  });
});

// ── lookAtEuler ─────────────────────────────────────────────────────────────
describe("lookAtEuler", () => {
  it("看向 +Z：yaw=0", () => {
    const e = lookAtEuler([0, 0, 0], [0, 0, 5]);
    expect(near(e[1], 0)).toBe(true);
    expect(near(e[0], 0)).toBe(true);
  });
  it("看向 +X：yaw=90°", () => {
    expect(near(lookAtEuler([0, 0, 0], [5, 0, 0])[1], 90)).toBe(true);
  });
  it("看向上方：pitch 正", () => {
    expect(lookAtEuler([0, 0, 0], [0, 5, 5])[0]).toBeGreaterThan(0);
  });
});

// ── sampleTransformAt ───────────────────────────────────────────────────────
describe("sampleTransformAt", () => {
  it("无通道 → 回退 base", () => {
    const track = makeTrack("a", "actor");
    const s = sampleTransformAt(track, 1, { position: [1, 2, 3], rotation: [0, 45, 0], scale: 2, fov: 35 });
    expect(nearVec(s.position, [1, 2, 3])).toBe(true);
    expect(near(s.rotation[1], 45)).toBe(true);
    expect(near(s.scale, 2)).toBe(true);
    expect(near(s.fov, 35)).toBe(true);
  });
  it("position 通道覆盖对应轴，缺轴回退 base", () => {
    const track: DirectorTrack = {
      targetId: "a",
      targetKind: "actor",
      channels: [{ prop: "position", axis: "x", keyframes: [{ time: 0, value: 0 }, { time: 2, value: 8 }] }],
    };
    const s = sampleTransformAt(track, 1, { position: [0, 5, 5] });
    expect(near(s.position[0], 4)).toBe(true); // 通道插值
    expect(near(s.position[1], 5)).toBe(true); // 回退 base
    expect(near(s.position[2], 5)).toBe(true);
  });
  it("fov / uniformScale 标量通道", () => {
    const track: DirectorTrack = {
      targetId: "cam",
      targetKind: "camera",
      channels: [
        { prop: "fov", keyframes: [{ time: 0, value: 50 }, { time: 2, value: 30 }] },
        { prop: "uniformScale", keyframes: [{ time: 0, value: 1 }, { time: 2, value: 3 }] },
      ],
    };
    const s = sampleTransformAt(track, 1, { position: [0, 0, 0] });
    expect(near(s.fov, 40)).toBe(true);
    expect(near(s.scale, 2)).toBe(true);
  });
  it("path 驱动 position（span 映射时间）", () => {
    const track: DirectorTrack = {
      targetId: "a",
      targetKind: "actor",
      path: { points: [[0, 0, 0], [10, 0, 0]], kind: "linear", orient: "free" },
      channels: [],
      clip: { start: 0, end: 4 },
    };
    expect(nearVec(sampleTransformAt(track, 0, { position: [9, 9, 9] }).position, [0, 0, 0])).toBe(true);
    expect(nearVec(sampleTransformAt(track, 2, { position: [9, 9, 9] }).position, [5, 0, 0])).toBe(true);
    expect(nearVec(sampleTransformAt(track, 4, { position: [9, 9, 9] }).position, [10, 0, 0])).toBe(true);
  });
  it("path orient=velocity → yaw 跟切线（+X 段 yaw=90°）", () => {
    const track: DirectorTrack = {
      targetId: "a",
      targetKind: "actor",
      path: { points: [[0, 0, 0], [10, 0, 0]], kind: "linear", orient: "velocity" },
      channels: [],
      clip: { start: 0, end: 2 },
    };
    expect(near(sampleTransformAt(track, 1, { position: [0, 0, 0] }).rotation[1], 90)).toBe(true);
  });
  it("path orient=lookAt + lookAtPos → 朝向目标", () => {
    const track: DirectorTrack = {
      targetId: "cam",
      targetKind: "camera",
      path: { points: [[0, 0, 0], [0, 0, 10]], kind: "linear", orient: "lookAt", lookAtId: "hero" },
      channels: [],
      clip: { start: 0, end: 2 },
    };
    const s = sampleTransformAt(track, 0, { position: [0, 0, 0] }, { lookAtPos: [5, 0, 0] });
    expect(near(s.rotation[1], 90)).toBe(true); // 起点在原点，看向 +X
  });
});

// ── 关键帧编辑 ──────────────────────────────────────────────────────────────
describe("关键帧编辑纯函数", () => {
  const base: DirectorKeyframe[] = [
    { time: 0, value: 0 },
    { time: 2, value: 10 },
  ];
  it("addKeyframe 插入并保持升序", () => {
    const r = addKeyframe(base, { time: 1, value: 5 });
    expect(r.map((k) => k.time)).toEqual([0, 1, 2]);
    expect(r).not.toBe(base); // 不可变
  });
  it("addKeyframe 同 time 替换 value", () => {
    const r = addKeyframe(base, { time: 2, value: 99 });
    expect(r.length).toBe(2);
    expect(r.find((k) => k.time === 2)!.value).toBe(99);
  });
  it("removeKeyframeAt 删除目标帧", () => {
    expect(removeKeyframeAt(base, 2).map((k) => k.time)).toEqual([0]);
    expect(removeKeyframeAt(base, 5).length).toBe(2); // 无匹配不变
  });
  it("moveKeyframe 移动并重排（含负时间夹到 0）", () => {
    const r = moveKeyframe(base, 0, 3);
    expect(r.map((k) => k.time)).toEqual([2, 3]);
    expect(moveKeyframe(base, 2, -5).map((k) => k.time)).toEqual([0]); // 2→0 与原 0 合并
  });
  it("scaleKeyframes 缩放时间", () => {
    expect(scaleKeyframes(base, 2).map((k) => k.time)).toEqual([0, 4]);
  });
});

describe("retimeTimeline", () => {
  it("整条时间线按比例重定时（关键帧 + clip）", () => {
    const tl: DirectorTimeline = {
      duration: 10,
      fps: 30,
      tracks: [
        {
          targetId: "a",
          targetKind: "actor",
          clip: { start: 2, end: 8 },
          channels: [{ prop: "position", axis: "x", keyframes: [{ time: 0, value: 0 }, { time: 10, value: 5 }] }],
        },
      ],
    };
    const r = retimeTimeline(tl, 5); // 减半
    expect(r.duration).toBe(5);
    expect(r.tracks[0].channels[0].keyframes.map((k) => k.time)).toEqual([0, 5]);
    expect(r.tracks[0].clip).toEqual({ start: 1, end: 4 });
  });
});

// ── 运镜预设 ────────────────────────────────────────────────────────────────
describe("presetMoveToKeyframes", () => {
  const base = { position: [0, 1.5, 4] as Vec3, target: [0, 1.5, 0] as Vec3 };
  it("orbit：起点回到出发位、半径保持、含 x/y/z 三通道", () => {
    const chs = presetMoveToKeyframes("orbit", base, { duration: 4, steps: 24 });
    expect(chs.map((c) => c.axis).sort()).toEqual(["x", "y", "z"]);
    const cx = chs.find((c) => c.axis === "x")!;
    const cz = chs.find((c) => c.axis === "z")!;
    // 首帧在出发点附近
    expect(near(cx.keyframes[0].value, 0, 1e-2)).toBe(true);
    expect(near(cz.keyframes[0].value, 4, 1e-2)).toBe(true);
    // 环绕中所有采样点到 target 的水平半径恒为 4
    for (let i = 0; i < cx.keyframes.length; i++) {
      const r = Math.hypot(cx.keyframes[i].value - 0, cz.keyframes[i].value - 0);
      expect(near(r, 4, 1e-2)).toBe(true);
    }
  });
  it("dollyIn：末帧比起点更靠近 target", () => {
    const chs = presetMoveToKeyframes("dollyIn", base, { duration: 2 });
    const cz = chs.find((c) => c.axis === "z")!;
    const startZ = cz.keyframes[0].value;
    const endZ = cz.keyframes[cz.keyframes.length - 1].value;
    expect(Math.abs(endZ)).toBeLessThan(Math.abs(startZ)); // 更靠近 z=0
  });
  it("dollyOut：末帧比起点更远离 target", () => {
    const chs = presetMoveToKeyframes("dollyOut", base, { duration: 2 });
    const cz = chs.find((c) => c.axis === "z")!;
    expect(Math.abs(cz.keyframes[cz.keyframes.length - 1].value)).toBeGreaterThan(4);
  });
  it("crane：仅 y 抬升", () => {
    const chs = presetMoveToKeyframes("crane", base, { duration: 2, amount: 2 });
    const cy = chs.find((c) => c.axis === "y")!;
    expect(near(cy.keyframes[cy.keyframes.length - 1].value - cy.keyframes[0].value, 2)).toBe(true);
  });
  it("truck：水平横移（x 变化，y 不变）", () => {
    const chs = presetMoveToKeyframes("truck", base, { duration: 2, amount: 3 });
    const cx = chs.find((c) => c.axis === "x")!;
    const cy = chs.find((c) => c.axis === "y")!;
    expect(near(Math.abs(cx.keyframes[1].value - cx.keyframes[0].value), 3)).toBe(true);
    expect(near(cy.keyframes[1].value - cy.keyframes[0].value, 0)).toBe(true);
  });
  it("spiral：环绕同时 y 上升", () => {
    const chs = presetMoveToKeyframes("spiral", base, { duration: 4, steps: 12, amount: 3 });
    const cy = chs.find((c) => c.axis === "y")!;
    expect(cy.keyframes[cy.keyframes.length - 1].value).toBeGreaterThan(cy.keyframes[0].value);
  });
});

describe("applyPreset", () => {
  const track: DirectorTrack = {
    targetId: "cam",
    targetKind: "camera",
    channels: [{ prop: "position", axis: "x", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1 }] }],
  };
  const preset = presetMoveToKeyframes("crane", { position: [0, 0, 4], target: [0, 0, 0] }, { duration: 2 });
  it("replace：覆盖同 prop/axis 通道", () => {
    const r = applyPreset(track, preset, "replace");
    const cx = r.channels.filter((c) => c.prop === "position" && c.axis === "x");
    expect(cx.length).toBe(1); // 未重复
    // 预设首帧时间 0（未后移）
    expect(cx[0].keyframes[0].time).toBe(0);
  });
  it("append：接到现有末帧之后", () => {
    const r = applyPreset(track, preset, "append");
    const cx = r.channels.find((c) => c.prop === "position" && c.axis === "x")!;
    // 原末帧 t=1，预设帧时间应 ≥1
    expect(Math.min(...cx.keyframes.slice(2).map((k) => k.time))).toBeGreaterThanOrEqual(1);
    expect(cx.keyframes.length).toBeGreaterThan(2);
  });
});

// ── 导出 ────────────────────────────────────────────────────────────────────
describe("timelineToExportData", () => {
  const scene: DirectorScene = {
    actors: [{ id: "hero", name: "主角", model: "male", position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: "#fff" }],
    camera: { id: "cam1", name: "机位1", position: [0, 1.5, 4], target: [0, 1, 0], fov: 50 },
    cameras: [{ id: "cam1", name: "机位1", position: [0, 1.5, 4], target: [0, 1, 0], fov: 50 }],
    aspectRatio: "16:9",
    background: "",
    groundVisible: true,
    labelsVisible: true,
  };
  const timeline: DirectorTimeline = {
    duration: 2,
    fps: 2, // 小帧率便于断言：frames=4 → 5 个时间点
    tracks: [
      {
        targetId: "cam1",
        targetKind: "camera",
        channels: [{ prop: "fov", keyframes: [{ time: 0, value: 50 }, { time: 2, value: 30 }] }],
      },
      {
        targetId: "hero",
        targetKind: "actor",
        channels: [{ prop: "position", axis: "x", keyframes: [{ time: 0, value: 0 }, { time: 2, value: 4 }] }],
      },
    ],
  };
  it("采样帧数 = round(duration*fps)+1，含首尾", () => {
    const data = timelineToExportData(timeline, scene);
    expect(data.camera[0].keyframes.length).toBe(5);
    expect(data.actors[0].keyframes.length).toBe(5);
    expect(data.camera[0].keyframes[0].t).toBe(0);
    expect(near(data.camera[0].keyframes[4].t, 2)).toBe(true);
  });
  it("相机 fov 动画正确采样", () => {
    const data = timelineToExportData(timeline, scene);
    const mid = data.camera[0].keyframes[2]; // t=1
    expect(near(mid.fov, 40)).toBe(true);
    expect(nearVec(mid.target, [0, 1, 0])).toBe(true); // focus 回退 base target
  });
  it("角色 position.x 动画 + 缺轴回退", () => {
    const data = timelineToExportData(timeline, scene);
    const mid = data.actors[0].keyframes[2]; // t=1
    expect(near(mid.position[0], 2)).toBe(true);
    expect(near(mid.position[1], 0)).toBe(true);
    expect(near(mid.scale, 1)).toBe(true);
  });
  it("scene 缺该 actor → 跳过该轨道", () => {
    const tl2: DirectorTimeline = { ...timeline, tracks: [{ targetId: "ghost", targetKind: "actor", channels: [] }] };
    expect(timelineToExportData(tl2, scene).actors.length).toBe(0);
  });
});

// ── 工厂 ────────────────────────────────────────────────────────────────────
describe("工厂", () => {
  it("makeDefaultTimeline：10s/30fps/空轨道", () => {
    const t = makeDefaultTimeline();
    expect(t.duration).toBe(10);
    expect(t.fps).toBe(30);
    expect(t.tracks).toEqual([]);
  });
  it("makeTrack：空通道轨道", () => {
    const t = makeTrack("x", "prop");
    expect(t.targetKind).toBe("prop");
    expect(t.channels).toEqual([]);
  });
});

// ── 时间线 UI 辅助（批2）────────────────────────────────────────────────────
describe("timelineTicks", () => {
  it("首刻度 0、末刻度=duration", () => {
    const t = timelineTicks(10, 60);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBe(10);
  });
  it("像素密度大 → 步长细（相邻主刻度 ≥minPx）", () => {
    const t = timelineTicks(10, 200, 64); // 200px/s → 0.5s 步长满足 ≥64px
    expect(t).toContain(0.5);
  });
  it("像素密度小 → 步长粗", () => {
    const t = timelineTicks(60, 10, 64); // 10px/s → 需 ≥6.4s → 步长 10s
    expect(t).toContain(10);
    expect(t).not.toContain(0.5);
  });
  it("退化输入安全", () => {
    expect(timelineTicks(0, 60)).toEqual([0]);
    expect(timelineTicks(10, 0)).toEqual([0]);
  });
});

describe("trackKeyframeTimes", () => {
  it("聚合所有通道关键帧时间、去重升序", () => {
    const track: DirectorTrack = {
      targetId: "a", targetKind: "actor",
      channels: [
        { prop: "position", axis: "x", keyframes: [{ time: 0, value: 0 }, { time: 2, value: 1 }] },
        { prop: "position", axis: "y", keyframes: [{ time: 2, value: 0 }, { time: 4, value: 1 }] },
      ],
    };
    expect(trackKeyframeTimes(track)).toEqual([0, 2, 4]); // 2 去重
  });
  it("空轨道 → []", () => {
    expect(trackKeyframeTimes(makeTrack("x", "prop"))).toEqual([]);
  });
});

describe("fmtTime", () => {
  it("mm:ss.d 格式", () => {
    expect(fmtTime(7.49)).toBe("0:07.5");
    expect(fmtTime(65)).toBe("1:05.0");
    expect(fmtTime(0)).toBe("0:00.0");
    expect(fmtTime(-3)).toBe("0:00.0"); // 负数夹到 0
  });
});
