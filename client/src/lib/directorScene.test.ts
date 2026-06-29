import { describe, it, expect } from "vitest";
import {
  aspectRatioValue, makeActor, makeDefaultDirectorScene, mannequinModel, nextActorName, MANNEQUIN_MODELS,
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

  it("makeDefaultDirectorScene：1 个角色 + 32° 机位 + 16:9 + 显示地面", () => {
    const s = makeDefaultDirectorScene();
    expect(s.actors).toHaveLength(1);
    expect(s.camera.fov).toBe(32);
    expect(s.aspectRatio).toBe("16:9");
    expect(s.groundVisible).toBe(true);
    expect(s.camera.position).toHaveLength(3);
  });
});
