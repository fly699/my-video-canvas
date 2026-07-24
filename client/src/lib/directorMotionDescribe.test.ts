// #341 批9：运镜轨迹 → 中文运镜描述。与 presetMoveToKeyframes 互为镜像：
// 12 预设生成的真轨迹（经 timelineToExportData 逐帧采样）必须被分类回其本义。
import { describe, it, expect } from "vitest";
import type { DirectorScene, DirectorTimeline, Vec3 } from "../../../shared/types";
import { presetMoveToKeyframes, timelineToExportData, type CameraPreset } from "./directorTimeline";
import { describeCameraTrack, describeMotionExport } from "./directorMotionDescribe";

const scene: DirectorScene = {
  actors: [],
  camera: { id: "camA", name: "机位1", position: [0, 1.5, 4], target: [0, 1, 0], fov: 50 },
  cameras: [
    { id: "camA", name: "机位1", position: [0, 1.5, 4], target: [0, 1, 0], fov: 50 },
    { id: "camB", name: "机位2", position: [4, 1.5, 0], target: [0, 1, 0], fov: 35 },
  ],
  aspectRatio: "16:9", background: "", groundVisible: true, labelsVisible: true,
};

/** 用预设生成 camA 轨道 → 导出逐帧采样 → 取第一条相机轨迹描述。 */
function describePreset(preset: CameraPreset, duration = 4): string {
  const channels = presetMoveToKeyframes(
    preset,
    { position: [0, 1.5, 4], target: [0, 1, 0], fov: 50 },
    { duration },
  );
  const timeline: DirectorTimeline = {
    duration, fps: 10,
    tracks: [{ targetId: "camA", targetKind: "camera", channels }],
  };
  const data = timelineToExportData(timeline, scene);
  return describeCameraTrack(data.camera[0].keyframes);
}

describe("describeCameraTrack：12 预设语义还原", () => {
  it("dollyIn → 推近", () => expect(describePreset("dollyIn")).toContain("推近"));
  it("dollyOut → 拉远", () => expect(describePreset("dollyOut")).toContain("拉远"));
  it("orbit → 360° 环绕", () => expect(describePreset("orbit")).toContain("360° 环绕"));
  it("arc → 弧线（~180°）", () => {
    const d = describePreset("arc");
    expect(d).toContain("弧线");
    expect(d).toMatch(/1[5-9]\d°/); // ≈180°
  });
  it("crane → 升高", () => expect(describePreset("crane")).toContain("升高"));
  it("truck → 横移", () => expect(describePreset("truck")).toContain("横移"));
  it("spiral → 环绕 + 升高", () => {
    const d = describePreset("spiral");
    expect(d).toContain("环绕");
    expect(d).toContain("升高");
  });
  it("handheld → 手持", () => expect(describePreset("handheld")).toContain("手持"));
  it("whipPan → 甩镜", () => expect(describePreset("whipPan")).toContain("甩镜"));
  it("dollyZoom → 变焦推（希区柯克）", () => expect(describePreset("dollyZoom")).toContain("变焦推"));
  it("follow → 跟拍", () => expect(describePreset("follow")).toContain("跟拍"));
  it("dive → 下降 + 推近", () => {
    const d = describePreset("dive");
    expect(d).toContain("下降");
    expect(d).toContain("推近");
  });
});

describe("describeCameraTrack：边界", () => {
  it("空/单帧 → 固定机位", () => {
    expect(describeCameraTrack([])).toBe("固定机位");
    expect(describeCameraTrack([{ t: 0, position: [0, 1, 4] as Vec3, target: [0, 1, 0] as Vec3, fov: 50 }])).toBe("固定机位");
  });
  it("全程静止 → 固定机位", () => {
    const kf = { position: [0, 1, 4] as Vec3, target: [0, 1, 0] as Vec3, fov: 50 };
    expect(describeCameraTrack([{ t: 0, ...kf }, { t: 1, ...kf }, { t: 2, ...kf }])).toBe("固定机位");
  });
});

describe("describeMotionExport：整体提示词", () => {
  it("含时长、机位名映射与运镜描述", () => {
    const channels = presetMoveToKeyframes("dollyIn", { position: [0, 1.5, 4], target: [0, 1, 0], fov: 50 }, { duration: 4 });
    const timeline: DirectorTimeline = { duration: 4, fps: 10, tracks: [{ targetId: "camA", targetKind: "camera", channels }] };
    const text = describeMotionExport(timelineToExportData(timeline, scene), { camA: "主机位" });
    expect(text).toContain("总时长 4s");
    expect(text).toContain("主机位");
    expect(text).toContain("推近");
  });
  it("有多机位节目流 → 附切点表（机位名替换）", () => {
    const timeline: DirectorTimeline = {
      duration: 2, fps: 2, tracks: [],
      shotSequence: [
        { cameraId: "camA", start: 0, end: 1 },
        { cameraId: "camB", start: 1, end: 2 },
      ],
    };
    const text = describeMotionExport(timelineToExportData(timeline, scene), { camA: "机位1", camB: "机位2" });
    expect(text).toContain("多机位剪辑");
    expect(text).toContain("机位1");
    expect(text).toContain("机位2");
    expect(text).toContain("硬切");
  });
  it("无相机轨道且无序列 → 固定机位", () => {
    const timeline: DirectorTimeline = { duration: 2, fps: 2, tracks: [] };
    expect(describeMotionExport(timelineToExportData(timeline, scene))).toContain("固定机位");
  });
});
