import { describe, it, expect } from "vitest";
import { JOINT_GROUPS, ALL_JOINT_KEYS, POSE_PRESETS, applyPosePreset } from "./directorPose";

describe("directorPose", () => {
  it("预设里出现的关节都是合法关节 key（rootY 为整体升降，非关节，允许）", () => {
    const valid = new Set([...ALL_JOINT_KEYS, "rootY"]);
    for (const p of POSE_PRESETS) {
      for (const k of Object.keys(p.pose)) {
        expect(valid.has(k), `预设 ${p.key} 含未知关节 ${k}`).toBe(true);
      }
    }
  });

  it("低姿势含整体下沉 rootY（脚贴地）", () => {
    for (const key of ["sit", "crouch", "kneel"]) {
      expect(applyPosePreset(key).rootY, key).toBeLessThan(0);
    }
    expect(applyPosePreset("stand").rootY).toBe(0);
  });

  it("applyPosePreset 归一化：所有关节显式赋值（未列的归 0，清掉上个姿势残留）", () => {
    const pose = applyPosePreset("tpose");
    expect(Object.keys(pose).sort()).toEqual([...ALL_JOINT_KEYS, "rootY"].sort());
    expect(pose.armLOut).toBe(78);
    expect(pose.torsoForward).toBe(0); // 未列 → 归零
  });

  it("站立预设全 0；未知预设 → 全 0", () => {
    expect(Object.values(applyPosePreset("stand")).every((v) => v === 0)).toBe(true);
    expect(Object.values(applyPosePreset("nope")).every((v) => v === 0)).toBe(true);
  });

  it("每个关节定义 min < max", () => {
    for (const g of JOINT_GROUPS) for (const j of g.joints) expect(j.min).toBeLessThan(j.max);
  });
});
