import { describe, it, expect } from "vitest";
import { buildPlanReport } from "../shared/planReport";

describe("buildPlanReport", () => {
  it("完整字段 → 标题 + 各段 + 掉单逐条", () => {
    const r = buildPlanReport({
      request: "做一个三镜短片",
      reply: "已规划 3 镜",
      applied: "新建 5 个节点 · 连 4 条线",
      failed: "1 个操作失败",
      dropped: ["镜3 引用了不存在的图源", "video_task 的 fps 字段不在目录内"],
      createdCount: 5,
    });
    const lines = r.split("\n");
    expect(lines[0]).toBe("【画布助手规划排查报告】");
    expect(r).toContain("请求：做一个三镜短片");
    expect(r).toContain("回复：已规划 3 镜");
    expect(r).toContain("已落地：新建 5 个节点 · 连 4 条线");
    expect(r).toContain("未落地/失败：1 个操作失败");
    expect(r).toContain("新建节点：5");
    expect(r).toContain("掉单原因（2 类）：");
    expect(r).toContain("- 镜3 引用了不存在的图源");
    expect(r).toContain("- video_task 的 fps 字段不在目录内");
  });

  it("空字段省略；已落地始终有行（无则「无」）", () => {
    const r = buildPlanReport({ dropped: ["某原因"] });
    expect(r).toContain("已落地：无");
    expect(r).not.toContain("请求：");
    expect(r).not.toContain("回复：");
    expect(r).not.toContain("未落地/失败：");
    expect(r).not.toContain("新建节点：");
    expect(r).toContain("掉单原因（1 类）：");
  });

  it("空掉单不输出「掉单原因」段", () => {
    const r = buildPlanReport({ request: "x", dropped: [] });
    expect(r).not.toContain("掉单原因");
  });

  it("过长字段被截断加省略号", () => {
    const long = "字".repeat(600);
    const r = buildPlanReport({ request: long });
    expect(r).toContain("…");
    expect(r.length).toBeLessThan(600 + 50);
  });
});
