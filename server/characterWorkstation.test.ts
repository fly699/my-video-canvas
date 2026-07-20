import { describe, it, expect } from "vitest";
import { cullCharacterWorkstations } from "./_core/characterWorkstation";
import type { AgentOperation } from "../shared/types";

// #278 角色出图工位剔除——判别式守卫：只剔「1:1 纯展示复制品」，绝不误伤
// 多版本 / 有下游 / 合影 / 混合输入 / 被引用 / 连画布已有节点 等有用形态。

const create = (nodeType: string, tempId: string, title = tempId): AgentOperation =>
  ({ op: "create", nodeType, tempId, title } as AgentOperation);
const connect = (sourceRef: string, targetRef: string): AgentOperation =>
  ({ op: "connect", sourceRef, targetRef } as AgentOperation);

describe("#278 cullCharacterWorkstations", () => {
  it("1:1 纯展示工位 → 剔除 create+connect，角色保留，拒因带节点名", () => {
    const ops = [
      create("character", "c1", "李雷"),
      create("image_gen", "w1", "李雷·定妆出图"),
      connect("c1", "w1"),
    ];
    const r = cullCharacterWorkstations(ops);
    expect(r.ops.map((o) => o.tempId ?? `${o.sourceRef}->${o.targetRef}`)).toEqual(["c1"]);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]).toContain("李雷·定妆出图");
  });
  it("多角色批量：每个 1:1 工位都被剔除（用户实报 27+13 全配工位的场景）", () => {
    const ops: AgentOperation[] = [];
    for (let i = 1; i <= 3; i++) {
      ops.push(create("character", `c${i}`), create("image_gen", `w${i}`), connect(`c${i}`, `w${i}`));
    }
    const r = cullCharacterWorkstations(ops);
    expect(r.ops.filter((o) => o.op === "create").map((o) => o.tempId)).toEqual(["c1", "c2", "c3"]);
    expect(r.ops.some((o) => o.op === "connect")).toBe(false);
    expect(r.dropped).toHaveLength(3);
  });
  it("1:N 多版本（一个角色接多个 image_gen）→ 全部保留（用户认可的有用形态）", () => {
    const ops = [
      create("character", "c1"),
      create("image_gen", "v1"), create("image_gen", "v2"), create("image_gen", "v3"),
      connect("c1", "v1"), connect("c1", "v2"), connect("c1", "v3"),
    ];
    const r = cullCharacterWorkstations(ops);
    expect(r.ops).toHaveLength(ops.length);
    expect(r.dropped).toHaveLength(0);
  });
  it("有下游消费者的工位（角色→image_gen→video）→ 保留（真参考管线）", () => {
    const ops = [
      create("character", "c1"), create("image_gen", "w1"), create("video_task", "v1"),
      connect("c1", "w1"), connect("w1", "v1"),
    ];
    expect(cullCharacterWorkstations(ops).ops).toHaveLength(ops.length);
  });
  it("混合输入（角色+提示词都连入）与多角色合影 → 保留", () => {
    const ops = [
      create("character", "c1"), create("character", "c2"), create("prompt", "p1"),
      create("image_gen", "mix"), create("image_gen", "duo"),
      connect("c1", "mix"), connect("p1", "mix"),
      connect("c1", "duo"), connect("c2", "duo"),
    ];
    const r = cullCharacterWorkstations(ops);
    expect(r.ops).toHaveLength(ops.length);
    expect(r.dropped).toHaveLength(0);
  });
  it("被后续操作引用（update / group targetRefs）→ 保留", () => {
    const ops = [
      create("character", "c1"), create("image_gen", "w1"), connect("c1", "w1"),
      { op: "update", targetRef: "w1", payload: { prompt: "x" } } as AgentOperation,
      create("character", "c2"), create("image_gen", "w2"), connect("c2", "w2"),
      { op: "group", targetRefs: ["c2", "w2"], title: "组" } as AgentOperation,
    ];
    const r = cullCharacterWorkstations(ops);
    expect(r.ops).toHaveLength(ops.length);
  });
  it("入边来自画布已有角色（真实 id，非本批 tempId）→ 保留（不动用户现有结构）", () => {
    const ops = [create("image_gen", "w1"), connect("existing-node-123", "w1")];
    expect(cullCharacterWorkstations(ops).ops).toHaveLength(2);
  });
  it("无角色或无 image_gen 时原样返回（零成本早退）", () => {
    const ops = [create("storyboard", "s1"), create("video_task", "v1"), connect("s1", "v1")];
    expect(cullCharacterWorkstations(ops).ops).toBe(ops);
  });
});
