import { describe, it, expect } from "vitest";
import {
  aspectRatioValue, makeActor, makeDefaultDirectorScene, mannequinModel, nextActorName, MANNEQUIN_MODELS,
  makeCrowd, bakeGroupTransform, ensureCameras, nextCameraName, respaceCrowdMembers, cloneGroupWithMembers, makeGroupFromActors, CROWD_SPACING,
  actorWorldPosition, shotAimTarget, faceCameraYaw,
} from "./directorScene";
import type { DirectorActor, DirectorGroup } from "../../../shared/types";

describe("directorScene helpers", () => {
  it("aspectRatioValue 解析常见画幅（含小数 2.35:1），非法回退 16:9", () => {
    expect(aspectRatioValue("16:9")).toBeCloseTo(16 / 9, 4);
    expect(aspectRatioValue("9:16")).toBeCloseTo(9 / 16, 4);
    expect(aspectRatioValue("2.35:1")).toBeCloseTo(2.35, 4);
    expect(aspectRatioValue("1:1")).toBe(1);
    expect(aspectRatioValue("garbage")).toBeCloseTo(16 / 9, 4);
    expect(aspectRatioValue("0:0")).toBeCloseTo(16 / 9, 4);
  });

  it("mannequinModel 未知 key 回退首个体型", () => {
    expect(mannequinModel("male").key).toBe("male");
    expect(mannequinModel("nope").key).toBe(MANNEQUIN_MODELS[0].key);
  });

  it("nextActorName 按 A/B/C… 顺序避开已用名", () => {
    const existing: DirectorActor[] = [];
    const n1 = nextActorName(existing); // 角色A
    expect(n1).toBe("角色A");
    const withA = [{ name: "角色A" } as DirectorActor];
    expect(nextActorName(withA)).toBe("角色B");
  });

  it("makeActor 生成唯一 id、递进命名与配色，落在地面", () => {
    const a = makeActor("female", []);
    expect(a.model).toBe("female");
    expect(a.name).toBe("角色A");
    expect(a.position).toEqual([0, 0, 0]);
    expect(a.scale).toBe(1);
    const b = makeActor("male", [a]);
    expect(b.name).toBe("角色B");
    expect(b.id).not.toBe(a.id);
    expect(b.color).not.toBe(a.color); // 调色板递进
  });

  it("makeCrowd：rows×cols 个成员，居中网格，统一 groupId 与配色", () => {
    const { group, actors } = makeCrowd(3, 4, []);
    expect(group.rows).toBe(3);
    expect(group.cols).toBe(4);
    expect(group.name).toBe("群众 (4x3)");
    expect(actors).toHaveLength(12);
    expect(actors.every((a) => a.groupId === group.id)).toBe(true);
    // 网格关于原点对称：x 偏移之和≈0
    const sumX = actors.reduce((s, a) => s + a.position[0], 0);
    expect(Math.abs(sumX)).toBeLessThan(1e-9);
  });

  it("makeCrowd 默认间距 = CROWD_SPACING，相邻成员列间距精确", () => {
    const { group, actors } = makeCrowd(1, 3, []);
    expect(group.spacing).toBe(CROWD_SPACING);
    // 1×3：x = -spacing, 0, +spacing
    expect(actors[1].position[0] - actors[0].position[0]).toBeCloseTo(CROWD_SPACING, 6);
    expect(actors[2].position[0] - actors[1].position[0]).toBeCloseTo(CROWD_SPACING, 6);
  });

  it("respaceCrowdMembers：改间距重排局部坐标，保留个体姿势/体型/朝向", () => {
    const { group, actors } = makeCrowd(2, 3, []);
    const tagged = actors.map((a, i) => ({ ...a, pose: { headNod: i }, model: i % 3 === 0 ? "burly" : a.model }));
    const respaced = respaceCrowdMembers(group, tagged, 1.5);
    // 列间距变为 1.5
    expect(respaced[1].position[0] - respaced[0].position[0]).toBeCloseTo(1.5, 6);
    // 行间距变为 1.5（第二行第一个 index=3）
    expect(respaced[3].position[2] - respaced[0].position[2]).toBeCloseTo(1.5, 6);
    // 居中：x 偏移之和≈0
    expect(Math.abs(respaced.reduce((s, a) => s + a.position[0], 0))).toBeLessThan(1e-9);
    // 个体属性保留
    expect(respaced[2].pose).toEqual({ headNod: 2 });
    expect(respaced[3].model).toBe("burly");
    expect(respaced.every((a) => a.groupId === group.id)).toBe(true);
  });

  it("cloneGroupWithMembers：整组复制连成员体型/姿势/局部坐标，新 id/名/右移", () => {
    const { group, actors } = makeCrowd(1, 2, []);
    const withPose = actors.map((a) => ({ ...a, pose: { armROut: 90 } }));
    const { group: ng, actors: na } = cloneGroupWithMembers(group, withPose, withPose);
    expect(ng.id).not.toBe(group.id);
    expect(ng.name).toBe(`${group.name} 副本`);
    expect(ng.position[0]).toBeCloseTo(group.position[0] + 1.5, 6);
    expect(na).toHaveLength(2);
    expect(na.every((a) => a.groupId === ng.id)).toBe(true);
    expect(na[0].id).not.toBe(withPose[0].id);
    expect(na[0].pose).toEqual({ armROut: 90 });
    expect(na[0].position).toEqual(withPose[0].position); // 局部坐标保留
  });

  it("makeGroupFromActors：任意角色手动编组，组心=水平质心，成员局部=世界−质心，标记 manual", () => {
    const a = makeActor("male", []); a.position = [2, 0, 0];
    const b = makeActor("female", [a]); b.position = [-2, 0, 4];
    const { group, actors } = makeGroupFromActors([a, b]);
    expect(group.manual).toBe(true);
    expect(group.name).toBe("编组 (2)");
    // 质心 = ((2-2)/2, , (0+4)/2) = (0, , 2)
    expect(group.position[0]).toBeCloseTo(0, 6);
    expect(group.position[2]).toBeCloseTo(2, 6);
    expect(actors.every((m) => m.groupId === group.id)).toBe(true);
    // 局部坐标 = 世界 − 质心；组变换(组心) + 局部 还原回世界
    expect(group.position[0] + actors[0].position[0]).toBeCloseTo(2, 6);
    expect(group.position[2] + actors[0].position[2]).toBeCloseTo(0, 6);
    expect(group.position[2] + actors[1].position[2]).toBeCloseTo(4, 6);
    // 保留 Y 高度与个体属性
    expect(actors[0].position[1]).toBe(0);
    expect(actors[0].model).toBe("male");
  });

  it("makeGroupFromActors → bakeGroupTransform 往返还原世界坐标（编组再解组不漂移）", () => {
    const a = makeActor("male", []); a.position = [3, 0, -1];
    const b = makeActor("female", [a]); b.position = [1, 0, 5];
    const { group, actors } = makeGroupFromActors([a, b]);
    const baked = actors.map((m) => bakeGroupTransform(group, m));
    expect(baked[0].position[0]).toBeCloseTo(3, 6);
    expect(baked[0].position[2]).toBeCloseTo(-1, 6);
    expect(baked[1].position[0]).toBeCloseTo(1, 6);
    expect(baked[1].position[2]).toBeCloseTo(5, 6);
    expect(baked[0].groupId).toBeUndefined();
  });

  it("bakeGroupTransform：解组把组变换烘焙进成员世界坐标（平移+缩放+绕Y）", () => {
    const { group, actors } = makeCrowd(1, 2, []);
    const g = { ...group, position: [10, 0, 5] as [number, number, number], scale: 2, rotation: [0, 0, 0] as [number, number, number] };
    const baked = bakeGroupTransform(g, actors[0]);
    expect(baked.groupId).toBeUndefined();
    // 局部 x = -0.425（2 列居中），×scale2 ×… + 平移 10
    expect(baked.position[0]).toBeCloseTo(10 + actors[0].position[0] * 2, 4);
    expect(baked.position[2]).toBeCloseTo(5 + actors[0].position[2] * 2, 4);
    expect(baked.scale).toBe(actors[0].scale * 2);
  });

  it("ensureCameras：旧单机位场景迁移出一个命名「机位1」", () => {
    const legacy = { ...makeDefaultDirectorScene(), cameras: undefined, activeCameraId: undefined };
    const cams = ensureCameras(legacy);
    expect(cams).toHaveLength(1);
    expect(cams[0].name).toBe("机位1");
    expect(cams[0].id).toBeTruthy();
    expect(cams[0].fov).toBe(legacy.camera.fov);
  });

  it("nextCameraName 顺延机位N，避开已用名", () => {
    expect(nextCameraName([{ name: "机位1" } as never])).toBe("机位2");
    expect(nextCameraName([{ name: "机位1" } as never, { name: "机位2" } as never])).toBe("机位3");
  });

  it("默认场景含命名机位列表 + activeCameraId", () => {
    const s = makeDefaultDirectorScene();
    expect(s.cameras).toHaveLength(1);
    expect(s.activeCameraId).toBe(s.cameras![0].id);
    expect(s.camera).toBe(s.cameras![0]); // 镜像同一对象
  });

  it("makeDefaultDirectorScene：1 个角色 + 50° 机位 + 16:9 + 显示地面", () => {
    const s = makeDefaultDirectorScene();
    expect(s.actors).toHaveLength(1);
    expect(s.camera.fov).toBe(50);
    expect(s.aspectRatio).toBe("16:9");
    expect(s.groundVisible).toBe(true);
    expect(s.camera.position).toHaveLength(3);
  });
});

describe("取景/朝向几何（注视/景别/面向机位）", () => {
  const actor = (over: Partial<DirectorActor>): DirectorActor => ({ id: "a", name: "A", model: "male", position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: "#fff", ...over });

  describe("actorWorldPosition", () => {
    it("独立角色 = 自身 position", () => {
      expect(actorWorldPosition(actor({ position: [2, 0, -1] }), [])).toEqual([2, 0, -1]);
    });
    it("组内成员：叠加群组 90° Y 旋转 + 平移", () => {
      const g: DirectorGroup = { id: "g", name: "g", rows: 1, cols: 1, position: [5, 0, 0], rotation: [0, 90, 0], scale: 1, color: "#fff" };
      const a = actor({ groupId: "g", position: [1, 0, 0] }); // 局部 +X
      const w = actorWorldPosition(a, [g]);
      // 绕 Y 90°：局部 +X → 世界 +X*cos90 - ... 按约定 x'=x cos + z sin, z'=-x sin + z cos → (0,0,-1)，+群心(5,0,0)
      expect(w[0]).toBeCloseTo(5, 4);
      expect(w[2]).toBeCloseTo(-1, 4);
    });
  });

  describe("shotAimTarget", () => {
    it("场景缩放+平移作用于脚点，胸高偏移再 × 角色缩放", () => {
      const t = shotAimTarget([0, 0, 0], { sceneScale: 2, offsetX: 1, offsetY: -3, offsetZ: 0.5, actorScale: 5, aimY: 1.0 });
      expect(t).toEqual([1, -3 + 1.0 * 2 * 5, 0.5]); // y = oy + 0 + aimY*S*actorScale = -3+10 = 7
    });
    it("默认（无缩放/偏移/角色缩放）退化为脚点上方 aimY", () => {
      expect(shotAimTarget([2, 0, -1], { aimY: 1.2 })).toEqual([2, 1.2, -1]);
    });
  });

  describe("faceCameraYaw", () => {
    it("独立角色：正对 +Z 方向的机位 → yaw 0", () => {
      expect(faceCameraYaw(0, 0, 0, 4, 0)).toBeCloseTo(0, 4);
    });
    it("组内成员：扣除群组 90° yaw（渲染会叠加），机位在 +Z → 局部 yaw = -90", () => {
      expect(faceCameraYaw(0, 0, 0, 4, 90)).toBeCloseTo(-90, 4);
    });
  });
});
