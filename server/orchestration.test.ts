import { describe, it, expect } from "vitest";
import { extractReplayableOps, orchestrationSummary, canSaveOrchestration, serializeOrchestrations, parseOrchestrations } from "../shared/orchestration";
import type { OrchestrationTemplate } from "../shared/orchestration";
import type { AgentOperation } from "../shared/types";

// 优化③ 编排模板库：抽出跨项目可重放的 create+connect 闭包（剔除引用既有节点/触发生成的操作）。
const create = (tempId: string, nodeType: string): AgentOperation =>
  ({ op: "create", tempId, nodeType: nodeType as AgentOperation["nodeType"], payload: {} });
const connect = (sourceRef: string, targetRef: string): AgentOperation => ({ op: "connect", sourceRef, targetRef });

describe("extractReplayableOps", () => {
  it("保留 create + 两端都在本批 create 的 connect", () => {
    const ops: AgentOperation[] = [create("s1", "image_gen"), create("v1", "video_task"), connect("s1", "v1")];
    const out = extractReplayableOps(ops);
    expect(out).toHaveLength(3);
  });

  it("剔除指向既有节点（非本批 tempId）的 connect", () => {
    const ops: AgentOperation[] = [create("s1", "image_gen"), connect("s1", "existingNode42")];
    const out = extractReplayableOps(ops);
    expect(out.some((o) => o.op === "connect")).toBe(false);
    expect(out.filter((o) => o.op === "create")).toHaveLength(1);
  });

  it("剔除 update/delete/canvas 等上下文相关操作", () => {
    const ops: AgentOperation[] = [
      create("s1", "image_gen"),
      { op: "update", targetRef: "existing1", payload: { aspectRatio: "16:9" } },
      { op: "delete", targetRef: "existing2" },
      { op: "canvas", action: "run_all" },
    ];
    const out = extractReplayableOps(ops);
    expect(out).toHaveLength(1);
    expect(out[0].op).toBe("create");
  });
});

describe("orchestrationSummary", () => {
  it("统计建节点数与连线数", () => {
    const ops: AgentOperation[] = [create("s1", "image_gen"), create("v1", "video_task"), connect("s1", "v1")];
    expect(orchestrationSummary(ops)).toEqual({ creates: 2, connects: 1 });
  });
});

describe("canSaveOrchestration", () => {
  it("至少 1 个 create 才可存", () => {
    expect(canSaveOrchestration([create("s1", "image_gen")])).toBe(true);
    expect(canSaveOrchestration([{ op: "canvas", action: "run_all" }])).toBe(false);
    expect(canSaveOrchestration([])).toBe(false);
  });
});

describe("serializeOrchestrations / parseOrchestrations", () => {
  const gid = (i: number) => `imp_${i}`;
  const tpl: OrchestrationTemplate = { id: "x", name: "我的编排", createdAt: 123, ops: [create("s1", "image_gen"), create("v1", "video_task"), connect("s1", "v1")] };

  it("序列化后能原样解析回来（id 重分配、内容保留）", () => {
    const json = serializeOrchestrations([tpl]);
    const back = parseOrchestrations(json, gid);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: "imp_0", name: "我的编排", createdAt: 123 });
    expect(back[0].ops).toHaveLength(3);
  });

  it("兼容裸数组；跳过无 create / 非法项；无 name 用默认名", () => {
    const arr = JSON.stringify([
      { name: "有效", ops: [create("a", "image_gen")] },
      { ops: [{ op: "canvas", action: "run_all" }] }, // 无 create → 跳过
      { ops: [create("b", "image_gen")] },             // 无 name → 默认名
      "garbage",                                        // 非对象 → 跳过
    ]);
    const back = parseOrchestrations(arr, gid);
    expect(back.map((t) => t.name)).toEqual(["有效", "导入编排2"]);
  });

  it("非法 JSON → 空数组", () => {
    expect(parseOrchestrations("{not json", gid)).toEqual([]);
    expect(parseOrchestrations("42", gid)).toEqual([]);
  });
});
