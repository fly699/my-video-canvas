import { describe, it, expect } from "vitest";
import { previewableCreates, filterPlanBySelection, planContinuityWarnings, shotRowsToCsv, previewableEdges, planOutline } from "../shared/planPreview";
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

describe("planContinuityWarnings", () => {
  it("画幅统一 + 提示词充分 + 时长正常 → 无告警", () => {
    const rows = previewableCreates([
      create("s1", "image_gen", { aspectRatio: "16:9", prompt: "白天开场，主角缓步走入广场" }),
      create("v1", "video_task", { aspectRatio: "16:9", promptText: "镜头缓缓推进，主角回眸", duration: 6 }),
    ]);
    expect(planContinuityWarnings(rows)).toEqual({});
  });

  it("画幅混用 → 所有带比例的行标注「比例不统一」", () => {
    const rows = previewableCreates([
      create("s1", "image_gen", { aspectRatio: "16:9", prompt: "白天开场，主角缓步走入广场" }),
      create("s2", "image_gen", { aspectRatio: "9:16", prompt: "夜晚雨中，主角撑伞独行街头" }),
    ]);
    const w = planContinuityWarnings(rows);
    expect(w.s1).toContain("比例不统一（16:9）");
    expect(w.s2).toContain("比例不统一（9:16）");
  });

  it("视频镜时长：缺失/≤0/偏长 分别告警；非视频不查时长", () => {
    const rows = previewableCreates([
      create("v1", "video_task", { promptText: "长镜推进，主角穿过人群走向站台" }),               // 缺时长
      create("v2", "video_task", { promptText: "俯拍全景，城市灯火在夜色中渐次亮起", duration: 0 }),  // ≤0
      create("v3", "video_task", { promptText: "手持跟拍，主角奔跑穿越狭窄巷道", duration: 45 }),     // 偏长
      create("i1", "image_gen", { prompt: "一张写实风格的城市夜景照片，霓虹倒映" }),                 // 图不查时长
    ]);
    const w = planContinuityWarnings(rows);
    expect(w.v1).toContain("未设时长（将用默认）");
    expect(w.v2).toContain("时长异常（≤0s）");
    expect(w.v3).toContain("时长偏长（45s）");
    expect(w.i1).toBeUndefined();
  });

  it("画面类节点提示词过简 → 告警；工作流不查提示词", () => {
    const rows = previewableCreates([
      create("i1", "image_gen", { prompt: "猫" }),
      create("wf", "comfyui_workflow", {}),
    ]);
    const w = planContinuityWarnings(rows);
    expect(w.i1).toContain("提示词过简，建议补充画面细节");
    expect(w.wf).toBeUndefined();
  });
});

describe("previewableEdges", () => {
  it("每条 connect 解析成 源标题→目标标题", () => {
    const ops: AgentOperation[] = [
      create("i1", "image_gen", {}, "镜1图"),
      create("v1", "video_task", {}, "镜1视频"),
      connect("i1", "v1"),
    ];
    expect(previewableEdges(ops)).toEqual([{ from: "镜1图", to: "镜1视频" }]);
  });

  it("无 title 回退类型中文名；跨批引用（非本批 create）回退显示 ref", () => {
    const ops: AgentOperation[] = [
      create("i1", "image_gen"),          // 无 title → 「图像」
      connect("i1", "existingNode42"),    // 目标不在本批 → 显示 ref
    ];
    expect(previewableEdges(ops)).toEqual([{ from: "图像", to: "existingNode42" }]);
  });

  it("无连线 → 空数组", () => {
    expect(previewableEdges([create("i1", "image_gen", {}, "镜1图")])).toEqual([]);
  });
});

describe("planOutline", () => {
  it("生成可读大纲：标题行 + 逐镜（镜号/景别/时长/提示词/台词）+ 连线", () => {
    const ops: AgentOperation[] = [
      create("s1", "storyboard", { sceneNumber: 1, shotType: "WS", duration: 4, promptText: "白天开场", dialogue: "陈默：出发" }),
      create("v1", "video_task", {}, "镜1视频"),
      connect("s1", "v1"),
    ];
    const out = planOutline(ops);
    expect(out.split("\n")[0]).toBe("镜头表（2 个节点）");
    expect(out).toContain("- 镜1 分镜（WS 4s）：白天开场 💬陈默：出发");
    expect(out).toContain("连线：");
    expect(out).toContain("- 分镜 → 镜1视频");
  });

  it("无连线时不输出「连线：」段", () => {
    const out = planOutline([create("i1", "image_gen", { prompt: "一只猫" }, "图1")]);
    expect(out).toContain("- 图1：一只猫");
    expect(out).not.toContain("连线：");
  });
});

describe("shotRowsToCsv", () => {
  it("表头 + 每行按镜号/标题/类型/景别/时长/比例/提示词/台词", () => {
    const rows = previewableCreates([
      create("s1", "storyboard", { sceneNumber: 1, shotType: "WS", duration: 4, aspectRatio: "16:9", promptText: "白天开场", dialogue: "陈默：出发" }),
    ]);
    const csv = shotRowsToCsv(rows);
    const [header, line1] = csv.split("\r\n");
    expect(header).toBe("镜号,标题,类型,景别,时长(s),比例,提示词,台词");
    expect(line1).toBe("1,分镜,分镜,WS,4,16:9,白天开场,陈默：出发");
  });

  it("含逗号/引号/换行的字段按 CSV 规则转义", () => {
    const rows = previewableCreates([
      create("s1", "image_gen", { prompt: 'A, B "quoted"\n换行' }, "标题,含逗号"),
    ]);
    const line1 = shotRowsToCsv(rows).split("\r\n")[1];
    expect(line1).toContain('"标题,含逗号"');
    expect(line1).toContain('"A, B ""quoted""\n换行"');
  });
});
