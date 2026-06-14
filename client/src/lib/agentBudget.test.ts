import { describe, it, expect } from "vitest";
import { estimateOpsBudget, estimateOpsBudgetBreakdown, budgetLabel } from "./agentBudget";
import type { AgentOperation } from "../../../shared/types";

const create = (nodeType: string, payload?: Record<string, unknown>): AgentOperation =>
  ({ op: "create", nodeType, payload } as AgentOperation);

describe("estimateOpsBudgetBreakdown", () => {
  it("空操作 → 空明细", () => {
    expect(estimateOpsBudgetBreakdown([])).toEqual([]);
  });

  it("聚合同模型生图，累计单价×数量", () => {
    // poyo_nano_banana cost=5
    const ops = [create("image_gen", { model: "poyo_nano_banana" }), create("image_gen", { model: "poyo_nano_banana" }), create("image_gen", { model: "poyo_nano_banana" })];
    const bd = estimateOpsBudgetBreakdown(ops);
    expect(bd).toHaveLength(1);
    expect(bd[0]).toMatchObject({ kind: "credits", count: 3, unitCredits: 5, totalCredits: 15 });
    expect(bd[0].label).toContain("云端生图");
    // 与汇总一致
    expect(estimateOpsBudget(ops).credits).toBe(15);
  });

  it("视频与未知模型生图归为按模型计费", () => {
    const ops = [create("video_task"), create("video_task"), create("image_gen", { /* no model */ })];
    const bd = estimateOpsBudgetBreakdown(ops);
    const video = bd.find((x) => x.key === "video_task");
    expect(video).toMatchObject({ kind: "byModel", count: 2 });
    expect(bd.some((x) => x.kind === "byModel" && x.label.includes("未指定模型"))).toBe(true);
  });

  it("ComfyUI 节点归为本地免费", () => {
    const ops = [create("comfyui_image"), create("comfyui_video"), create("comfyui_workflow", { templateId: "t1" })];
    const bd = estimateOpsBudgetBreakdown(ops);
    expect(bd.every((x) => x.kind === "local")).toBe(true);
    expect(bd).toHaveLength(3);
    expect(bd.every((x) => x.totalCredits == null)).toBe(true);
  });

  it("非 create / 无 nodeType 的操作被忽略", () => {
    const ops: AgentOperation[] = [
      { op: "connect", source: "a", target: "b" } as AgentOperation,
      { op: "update", nodeId: "x", payload: {} } as AgentOperation,
      create("note", { content: "hi" }), // note 不计费
    ];
    expect(estimateOpsBudgetBreakdown(ops)).toEqual([]);
  });

  it("排序：已知 credits 在前（降序），本地在后", () => {
    const ops = [
      create("comfyui_image"),
      create("image_gen", { model: "poyo_gpt_image" }), // cost=2
      create("image_gen", { model: "poyo_nano_banana" }), create("image_gen", { model: "poyo_nano_banana" }), // 2×5=10
      create("video_task"),
    ];
    const bd = estimateOpsBudgetBreakdown(ops);
    expect(bd[0].kind).toBe("credits");
    expect(bd[0].totalCredits).toBe(10); // nano banana 总价更高 → 排最前
    expect(bd[bd.length - 1].kind).toBe("local");
  });

  it("明细 credits 之和等于汇总 credits", () => {
    const ops = [
      create("image_gen", { model: "poyo_nano_banana" }), // 5
      create("image_gen", { model: "poyo_gpt_image" }),   // 2
      create("video_task"),
      create("comfyui_image"),
    ];
    const fromBreakdown = estimateOpsBudgetBreakdown(ops).reduce((s, x) => s + (x.totalCredits ?? 0), 0);
    expect(fromBreakdown).toBe(estimateOpsBudget(ops).credits);
    expect(budgetLabel(estimateOpsBudget(ops))).toContain("credits");
  });
});
