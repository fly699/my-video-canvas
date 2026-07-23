import { describe, it, expect } from "vitest";
import { previewableCreates, filterPlanBySelection } from "../shared/planPreview";
import type { AgentOperation } from "../shared/types";

// 优化B 镜头表预览卡：预览行提取 + 勾选式落地筛选（纯函数）。
const create = (tempId: string, nodeType: string, payload: Record<string, unknown> = {}, title?: string): AgentOperation =>
  ({ op: "create", tempId, nodeType: nodeType as AgentOperation["nodeType"], title, payload });
const connect = (sourceRef: string, targetRef: string): AgentOperation => ({ op: "connect", sourceRef, targetRef });

describe("previewableCreates", () => {
  it("只抽 create（有 tempId）；有 sceneNumber 的按镜号升序在前", () => {
    const ops: AgentOperation[] = [
      create("s2", "storyboard", { sceneNumber: 2, promptText: "夜景追逐", shotType: "MS", duration: 5, dialogue: "陈默：快走！" }),
      create("s1", "storyboard", { sceneNumber: 1, promptText: "白天开场", shotType: "WS", duration: 4 }),
      create("c1", "character", { name: "陈默" }),
      connect("s1", "s2"),
      { op: "update", targetRef: "existing1", payload: { aspectRatio: "16:9" } },
      { op: "canvas", action: "run_all" },
    ];
    const rows = previewableCreates(ops);
    expect(rows.map((r) => r.tempId)).toEqual(["s1", "s2", "c1"]); // 分镜按镜号，角色无镜号追加在后
    expect(rows[0]).toMatchObject({ sceneNumber: 1, shotType: "WS", duration: 4, promptText: "白天开场" });
    expect(rows[1].dialogue).toBe("陈默：快走！");
    expect(rows[2].title).toBe("角色"); // character 无 op.title → 取类型中文名（payload.name 不作标题）
  });

  it("title 优先 op.title，其次类型中文名，再次 nodeType", () => {
    expect(previewableCreates([create("a", "video_task", {}, "镜1")])[0].title).toBe("镜1");
    expect(previewableCreates([create("b", "video_task", {})])[0].title).toBe("视频");
    expect(previewableCreates([create("d", "weird_type", {})])[0].title).toBe("weird_type");
  });

  it("promptText 回退：promptText → prompt → description", () => {
    expect(previewableCreates([create("a", "image_gen", { prompt: "一只猫" })])[0].promptText).toBe("一只猫");
    expect(previewableCreates([create("b", "storyboard", { description: "画面描述" })])[0].promptText).toBe("画面描述");
  });
});

describe("filterPlanBySelection", () => {
  const ops: AgentOperation[] = [
    create("s1", "storyboard", { sceneNumber: 1 }),
    create("s2", "storyboard", { sceneNumber: 2 }),
    create("v1", "video_task"),
    connect("s1", "v1"),
    connect("s2", "v1"),
    { op: "update", targetRef: "s2", payload: { title: "改镜2" } },
    { op: "canvas", action: "run_all" },
  ];

  it("空取消集 → 原样返回（零改动）", () => {
    expect(filterPlanBySelection(ops, new Set())).toBe(ops);
  });

  it("取消 s2 → 去掉 s2 的 create + 引用 s2 的 connect/update；其余保留", () => {
    const out = filterPlanBySelection(ops, new Set(["s2"]));
    expect(out.some((o) => o.op === "create" && o.tempId === "s2")).toBe(false);
    expect(out.some((o) => o.op === "connect" && o.sourceRef === "s2")).toBe(false);
    expect(out.some((o) => o.op === "update" && o.targetRef === "s2")).toBe(false);
    // s1、v1、s1→v1 连线、canvas run_all 全部保留
    expect(out.some((o) => o.op === "create" && o.tempId === "s1")).toBe(true);
    expect(out.some((o) => o.op === "connect" && o.sourceRef === "s1")).toBe(true);
    expect(out.some((o) => o.op === "canvas" && o.action === "run_all")).toBe(true);
    expect(out).toHaveLength(4);
  });

  it("取消 v1 → 去掉 v1 + 两条指向 v1 的 connect", () => {
    const out = filterPlanBySelection(ops, new Set(["v1"]));
    expect(out.some((o) => o.op === "connect")).toBe(false);
    expect(out.filter((o) => o.op === "create")).toHaveLength(2);
  });
});
