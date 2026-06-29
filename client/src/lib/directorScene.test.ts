import { describe, it, expect } from "vitest";
import {
  aspectRatioValue, makeActor, makeDefaultDirectorScene, mannequinModel, nextActorName, MANNEQUIN_MODELS,
  makeCrowd, bakeGroupTransform, ensureCameras, nextCameraName,
} from "./directorScene";
import type { DirectorActor } from "../../../shared/types";

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
