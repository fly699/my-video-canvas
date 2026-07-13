import { describe, it, expect } from "vitest";
import { buildAnimaticDoc, mapAnimaticTransition, kenBurnsKeyframes, animaticShotSeconds, animaticTotalSeconds } from "./animatic";

// #137 一键动态样片：镜头序列 → EditorDoc 组装的纯函数语义。
// 渲染端（composeTimeline / buildFilterGraph 的 image+keyframes+transition 段）
// 已有既有测试与 ffmpeg 真机回归覆盖，这里只锁组装口径。

describe("mapAnimaticTransition（与装配端 mapShotTransition 同口径）", () => {
  it("cut / match-cut / 未设 = 硬切；fade/dissolve 原样；wipe → wipeleft", () => {
    expect(mapAnimaticTransition("cut")).toBe("none");
    expect(mapAnimaticTransition("match-cut")).toBe("none");
    expect(mapAnimaticTransition(undefined)).toBe("none");
    expect(mapAnimaticTransition("fade")).toBe("fade");
    expect(mapAnimaticTransition("dissolve")).toBe("dissolve");
    expect(mapAnimaticTransition("wipe")).toBe("wipeleft");
  });
});

describe("animaticShotSeconds", () => {
  it("缺省 3s；1..30 夹取", () => {
    expect(animaticShotSeconds(undefined)).toBe(3);
    expect(animaticShotSeconds(0)).toBe(3);
    expect(animaticShotSeconds(-2)).toBe(3);
    expect(animaticShotSeconds(0.4)).toBe(1);
    expect(animaticShotSeconds(99)).toBe(30);
    expect(animaticShotSeconds(5)).toBe(5);
  });
});

describe("kenBurnsKeyframes", () => {
  it("偶数镜推近、奇数镜拉远，首帧 smoothstep 缓动", () => {
    const a = kenBurnsKeyframes(0, 4);
    expect(a[0]).toMatchObject({ t: 0, scale: 1, ease: "inout" });
    expect(a[1]).toMatchObject({ t: 4, scale: 1.08 });
    const b = kenBurnsKeyframes(1, 4);
    expect(b[0].scale).toBe(1.08);
    expect(b[1].scale).toBe(1);
  });
});

describe("buildAnimaticDoc", () => {
  const shots = [
    { imageUrl: "https://x/1.png", duration: 4, transition: "dissolve" },
    { imageUrl: "https://x/2.png", duration: 2, transition: "cut", voiceUrl: "https://x/v2.mp3", voiceDuration: 5 },
    { imageUrl: "https://x/3.png" }, // 缺省 3s
  ];

  it("视频轨首尾相接：start 累加、image 片段 trimOut=显示秒数、fit=cover", () => {
    const doc = buildAnimaticDoc(shots);
    const v = doc.tracks.find((t) => t.type === "video")!.clips;
    expect(v).toHaveLength(3);
    expect(v.map((c) => c.start)).toEqual([0, 4, 6]);
    expect(v.map((c) => c.trimOut)).toEqual([4, 2, 3]);
    expect(v.every((c) => c.kind === "image" && c.fit === "cover" && c.trimIn === 0)).toBe(true);
    expect(animaticTotalSeconds(shots)).toBe(9);
  });

  it("转场取「前一镜」的 transition：首镜无 transitionIn；dissolve 落到第 2 镜；cut 不产生 transitionIn", () => {
    const doc = buildAnimaticDoc(shots);
    const v = doc.tracks.find((t) => t.type === "video")!.clips;
    expect(v[0].transitionIn).toBeUndefined();
    expect(v[1].transitionIn?.type).toBe("dissolve");
    expect(v[2].transitionIn).toBeUndefined(); // 前镜 transition=cut → 硬切
  });

  it("转场时长受两侧镜长约束（≤0.4s 且 ≤短侧镜长 45%）", () => {
    const doc = buildAnimaticDoc([
      { imageUrl: "u1", duration: 10, transition: "fade" },
      { imageUrl: "u2", duration: 0.5 }, // 夹取到 1s → 0.45 上限仍 > 0.4 → 0.4
    ]);
    const v = doc.tracks.find((t) => t.type === "video")!.clips;
    expect(v[1].transitionIn?.duration).toBeLessThanOrEqual(0.4);
    expect(v[1].transitionIn?.duration).toBeGreaterThanOrEqual(0.1);
  });

  it("配音与镜起点对位，超镜长裁断", () => {
    const doc = buildAnimaticDoc(shots);
    const a = doc.tracks.find((t) => t.type === "audio")!.clips;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "audio", assetUrl: "https://x/v2.mp3", start: 4 });
    expect(a[0].trimOut).toBe(2); // voiceDuration 5s > 镜长 2s → 裁到 2s
  });

  it("Ken-Burns 默认开启（每镜 keyframes 交替推拉），kenBurns:false 时关闭", () => {
    const on = buildAnimaticDoc(shots);
    const vOn = on.tracks.find((t) => t.type === "video")!.clips;
    expect(vOn[0].keyframes?.[1].scale).toBe(1.08);
    expect(vOn[1].keyframes?.[0].scale).toBe(1.08);
    const off = buildAnimaticDoc(shots, { kenBurns: false });
    expect(off.tracks.find((t) => t.type === "video")!.clips.every((c) => !c.keyframes)).toBe(true);
  });

  it("画布参数：默认 1280×720@30，可覆盖（竖屏 720×1280）", () => {
    expect(buildAnimaticDoc(shots)).toMatchObject({ width: 1280, height: 720, fps: 30 });
    expect(buildAnimaticDoc(shots, { width: 720, height: 1280 })).toMatchObject({ width: 720, height: 1280 });
  });
});
