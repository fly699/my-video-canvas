// #225 批②「已覆盖 N 镜」计数纯函数
import { describe, it, expect } from "vitest";
import { countCharacterCoverage, coveredNodeIds } from "./characterCoverage";

const REF = "https://cdn.example.com/face.png";
const nodes = [
  { id: "c1", nodeType: "character", payload: {} },
  { id: "s1", nodeType: "storyboard", payload: { referenceImageUrl: REF } },
  { id: "g1", nodeType: "image_gen", payload: { refImages: [REF, "other.png"] } },
  { id: "v1", nodeType: "video_task", payload: { prompt: "无参考" } },
  { id: "n1", nodeType: "note", payload: {} },          // 非生成节点，不计
  { id: "c2", nodeType: "character", payload: {} },     // 角色→角色 不计
];

describe("countCharacterCoverage", () => {
  it("只统计角色为 source 且目标是生成节点的边；withRef 按主图 URL 包含判定", () => {
    const edges = [
      { source: "c1", target: "s1" },
      { source: "c1", target: "g1" },
      { source: "c1", target: "v1" },
      { source: "c1", target: "n1" },   // 便签：不计
      { source: "c1", target: "c2" },   // 角色：不计
      { source: "c2", target: "s1" },   // 别的角色的边：不计入 c1
    ];
    const r = countCharacterCoverage("c1", REF, edges, nodes);
    expect(r.total).toBe(3);       // s1 + g1 + v1
    expect(r.withRef).toBe(2);     // s1（referenceImageUrl）+ g1（refImages 数组）
  });

  it("同一目标多条边只算一次（多桩点重复连线不虚增）", () => {
    const edges = [
      { source: "c1", target: "s1" },
      { source: "c1", target: "s1" },
    ];
    expect(countCharacterCoverage("c1", REF, edges, nodes).total).toBe(1);
  });

  it("无主参考图 → withRef 恒 0（不会误把空串当命中）", () => {
    const edges = [{ source: "c1", target: "s1" }];
    const r = countCharacterCoverage("c1", "", edges, nodes);
    expect(r.total).toBe(1);
    expect(r.withRef).toBe(0);
    expect(countCharacterCoverage("c1", undefined, edges, nodes).withRef).toBe(0);
  });

  it("零连线 → {0,0}", () => {
    expect(countCharacterCoverage("c1", REF, [], nodes)).toEqual({ total: 0, withRef: 0 });
  });
});

describe("coveredNodeIds", () => {
  it("返回接入的生成节点 id（唯一、按边序）；非生成/角色→角色/重复目标剔除", () => {
    const edges = [
      { source: "c1", target: "s1" },
      { source: "c1", target: "n1" }, // note 非生成，剔除
      { source: "c1", target: "g1" },
      { source: "c1", target: "s1" }, // 重复目标，只留一次
      { source: "c1", target: "c2" }, // 角色→角色，剔除
      { source: "cX", target: "v1" }, // 非本角色为 source，剔除
    ];
    expect(coveredNodeIds("c1", edges, nodes)).toEqual(["s1", "g1"]);
  });
  it("零连线 → []", () => {
    expect(coveredNodeIds("c1", [], nodes)).toEqual([]);
  });
});
