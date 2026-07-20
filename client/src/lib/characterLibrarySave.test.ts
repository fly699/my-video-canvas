import { describe, it, expect } from "vitest";
import { buildLibrarySaveInput, librarySourceProjectOf } from "./characterLibrarySave";
import type { CharacterNodeData } from "../../../shared/types";

const person = (p: Partial<CharacterNodeData> = {}): CharacterNodeData =>
  ({ characterKind: "person", ...p }) as CharacterNodeData;
const scene = (p: Partial<CharacterNodeData> = {}): CharacterNodeData =>
  ({ characterKind: "scene", ...p }) as CharacterNodeData;

// ── #272 入库快照组装（角色卡「存库」与助手「全部入库」口令共用单一事实源） ─────
describe("buildLibrarySaveInput", () => {
  it("人物：剥离图谱瞬态字段与对侧（场景）字段，保留本类别字段与参考图", () => {
    const input = buildLibrarySaveInput(person({
      name: "李雷", appearance: "短黑发", referenceImageUrl: "https://x/a.png",
      createdBy: 7 as never, ownerAgentId: "agent1" as never, sceneGroup: "s1" as never,
      status: "processing", progress: 40, errorMessage: "e",         // #271 运行态不入库
      sceneName: "残留场景名", atmosphere: "残留氛围",                 // 对侧字段剥离
    }), 42)!;
    expect(input.name).toBe("李雷");
    expect(input.characterKind).toBe("person");
    expect(input.thumbnail).toBe("https://x/a.png");
    expect(input.payload.appearance).toBe("短黑发");
    for (const k of ["createdBy", "ownerAgentId", "sceneGroup", "status", "progress", "errorMessage", "sceneName", "atmosphere"]) {
      expect(k in input.payload).toBe(false);
    }
    // #272 来源项目标记写进 payload（零迁移，面板分项目检索的数据源）
    expect(input.payload.librarySourceProjectId).toBe(42);
  });

  it("场景：名字取 sceneName、剥离人物字段；无来源项目时不写标记键", () => {
    const input = buildLibrarySaveInput(scene({ sceneName: "足球场", atmosphere: "黄昏", name: "", appearance: "残留外貌" }), null)!;
    expect(input.name).toBe("足球场");
    expect(input.characterKind).toBe("scene");
    expect(input.payload.atmosphere).toBe("黄昏");
    expect("appearance" in input.payload).toBe(false);
    expect("librarySourceProjectId" in input.payload).toBe(false);
  });

  it("无名字返回 null（调用方跳过/提示，绝不入库空名条目）", () => {
    expect(buildLibrarySaveInput(person({ appearance: "有外貌没名字" }), 1)).toBeNull();
    expect(buildLibrarySaveInput(scene({ atmosphere: "有氛围没名字" }), 1)).toBeNull();
  });

  it("librarySourceProjectOf：读回标记；老条目/非法值返回 null", () => {
    expect(librarySourceProjectOf({ librarySourceProjectId: 7 })).toBe(7);
    expect(librarySourceProjectOf({})).toBeNull();
    expect(librarySourceProjectOf({ librarySourceProjectId: "7" as never })).toBeNull();
    expect(librarySourceProjectOf(undefined)).toBeNull();
  });
});
