import { describe, it, expect } from "vitest";
import { derivePipelineSteps } from "./pipelinePlan";

const N = (id: string, nodeType: string, payload: Record<string, unknown> = {}) => ({ id, data: { nodeType, payload } });

describe("derivePipelineSteps", () => {
  it("无分镜 → 空（非分镜管线不出引导卡）", () => {
    const nodes = [N("p1", "prompt", { ownerAgentId: "ag" }), N("cw", "comfyui_workflow", { ownerAgentId: "ag" })];
    expect(derivePipelineSteps("ag", nodes)).toEqual([]);
  });

  it("仅分镜（无合并）→ 只给打开镜头表一步，入口取镜号最小", () => {
    const nodes = [
      N("sb2", "storyboard", { ownerAgentId: "ag", sceneNumber: 2 }),
      N("sb1", "storyboard", { ownerAgentId: "ag", sceneNumber: 1 }),
    ];
    const steps = derivePipelineSteps("ag", nodes);
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe("open_shotlist");
    expect(steps[0].targetId).toBe("sb1"); // 镜号最小
  });

  it("分镜 + 合并 → 三步路线，done 反映合并当前状态", () => {
    const nodes = [
      N("sb1", "storyboard", { ownerAgentId: "ag", sceneNumber: 1 }),
      N("sb2", "storyboard", { ownerAgentId: "ag", sceneNumber: 2 }),
      N("m", "merge", { ownerAgentId: "ag", segTransitions: ["fade"], burnShotSubtitles: true }),
    ];
    const steps = derivePipelineSteps("ag", nodes);
    expect(steps.map((s) => s.action)).toEqual(["open_shotlist", "assemble", "burn_subtitle"]);
    expect(steps[1].targetId).toBe("m");
    expect(steps[1].done).toBe(true);   // 已装配
    expect(steps[2].done).toBe(true);   // 已开内嵌字幕
  });

  it("只算本智能体名下节点（别的 agent / 无归属不计）", () => {
    const nodes = [
      N("sb1", "storyboard", { ownerAgentId: "other", sceneNumber: 1 }),
      N("sb2", "storyboard", { sceneNumber: 2 }), // 无归属
    ];
    expect(derivePipelineSteps("ag", nodes)).toEqual([]);
  });

  it("合并未装配 / 未开字幕 → done 为 false", () => {
    const nodes = [
      N("sb1", "storyboard", { ownerAgentId: "ag", sceneNumber: 1 }),
      N("m", "merge", { ownerAgentId: "ag" }),
    ];
    const steps = derivePipelineSteps("ag", nodes);
    expect(steps[1].done).toBeFalsy();
    expect(steps[2].done).toBeFalsy();
  });
});
